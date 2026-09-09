// Running a manifest against a wallet, once for whatever shape a manifest describes.
//
// A manifest found at an address is one lookup for every user of the protocol, since the owner is
// written into each position; one announced in the history is read off transactions the wallet
// funded, and its address is only known once the contract has been rebuilt from the wallet's own
// keys. Both end at an address whose coins are the position, so both return the same thing.

import type { ElectrumNetworkProvider, TransactionHistoryItem, Utxo } from "mainnet-js";
import { opReturnHex } from "src/utils/history/txDirection";
import { contractAddress, scriptHash } from "./redeemScript";
import { buildScript, readAnnouncement, readCommitment, type ContractManifest, type Fields } from "./contractManifest";

export interface ContractPosition {
  manifestId: string;
  ownership: ContractManifest['ownership'];
  /** where the position sits, which is the contract's address */
  address: string;
  satoshis: bigint;
  /** the coin itself, when the position is one coin rather than a contract's whole balance */
  txid?: string;
  vout?: number;
  /** absent while the coin is still in the mempool */
  confirmedAtHeight?: number;
  token?: Utxo['token'];
  /** everything the manifest decoded, for the row that shows it */
  fields: Fields;
}

export interface WalletContext {
  provider: ElectrumNetworkProvider;
  ownerPkhs: string[];
  history: TransactionHistoryItem[];
  networkPrefix: string;
}

// A manifest naming an address the wallet never chose could otherwise ask for any number of
// lookups; announced contracts are bounded by the history, and this bounds the rest. Reaching it
// drops positions from the portfolio, so it says so rather than truncating quietly.
const MAX_CONTRACT_LOOKUPS = 50;

// the batch cauldronPools.ts used, keeping the requests pipelined over the one electrum connection
const LOOKUP_BATCH_SIZE = 10;

function cappedCandidates<T>(manifestId: string, candidates: T[]) {
  if (candidates.length > MAX_CONTRACT_LOOKUPS) {
    console.warn(`${manifestId}: ${candidates.length - MAX_CONTRACT_LOOKUPS} positions past the lookup cap are not shown`);
  }
  return candidates.slice(0, MAX_CONTRACT_LOOKUPS);
}

// Positions at the one address the manifest names, whose owner each carries
async function runAddressManifest(
  manifest: ContractManifest,
  find: Extract<ContractManifest['find'], { kind: 'address' }>,
  context: WalletContext,
): Promise<ContractPosition[]> {
  if (!context.ownerPkhs.length) return [];
  const utxos = await context.provider.getUtxos(find.address);
  const positions: ContractPosition[] = [];
  for (const utxo of utxos) {
    if (find.token) {
      if (utxo.token?.category !== find.token.category) continue;
      if (find.token.capability && utxo.token.nft?.capability !== find.token.capability) continue;
    }
    let fields: Fields = {};
    if (find.commitment) {
      const read = readCommitment(utxo.token?.nft?.commitment ?? "", find.commitment);
      if (!read) continue;
      fields = read;
    }
    // an address manifest proves ownership by a field, since the position names its owner
    if (manifest.owner.kind !== 'field') continue;
    if (!context.ownerPkhs.includes(String(fields[manifest.owner.field]))) continue;
    positions.push({
      manifestId: manifest.id,
      ownership: manifest.ownership,
      address: find.address,
      satoshis: utxo.satoshis,
      txid: utxo.txid,
      vout: utxo.vout,
      // electrum reports a utxo still in the mempool at height 0
      ...(utxo.height ? { confirmedAtHeight: utxo.height } : {}),
      ...(utxo.token ? { token: utxo.token } : {}),
      fields,
    });
  }
  return positions;
}

// The contracts an announcement names, kept only where the wallet's own key rebuilds the address
// the announcement claims. An announcement that names no owner is why this rebuilds rather than
// reads: funding a contract does not imply owning it.
function announcedContracts(
  manifest: ContractManifest,
  find: Extract<ContractManifest['find'], { kind: 'announcement' }>,
  context: WalletContext,
) {
  const owner = manifest.owner;
  if (owner.kind !== 'rebuild' || !manifest.script) return [];
  const found: { announced: string, address: string, fields: Fields }[] = [];
  for (const transaction of context.history) {
    const announcement = opReturnHex(transaction.outputs[find.output]);
    if (!announcement) continue;
    const fields = readAnnouncement(announcement, find);
    if (!fields) continue;
    const announced = String(fields[owner.matches]);
    // the same contract can be announced by more than one transaction
    if (found.some(entry => entry.announced === announced)) continue;
    // the announced address is compared as the hash it commits to, since creating software
    // writes it as a legacy address, a cashaddr, or a cashaddr without its prefix
    const ourScript = context.ownerPkhs
      .map(pkh => buildScript(manifest.script!, { ...fields, [owner.ownerField]: pkh }))
      .find(script => script !== undefined && scriptHash(script, manifest.script!.addressType) === announced);
    if (!ourScript) continue;
    const address = contractAddress(ourScript, manifest.script.addressType, context.networkPrefix);
    if (address) found.push({ announced, address, fields });
  }
  return found;
}

// A listing whose contract is an output of the announcing transaction. Its owner is named in the
// announcement, so nothing has to be rebuilt, and it is live only while that one output is
// unspent, which the history cannot say and the announcement never could.
async function runListedPositions(
  manifest: ContractManifest,
  find: Extract<ContractManifest['find'], { kind: 'announcement' }>,
  at: { output: number },
  context: WalletContext,
): Promise<ContractPosition[]> {
  const owner = manifest.owner;
  if (owner.kind !== 'field') return [];
  const candidates: { transaction: TransactionHistoryItem, output: NonNullable<TransactionHistoryItem['outputs'][number]>, fields: Fields }[] = [];
  for (const transaction of context.history) {
    const announcement = opReturnHex(transaction.outputs[find.output]);
    const held = transaction.outputs[at.output];
    if (!announcement || !held) continue;
    const fields = readAnnouncement(announcement, find);
    if (!fields) continue;
    if (!context.ownerPkhs.includes(String(fields[owner.field]))) continue;
    candidates.push({ transaction, output: held, fields });
  }

  const positions: ContractPosition[] = [];
  const wanted = cappedCandidates(manifest.id, candidates);
  for (let index = 0; index < wanted.length; index += LOOKUP_BATCH_SIZE) {
    const found = await Promise.all(wanted.slice(index, index + LOOKUP_BATCH_SIZE).map(async candidate => {
      const utxos = await context.provider.getUtxos(candidate.output.address);
      const live = utxos.some(utxo => utxo.txid === candidate.transaction.hash && utxo.vout === at.output);
      if (!live) return undefined;
      return {
        manifestId: manifest.id,
        ownership: manifest.ownership,
        address: candidate.output.address,
        satoshis: BigInt(candidate.output.value),
        txid: candidate.transaction.hash,
        vout: at.output,
        ...(candidate.output.token ? { token: candidate.output.token } : {}),
        fields: candidate.fields,
      } satisfies ContractPosition;
    }));
    positions.push(...found.filter(position => position !== undefined));
  }
  return positions;
}

async function runAnnouncementManifest(
  manifest: ContractManifest,
  find: Extract<ContractManifest['find'], { kind: 'announcement' }>,
  context: WalletContext,
): Promise<ContractPosition[]> {
  if (find.position) return runListedPositions(manifest, find, find.position, context);
  const positions: ContractPosition[] = [];
  for (const contract of cappedCandidates(manifest.id, announcedContracts(manifest, find, context))) {
    // anyone can add funds to the address and a drained one holds nothing, so what it holds now
    // is a lookup rather than anything the announcement said
    const utxos = await context.provider.getUtxos(contract.address);
    const satoshis = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
    if (satoshis === 0n) continue;
    positions.push({
      manifestId: manifest.id,
      ownership: manifest.ownership,
      address: contract.address,
      satoshis,
      fields: contract.fields,
    });
  }
  return positions;
}

export async function runManifest(manifest: ContractManifest, context: WalletContext): Promise<ContractPosition[]> {
  if (manifest.find.kind === 'address') return runAddressManifest(manifest, manifest.find, context);
  return runAnnouncementManifest(manifest, manifest.find, context);
}
