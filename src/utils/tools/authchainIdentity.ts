// The identities this wallet keeps custody of, stored in localStorage per wallet per network
// as a list of categories. Everything else about an identity - which output currently is the
// authhead, the name, the icon - is resolved at runtime, because the authhead moves every time the
// identity's metadata is updated and those updates happen outside this wallet.
// Every mention of the BCMR publication format lives here, so reading a publication off the chain
// and writing one cannot drift apart.

import type { Utxo } from "mainnet-js";
import { OpReturnData, TokenSendRequest } from "mainnet-js";
import { binToHex, binToUtf8, hexToBin, sha256, utf8ToBin } from "@bitauth/libauth";
import { queryAuthHeadWithOutputs, type AuthchainLink } from "src/queryChainGraph";
import { MetadataRegistrySchema } from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n';
const { t } = i18n.global;

type Network = 'mainnet' | 'chipnet';

// 'held' and 'carriesTokens' are both authheads this wallet holds directly and keeps out of coin
// selection; the second also carries a reserve or a minting NFT. 'heldViaKey' is an authhead
// locked in an AuthGuard covenant whose key NFT this wallet holds, which is authority over the
// identity without the coin. 'unresolved' is a failed
// Chaingraph query, which says nothing about where the authhead is.
export type IdentityStatus = 'held' | 'carriesTokens' | 'heldViaKey' | 'notHeld' | 'unresolved';

// What one run of the ownership scan over the wallet's token categories turned up
export interface IdentityScanSummary {
  found: number; // authheads newly added to the list
  alreadyListed: number; // categories the list already covered, which the scan skips
  carriesTokens: number; // of those found, the ones holding a token reserve alongside the authority
  failed: number; // categories whose lookup did not come back
  dismissed: number; // found, but left off because the user took them off before
  deepScanned: number; // held coins walked back to a genesis, which the held categories miss
}

export interface IdentityState {
  category: string;
  authheadTxid?: string;
  authUtxo?: Utxo; // the identity output itself, when this wallet holds it directly
  keyUtxo?: Utxo; // the AuthKey NFT, when a covenant holds the identity output instead
  guardedOutput?: Utxo; // the identity output inside that covenant
  guardAddress?: string; // where that covenant sits, which is not an address of this wallet
  status: IdentityStatus;
  unresolvedReason?: string; // what the lookup said went wrong, for an 'unresolved' one
  publication?: MetadataPublication; // absent when the authchain has never carried one
  // Every transaction of this identity's authchain, oldest first. Carried because the ordinary
  // transaction history reads it to recognise its own identity operations, which otherwise show
  // as inscrutable self-sends.
  links?: string[];
}

// The coin that holds the authority, whichever way this wallet has it. What gets reserved.
export function identityKeyCoin(identity: IdentityState): Utxo | undefined {
  return identity.authUtxo ?? identity.keyUtxo;
}

// An identity output found in an AuthGuard covenant this wallet has the key to, waiting for the
// authchain lookup to confirm it really is that category's authhead.
export interface GuardedIdentity {
  category: string;
  authheadTxid: string; // the txid of the identity output sitting in the guard
  identityOutput: Utxo; // that output, which carries the identity's reserve if it has one
  keyUtxo?: Utxo; // absent when the key is watched rather than held, which makes it a watched identity
  guardAddress: string;
}

// The metadata pointer an authhead transaction carries: OP_RETURN "BCMR" <hash> [<uri>...]. The
// hash commits to the registry file, which is why the hosting itself does not have to be trusted.
export interface MetadataPublication {
  hash: string; // hex
  uris: string[]; // as published, which per spec is the https:// prefix stripped
}

// What a fetch of one published location found. 'changed' means the location answered with
// something other than what the on-chain hash commits to: for an HTTPS location that is the
// hosted file having been edited since publication, and for an IPFS CID, which cannot serve
// different content, that its content never matched the hash it was published with.
export type PublicationUriStatus = 'verified' | 'changed' | 'unreachable';

export interface PublicationUriCheck {
  uri: string;
  status: PublicationUriStatus;
}

const BCMR_OUTPUT_PREFIX = "6a0442434d52";
// a publication location that hangs must not hang the page; the same bound the Chaingraph requests have
const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
// per spec, a bare domain names the registry at this well-known path
const WELL_KNOWN_REGISTRY_PATH = "/.well-known/bitcoin-cash-metadata-registry.json";

// The first output of the transaction that is a publication, which is the one the spec takes.
export function findPublication(outputs: string[]): MetadataPublication | undefined {
  for (const lockingBytecode of outputs) {
    const publication = parsePublicationOutput(lockingBytecode);
    if (publication) return publication;
  }
  return undefined;
}

// The chunks after "BCMR" are the hash and then the locations, all of them optional in the sense
// that a malformed output is simply not a publication this wallet reads.
export function parsePublicationOutput(lockingBytecode: string): MetadataPublication | undefined {
  if (!lockingBytecode.startsWith(BCMR_OUTPUT_PREFIX)) return undefined;
  const chunks = OpReturnData.parseBinary(hexToBin(lockingBytecode));
  const [, hashChunk, ...uriChunks] = chunks;
  if (!hashChunk?.length) return undefined;
  return {
    hash: binToHex(hashChunk),
    uris: uriChunks.map(chunk => binToUtf8(chunk)).filter(uri => uri.length > 0),
  };
}

// Where a published location is actually fetched from. The published form is the compact one the
// spec asks for, so an https:// prefix is stripped and a bare domain names the well-known path.
export function registryUrlOf(uri: string, ipfsGateway: string): string {
  if (uri.startsWith("ipfs://")) return ipfsGateway + uri.slice("ipfs://".length);
  // Per spec a bare domain means the well-known file on it, while anything naming a path is taken
  // as published. A trailing slash is such a path, the root itself, so the two forms differ.
  const location = uri.replace(/^https:\/\//, "");
  const namesAPath = location.includes("/");
  return `https://${location}${namesAPath ? "" : WELL_KNOWN_REGISTRY_PATH}`;
}

// The hash the wallet publishes for a registry file, and so also the one it verifies against:
// sha256 over the file's bytes exactly as served.
export function registryContentHash(content: string): string {
  return binToHex(sha256.hash(utf8ToBin(content)));
}

// Output 0 of every identity operation: the new authhead, carrying whatever the operation leaves
// on it. Spending the old one and recreating it here is what continues the authchain.
// A token output of amount zero is only valid while it carries an NFT, so an emptied reserve on an
// authhead without one becomes a plain BCH output, which is the layout the CLI calls
// keepReservedSupply: false.
export function identityOutput(
  authUtxo: Utxo,
  addresses: { bch: string, token: string },
  reserve?: bigint,
) {
  const token = authUtxo.token;
  const remaining = reserve ?? token?.amount ?? 0n;
  if (!token || (remaining === 0n && !token.nft)) {
    return { cashaddr: addresses.bch, value: authUtxo.satoshis };
  }
  return new TokenSendRequest({
    cashaddr: addresses.token,
    category: token.category,
    amount: remaining,
    value: authUtxo.satoshis,
    ...(token.nft ? { nft: { commitment: token.nft.commitment, capability: token.nft.capability } } : {}),
  });
}

// What a token output kept behind by a transfer carries in BCH, the same as a genesis gives one
const keptTokenOutputValue = 1000n;

// A transfer is the same spend as every other operation, with the new authhead at the destination
// instead of here. What the old one carried either goes with it or stays: a reserve that stays
// becomes ordinary supply of this wallet, and a minting NFT that stays keeps its authority here.
export function transferOutputs(
  authUtxo: Utxo,
  destination: string,
  addresses: { bch: string, token: string },
  tokensGoAlong: boolean,
) {
  const token = authUtxo.token;
  if (!token) return [{ cashaddr: destination, value: authUtxo.satoshis }];
  const carried = (cashaddr: string, value: bigint) => new TokenSendRequest({
    cashaddr,
    category: token.category,
    amount: token.amount,
    value,
    ...(token.nft ? { nft: { commitment: token.nft.commitment, capability: token.nft.capability } } : {}),
  });
  if (tokensGoAlong) return [carried(destination, authUtxo.satoshis)];
  return [
    { cashaddr: destination, value: authUtxo.satoshis },
    carried(addresses.token, keptTokenOutputValue),
  ];
}

// The metadata pointer itself: OP_RETURN "BCMR" <hash> [<uri>...], the same shape this module reads
export function publicationOutput(hash: string, uris: string[]) {
  return OpReturnData.fromArray(["BCMR", hexToBin(hash), ...uris]);
}

// The registry as currently published, for saying what an update changes. The first location that
// answers is enough: the hash check that has to hold happens against the candidate, not this.
export async function fetchPublishedRegistry(
  uris: string[],
  ipfsGateway: string,
): Promise<string | undefined> {
  for (const uri of uris) {
    const content = await fetchRegistryText(uri, ipfsGateway);
    // a location that does not answer is not the one to read the current file from
    if (content !== undefined) return content;
  }
  return undefined;
}

// What one publication output may take up. The hash and the locations share it, so the number of
// locations is capped by their length rather than by the form. Standardness allows 223 bytes of
// data carrier; the ceiling that actually applies is mainnet-js's own builder, which refuses more
// than 220, so that is the number the form is held to.
export const maxPublicationOutputSize = 220;

// Only its length matters: the size of a publication does not depend on which hash it carries
const placeholderHash = "00".repeat(32);

// Measured on the real output rather than by mirroring the encoder's rules, one location at a
// time so that a set too large for a single output can still be sized: each location is one push,
// so the parts add up to the whole.
export function publicationOutputSize(uris: string[]): number {
  const withoutLocations = publicationOutput(placeholderHash, []).buffer.length;
  return uris.reduce((total, uri) => {
    try {
      return total + publicationOutput(placeholderHash, [uri]).buffer.length - withoutLocations;
    } catch {
      // a location the encoder refuses on its own is past the budget whatever the others cost
      return total + maxPublicationOutputSize;
    }
  }, withoutLocations);
}

// What the wallet reads out of a registry to say what an update changes. Undefined when the file
// is not a registry, or names no identity for this authbase, which is the wrong-file mistake.
export interface RegistrySummary {
  name: string;
  symbol?: string;
  decimals?: number;
  iconUri?: string;
  snapshots: string[]; // the identity history timestamps, oldest first
}

export function summarizeRegistry(content: string, authbase: string): RegistrySummary | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const registry = MetadataRegistrySchema.safeParse(parsed);
  if (!registry.success) return undefined;
  const history = registry.data.identities?.[authbase];
  if (!history) return undefined;
  const snapshots = Object.keys(history).sort();
  const latest = snapshots.length ? history[snapshots[snapshots.length - 1]!] : undefined;
  if (!latest) return undefined;
  return {
    name: latest.name,
    ...(latest.token?.symbol !== undefined ? { symbol: latest.token.symbol } : {}),
    ...(latest.token?.decimals !== undefined ? { decimals: latest.token.decimals } : {}),
    ...(latest.uris?.icon !== undefined ? { iconUri: latest.uris.icon } : {}),
    snapshots,
  };
}

// The differences an update makes that holders will see, and the ones the wallet warns about.
export interface RegistryDiff {
  changed: { field: 'name' | 'symbol' | 'decimals' | 'icon'; from: string; to: string }[];
  droppedSnapshots: string[]; // history the current publication has and the new file does not
}

export function diffRegistries(current: RegistrySummary, candidate: RegistrySummary): RegistryDiff {
  const fields = [
    { field: 'name' as const, from: current.name, to: candidate.name },
    { field: 'symbol' as const, from: current.symbol, to: candidate.symbol },
    { field: 'decimals' as const, from: current.decimals, to: candidate.decimals },
    { field: 'icon' as const, from: current.iconUri, to: candidate.iconUri },
  ];
  return {
    changed: fields
      .filter(entry => entry.from !== entry.to)
      .map(entry => ({ field: entry.field, from: String(entry.from ?? ''), to: String(entry.to ?? '') })),
    // the common generator writes a fresh single-snapshot registry, which silently drops the
    // identity's history rather than appending to it
    droppedSnapshots: current.snapshots.filter(snapshot => !candidate.snapshots.includes(snapshot)),
  };
}

// One registry, however many mirrors: every location has to serve byte-identical content, so the
// hash published commits to all of them at once. Fetched fresh, like the badge checks.
export interface CandidateRegistry {
  hash: string;
  content: string;
}

export async function fetchCandidateRegistry(
  uris: string[],
  ipfsGateway: string,
): Promise<CandidateRegistry> {
  if (!uris.length) throw new Error(t('identities.publish.errors.noUris'));
  const fetched = await Promise.all(uris.map(async uri => {
    const content = await fetchRegistryText(uri, ipfsGateway);
    if (content === undefined) throw new Error(t('identities.publish.errors.unreachable', { uri }));
    return { uri, content, hash: registryContentHash(content) };
  }));
  const first = fetched[0]!;
  const mismatch = fetched.find(entry => entry.hash !== first.hash);
  if (mismatch) throw new Error(t('identities.publish.errors.mirrorMismatch', { uri: mismatch.uri }));
  return { hash: first.hash, content: first.content };
}

// Always a fresh fetch, never the metadata cache: every caller here is asking what a location
// serves right now, which a cached copy cannot answer. Undefined when it does not answer at all.
async function fetchRegistryText(uri: string, ipfsGateway: string): Promise<string | undefined> {
  try {
    const response = await fetch(registryUrlOf(uri, ipfsGateway), {
      cache: "no-store",
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

export async function checkPublicationUri(
  uri: string,
  expectedHash: string,
  ipfsGateway: string,
): Promise<PublicationUriCheck> {
  const content = await fetchRegistryText(uri, ipfsGateway);
  if (content === undefined) return { uri, status: 'unreachable' };
  return { uri, status: registryContentHash(content) === expectedHash ? 'verified' : 'changed' };
}

// What this feature persists, all of it per wallet per network and all of it a set of ids. The
// lists hold categories or txids and share one storage shape; the naming map is the exception,
// keyed by txid because each entry carries how far its naming got.
const identityListKeys = {
  // identities the wallet follows, which is what gets resolved and reserved
  categories: 'identities',
  // AuthKey categories it watches without holding the key, whose guards it follows anyway
  authKeys: 'authKeys',
  // what the user took off the list: a decision, so it is stored rather than re-derived, or the
  // automatic detection would put back on every open what the user just removed
  dismissed: 'dismissedIdentities',
  // listed by the wallet itself and not yet seen by the user, so a coin quietly becoming
  // unspendable is not the first they hear of it
  unseen: 'unseenIdentities',
  // key candidates already put to the user once. Only the asking is remembered: whether one
  // really guards anything is re-derived every session, since a covenant can be filled later
  examinedKeys: 'examinedKeyCandidates',
  // whether this wallet has had the one dialog that says it holds identities it never listed;
  // a single marker, kept as a list for the shared storage shape
  announced: 'identitiesAnnounced',
} as const;

export type IdentityList = keyof typeof identityListKeys;

function listKey(list: IdentityList, network: Network, walletName: string): string {
  return `${identityListKeys[list]}-${network}-${walletName}`;
}

function readList(key: string): string[] {
  const stored = localStorage.getItem(key);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

export function loadIdentityList(list: IdentityList, network: Network, walletName: string): string[] {
  return readList(listKey(list, network, walletName));
}

// Fresh read-modify-write throughout: another tab may have written since this one loaded, so every
// change re-reads and touches only the entries in hand. Returns the list for the caller's state.
export function addToIdentityList(
  list: IdentityList,
  network: Network,
  walletName: string,
  entries: string | string[],
): string[] {
  const key = listKey(list, network, walletName);
  const stored = readList(key);
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    if (!stored.includes(entry)) stored.push(entry);
  }
  localStorage.setItem(key, JSON.stringify(stored));
  return stored;
}

export function removeFromIdentityList(
  list: IdentityList,
  network: Network,
  walletName: string,
  entry: string,
): string[] {
  const key = listKey(list, network, walletName);
  const remaining = readList(key).filter(stored => stored !== entry);
  localStorage.setItem(key, JSON.stringify(remaining));
  return remaining;
}

export function clearIdentityList(list: IdentityList, network: Network, walletName: string) {
  localStorage.removeItem(listKey(list, network, walletName));
}

// Authheads this wallet holds and protects without a name: a BCH-only chain carries nothing on its
// identity output to say which identity it is. Protection does not wait on naming, so an entry
// here is reserved either way, and how far its naming got only decides whether to walk it again.
// 'walkConcluded' is a walk that reached an answer without finding a genesis, remembered by the
// authhead's txid so it self-invalidates: an authhead that moves has a new txid and earns a fresh
// walk. A walk that could not fetch a hop is never remembered, or one outage would give up forever.
export type AuthheadNaming = 'pending' | 'walkConcluded';

function namingKey(network: Network, walletName: string): string {
  return `authheadNaming-${network}-${walletName}`;
}

export function loadAuthheadNaming(network: Network, walletName: string): Record<string, AuthheadNaming> {
  const stored = localStorage.getItem(namingKey(network, walletName));
  if (!stored) return {};
  try {
    return JSON.parse(stored) as Record<string, AuthheadNaming>;
  } catch {
    return {};
  }
}

export function saveAuthheadNaming(
  network: Network,
  walletName: string,
  txid: string,
  naming: AuthheadNaming,
): Record<string, AuthheadNaming> {
  const stored = loadAuthheadNaming(network, walletName);
  stored[txid] = naming;
  localStorage.setItem(namingKey(network, walletName), JSON.stringify(stored));
  return stored;
}

// Named at last, or the user asked for the coin back: either way it stops being one of these
export function deleteAuthheadNaming(
  network: Network,
  walletName: string,
  txid: string,
): Record<string, AuthheadNaming> {
  const stored = loadAuthheadNaming(network, walletName);
  delete stored[txid];
  localStorage.setItem(namingKey(network, walletName), JSON.stringify(stored));
  return stored;
}

// A future wallet created under the same name must not inherit the old wallet's identities
export function removeIdentityCategories(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    for (const list of Object.keys(identityListKeys) as IdentityList[]) {
      clearIdentityList(list, network, walletName);
    }
    localStorage.removeItem(namingKey(network, walletName));
  }
}

export function isTokenCategory(category: string): boolean {
  return /^[0-9a-f]{64}$/i.test(category);
}

// What one link of an authchain did, read off its outputs. The chain is the identity's whole
// history, and the explorer shows it raw; what the wallet can add is what each step meant, which
// its outputs say: a link carrying a BCMR output published metadata, and the reserve riding on the
// identity output before and after says whether supply was issued, added back, or moved off.
export type ChainLinkKind =
  | 'genesis'
  | 'publication'
  | 'issue'
  | 'addToReserve'
  | 'emptyReserve'
  | 'transfer'
  | 'operation';

export interface DescribedLink {
  hash: string;
  timestamp?: number;
  kind: ChainLinkKind;
  reserve: bigint; // what the identity output carries after this link
  reserveDelta: bigint; // and how that changed, which is the issuance schedule read down the list
  publication?: MetadataPublication;
}

function identityOutputOf(link: AuthchainLink) {
  return link.outputs.find(output => output.output_index === "0");
}

export function describeChainLinks(links: AuthchainLink[]): DescribedLink[] {
  let previousReserve = 0n;
  let previousLock: string | undefined;
  return links.map((link, index) => {
    const identityOutput = identityOutputOf(link);
    const reserve = BigInt(identityOutput?.fungible_token_amount ?? 0);
    const reserveDelta = reserve - previousReserve;
    const publication = findPublication(
      link.outputs.map(output => output.locking_bytecode.replace(/^\\x/, ""))
    );
    const movedAddress = previousLock !== undefined && identityOutput?.locking_bytecode !== previousLock;

    let kind: ChainLinkKind = 'operation';
    if (index === 0) kind = 'genesis';
    else if (publication) kind = 'publication';
    else if (reserveDelta < 0n) kind = reserve === 0n ? 'emptyReserve' : 'issue';
    else if (reserveDelta > 0n) kind = 'addToReserve';
    else if (movedAddress) kind = 'transfer';

    previousReserve = reserve;
    previousLock = identityOutput?.locking_bytecode;
    return {
      hash: link.hash,
      ...(link.timestamp ? { timestamp: link.timestamp } : {}),
      kind,
      reserve,
      reserveDelta,
      ...(publication ? { publication } : {}),
    };
  });
}

// Resolves where each category's authhead sits now and whether this wallet holds it. Queries run
// in parallel and a failed one only marks its own category 'unresolved', so one unreachable answer
// does not cost the others. Shared by the identities list and the ownership scan.
export async function resolveIdentities(
  categories: string[],
  chaingraphUrl: string,
  walletUtxos: Utxo[],
  guarded: Record<string, GuardedIdentity> = {},
): Promise<IdentityState[]> {
  const authheadResults = await Promise.allSettled(
    categories.map(category => queryAuthHeadWithOutputs(category, chaingraphUrl))
  );

  return categories.map((category, index) => {
    const result = authheadResults[index];
    if (result?.status === 'rejected') {
      console.error("Failed to resolve authchain identity:", category, result.reason);
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return { category, status: 'unresolved', unresolvedReason: reason };
    }
    if (result?.status !== 'fulfilled') return { category, status: 'unresolved' };
    const { txid: authheadTxid, publicationOutputs, links } = result.value;
    const publication = findPublication(publicationOutputs);
    const resolved = { category, authheadTxid, links, ...(publication ? { publication } : {}) };
    // The authhead is always output 0 of the authchain's latest transaction
    const authUtxo = walletUtxos.find(utxo => utxo.txid === authheadTxid && utxo.vout === 0);
    if (authUtxo?.token) return { ...resolved, authUtxo, status: 'carriesTokens' };
    if (authUtxo) return { ...resolved, authUtxo, status: 'held' };
    // Held through a covenant instead: the guard holds an identity output, and this says it is
    // the one the authchain ends at rather than an older link somebody left there.
    const guardedIdentity = guarded[category];
    if (guardedIdentity?.authheadTxid === authheadTxid) {
      const { keyUtxo, guardAddress, identityOutput } = guardedIdentity;
      const guarded = { ...resolved, guardedOutput: identityOutput, guardAddress };
      // without the key this is somebody else's identity, watched from here like any other
      if (!keyUtxo) return { ...guarded, status: 'notHeld' };
      return { ...guarded, keyUtxo, status: 'heldViaKey' };
    }
    return { ...resolved, status: 'notHeld' };
  });
}
