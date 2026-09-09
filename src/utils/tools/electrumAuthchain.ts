// Authchain resolution over electrum: the fallback when no Chaingraph instance is configured for
// the network, chipnet by default, or the configured one does not answer.
//
// Electrum has no notion of an authchain, so the chain is walked one link at a time: the address
// of the link's output 0, whether that output is still unspent there, which makes the link the
// authhead, and otherwise the address's history, among whose transactions the one that spent the
// output is the next link. Chaingraph answers the whole chain in one request; this is a few
// round trips per link, a few seconds for the short chains most tokens have and minutes for a
// chain of a thousand reserve updates, so the walk stops at ten links and a chain still spent
// there goes unresolved rather than resolved at a link that is not its head. The slow link is
// one at a busy address, a wallet's own deposit address say, whose history is fetched from the
// link's height on until the spender turns up; and an address busier than the server's history
// limit, an exchange's, answers with no history at all, so a chain through one is unresolved
// too. The answers take the same shape as Chaingraph's, so what reads them does not know which
// server answered.

import {
  binToHex,
  hexToBin,
  decodeTransaction,
  lockingBytecodeToCashAddress,
  type CashAddressNetworkPrefix,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { ElectrumNetworkProvider, TxI } from "mainnet-js";
import { BCMR_OUTPUT_PREFIX, type AuthHeadResult, type AuthchainLink, type IdentityOutput } from "src/queryChainGraph";
import { i18n } from "src/boot/i18n";

const { t } = i18n.global;

// Raw transactions fetched per round while looking for the spender at a busy address
const SPENDER_SEARCH_BATCH = 50;
// Links followed before a chain is given up on, the authbase counted
export const ELECTRUM_WALK_LIMIT = 10;
// Chains walked at once, so the wait is the longest chain's rather than the sum. Ten is well
// within what the connection already carries: the history load sends every raw transaction
// fetch at once, over a thousand on a first open, and nothing in the client or the servers has
// limited that.
const CONCURRENT_WALKS = 10;

interface Link {
  hash: string;
  transaction: TransactionCommon;
  // as the history reports it: 0 or below while unconfirmed
  height: number;
}

async function fetchTransaction(provider: ElectrumNetworkProvider, hash: string) {
  const rawHex = (await provider.getRawTransactions([hash])).get(hash);
  const transaction = rawHex ? decodeTransaction(hexToBin(rawHex)) : undefined;
  if (!transaction || typeof transaction === "string") throw new Error(t('identities.electrum.transactionNotFound'));
  return transaction;
}

function spendsOutput(transaction: TransactionCommon, hash: string, index: number) {
  return transaction.inputs.some(
    input => input.outpointIndex === index && binToHex(input.outpointTransactionHash) === hash
  );
}

// The link that spent the given link's output 0, or undefined when nothing has: the transactions
// of the output's address from the link's own height on, fetched oldest first until one spends it
async function findSpender(provider: ElectrumNetworkProvider, link: Link, address: string): Promise<Link | undefined> {
  const history = await provider.getHistory(address);
  const ownEntry = history.find(entry => entry.tx_hash === link.hash);
  if (ownEntry) link.height = ownEntry.height;
  const candidates = history
    .filter(entry => entry.tx_hash !== link.hash && (entry.height <= 0 || entry.height >= link.height))
    .sort(byHeightOldestFirst);
  for (let start = 0; start < candidates.length; start += SPENDER_SEARCH_BATCH) {
    const batch = candidates.slice(start, start + SPENDER_SEARCH_BATCH);
    const rawTransactions = await provider.getRawTransactions(batch.map(entry => entry.tx_hash));
    for (const entry of batch) {
      const rawHex = rawTransactions.get(entry.tx_hash);
      const transaction = rawHex ? decodeTransaction(hexToBin(rawHex)) : undefined;
      if (!transaction || typeof transaction === "string") continue;
      if (spendsOutput(transaction, link.hash, 0)) return { hash: entry.tx_hash, transaction, height: entry.height };
    }
  }
  return undefined;
}

// unconfirmed entries last, as the spender of a confirmed output can still be in the mempool
function byHeightOldestFirst(a: TxI, b: TxI) {
  if (a.height <= 0 || b.height <= 0) return b.height - a.height;
  return a.height - b.height;
}

// Every link of the chain from the authbase to the authhead, in order
async function walkAuthchain(provider: ElectrumNetworkProvider, authbase: string, prefix: CashAddressNetworkPrefix): Promise<Link[]> {
  const links: Link[] = [{ hash: authbase, transaction: await fetchTransaction(provider, authbase), height: 0 }];
  for (;;) {
    const link = links[links.length - 1]!;
    const identityOutput = link.transaction.outputs[0];
    // an OP_RETURN at output 0 is never spent: the chain ends there for good
    if (!identityOutput || identityOutput.lockingBytecode[0] === 0x6a) break;
    const address = lockingBytecodeToCashAddress({ bytecode: identityOutput.lockingBytecode, prefix });
    // a script that is no address cannot be asked about, so whether it was spent is unknown
    if (typeof address === "string") throw new Error(t('identities.electrum.unsupportedScript'));
    // the output still unspent is the authhead, answered in one request; only a spent one has
    // its address's history searched, which at a busy address is the expensive part
    const unspent = (await provider.getUtxos(address.address)).find(utxo => utxo.txid === link.hash && utxo.vout === 0);
    if (unspent) {
      link.height = unspent.height ?? 0;
      break;
    }
    if (links.length >= ELECTRUM_WALK_LIMIT) throw new Error(t('identities.electrum.chainTooLong', { links: ELECTRUM_WALK_LIMIT }));
    const spender = await findSpender(provider, link, address.address);
    // spent, but not by anything the history names: the server is answering inconsistently
    if (!spender) throw new Error(t('identities.electrum.spenderNotFound'));
    links.push(spender);
  }
  return links;
}

function tokenOf(output: TransactionCommon['outputs'][number]): IdentityOutput['token'] {
  if (!output.token) return undefined;
  return {
    category: binToHex(output.token.category),
    amount: output.token.amount,
    ...(output.token.nft
      ? { nft: { capability: output.token.nft.capability, commitment: binToHex(output.token.nft.commitment) } }
      : {}),
  };
}

function isPublicationOutput(output: TransactionCommon['outputs'][number]) {
  return binToHex(output.lockingBytecode).startsWith(BCMR_OUTPUT_PREFIX);
}

async function blockTimestamp(provider: ElectrumNetworkProvider, height: number) {
  if (height <= 0) return undefined;
  const header = (await provider.getHeaders([height])).get(height);
  return header?.timestamp;
}

// The same answer Chaingraph's authhead query gives, read off the walked chain
async function readAuthHead(provider: ElectrumNetworkProvider, tokenId: string, links: Link[], linksLimit: number): Promise<AuthHeadResult> {
  const authhead = links[links.length - 1]!;
  const authheadOutput = authhead.transaction.outputs[0];
  let identityOutput: IdentityOutput | undefined;
  if (authheadOutput) {
    const token = tokenOf(authheadOutput);
    identityOutput = { lockingBytecode: binToHex(authheadOutput.lockingBytecode), satoshis: authheadOutput.valueSatoshis, ...(token ? { token } : {}) };
  }

  const lastPublication = [...links].reverse().find(link => link.transaction.outputs.some(isPublicationOutput));
  const publicationOutputs = (lastPublication?.transaction.outputs ?? [])
    .filter(isPublicationOutput)
    .map(output => binToHex(output.lockingBytecode));
  const publicationTimestamp = lastPublication ? await blockTimestamp(provider, lastPublication.height) : undefined;

  // what the genesis made never changes, so it decides whether the identity is a token's
  const genesisTimestamp = links[1] ? await blockTimestamp(provider, links[1].height) : undefined;
  const categoryOutputs = (links[1]?.transaction.outputs ?? [])
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => output.token && binToHex(output.token.category) === tokenId);
  const genesisSupply = categoryOutputs.reduce((total, { output }) => total + (output.token?.amount ?? 0n), 0n);
  const keyOutput = categoryOutputs.find(({ index }) => index === 1)?.output;
  const mintedKey = keyOutput?.token?.nft?.capability === "none" && keyOutput.token.amount === 0n;
  const keyCommitment = mintedKey ? binToHex(keyOutput.token!.nft!.commitment) : undefined;

  return {
    txid: authhead.hash,
    ...(identityOutput ? { identityOutput } : {}),
    publicationOutputs,
    ...(publicationTimestamp !== undefined ? { publicationTimestamp } : {}),
    chainLength: links.length,
    recentLinks: linksLimit > 0 ? links.slice(-linksLimit).map(link => link.hash) : [],
    isToken: categoryOutputs.length > 0,
    fungibleSupply: genesisSupply > 0n,
    genesisSupply,
    ...(genesisTimestamp !== undefined ? { genesisTimestamp } : {}),
    ...(keyCommitment !== undefined ? { keyCommitment } : {}),
  };
}

// The authheads of the given categories, a few chains walked at a time. A category whose chain
// cannot be walked is absent from the map, as a category Chaingraph does not know is: a chain
// longer than the walk goes, or through an address the server serves no history for, is the
// expected case, so it is noted without a stack.
export async function resolveAuthHeadsElectrum(
  tokenIds: string[],
  provider: ElectrumNetworkProvider,
  prefix: CashAddressNetworkPrefix,
  linksLimit: number,
): Promise<Map<string, AuthHeadResult>> {
  const results = new Map<string, AuthHeadResult>();
  const queue = [...tokenIds];
  async function walkNext() {
    for (let tokenId = queue.shift(); tokenId !== undefined; tokenId = queue.shift()) {
      try {
        const links = await walkAuthchain(provider, tokenId, prefix);
        results.set(tokenId, await readAuthHead(provider, tokenId, links, linksLimit));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Authchain not resolved over electrum for ${tokenId}: ${reason}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENT_WALKS }, walkNext));
  return results;
}

// The whole chain with the outputs of every link, in the shape Chaingraph's links query returns
export async function queryAuthchainLinksElectrum(
  tokenId: string,
  provider: ElectrumNetworkProvider,
  prefix: CashAddressNetworkPrefix,
): Promise<AuthchainLink[]> {
  const links = await walkAuthchain(provider, tokenId, prefix);
  const heights = links.map(link => link.height).filter(height => height > 0);
  const headers = await provider.getHeaders([...new Set(heights)]);
  return links.map(link => {
    const timestamp = headers.get(link.height)?.timestamp;
    return {
      hash: link.hash,
      ...(timestamp ? { timestamp } : {}),
      outputs: link.transaction.outputs.map((output, index) => ({
        output_index: String(index),
        locking_bytecode: `\\x${binToHex(output.lockingBytecode)}`,
        token_category: output.token ? `\\x${binToHex(output.token.category)}` : null,
        fungible_token_amount: output.token ? output.token.amount.toString() : null,
      })),
    };
  });
}
