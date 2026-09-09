// Running a manifest against a wallet: the two discovery shapes badgersStake.ts and
// hodlContracts.ts implement by hand, done once over whatever a manifest describes.
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
// lookups; announced contracts are bounded by the history, and this bounds the rest.
const MAX_CONTRACT_LOOKUPS = 50;

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

async function runAnnouncementManifest(
  manifest: ContractManifest,
  find: Extract<ContractManifest['find'], { kind: 'announcement' }>,
  context: WalletContext,
): Promise<ContractPosition[]> {
  const positions: ContractPosition[] = [];
  for (const contract of announcedContracts(manifest, find, context).slice(0, MAX_CONTRACT_LOOKUPS)) {
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
