// The identities this wallet keeps custody of, stored in localStorage per wallet per network
// as a list of categories. Everything else about an identity - which output currently is the
// authhead, the name, the icon - is resolved at runtime, because the authhead moves every time the
// identity's metadata is updated and those updates happen outside this wallet.
// Every mention of the BCMR publication format lives here, so reading a publication off the chain
// and writing one cannot drift apart.

import type { Utxo } from "mainnet-js";
import { OpReturnData, TokenSendRequest, type NFTCapability } from "mainnet-js";
import { binToHex, binToUtf8, hexToBin, sha256, utf8ToBin } from "@bitauth/libauth";
import { queryAuthHeadWithOutputs, queryAuthHeadsWithOutputs, type AuthchainLink, type AuthHeadResult } from "src/queryChainGraph";
import { MetadataRegistrySchema } from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n';
const { t } = i18n.global;

type Network = 'mainnet' | 'chipnet';

// 'held' is an authhead this wallet holds directly and keeps out of coin selection; what it carries,
// a reserve or a minting NFT, is on the UTXO itself. 'heldViaKey' is an authhead locked in an
// AuthGuard covenant whose key NFT this wallet holds, which is authority over the identity without
// the UTXO. 'unresolved' is a failed Chaingraph query, which says nothing about where the authhead is.
export type IdentityStatus = 'held' | 'heldViaKey' | 'notHeld' | 'unresolved';

export interface IdentityState {
  category: string;
  authheadTxid?: string;
  authUtxo?: Utxo; // the identity output itself, when this wallet holds it directly
  keyUtxo?: Utxo; // the AuthKey NFT, when a covenant holds the identity output instead
  guardedOutput?: Utxo; // the identity output inside that covenant
  guardAddress?: string; // where that covenant sits, which is not an address of this wallet
  status: IdentityStatus;
  unresolvedReason?: string; // what the lookup said went wrong, for an 'unresolved' one
  // whether the category has fungible tokens at all, read off its genesis: a reserve is only
  // possible for one that does, whatever the wallet holds of it right now
  fungibleSupply?: boolean;
  publication?: MetadataPublication; // absent when the authchain has never carried one
  // Every transaction of this identity's authchain, oldest first. Carried because the ordinary
  // transaction history reads it to recognise its own identity operations, which otherwise show
  // as inscrutable self-sends.
  links?: string[];
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
  value = authUtxo.satoshis,
) {
  const token = authUtxo.token;
  const remaining = reserve ?? token?.amount ?? 0n;
  if (!token || (remaining === 0n && !token.nft)) {
    return { cashaddr: addresses.bch, value };
  }
  return new TokenSendRequest({
    cashaddr: addresses.token,
    category: token.category,
    amount: remaining,
    value,
    ...(token.nft ? { nft: { commitment: token.nft.commitment, capability: token.nft.capability } } : {}),
  });
}

// What a token output kept behind by a transfer carries in BCH, the same as a genesis gives one
const keptTokenOutputValue = 1000n;

// A mint from an identity UTXO is an authchain operation like the rest: the identity output
// first, keeping the minting NFT and any reserve here, then the minted NFTs. mainnet-js's
// tokenMint happens to order a mint this way; building it here makes that the rule rather than luck.
export function mintOutputs(
  authUtxo: Utxo,
  addresses: { bch: string, token: string },
  mints: { cashaddr: string; commitment: string; capability: string; value: bigint }[],
) {
  // the minted NFTs are of the identity UTXO's own category, which is why it has to carry one
  const category = authUtxo.token?.category;
  if (!category) throw new Error("not a token identity UTXO");
  return [
    identityOutput(authUtxo, addresses),
    ...mints.map(mint => new TokenSendRequest({
      cashaddr: mint.cashaddr,
      category,
      nft: { commitment: mint.commitment, capability: mint.capability as NFTCapability },
      value: mint.value,
    })),
  ];
}

// A transfer is the same spend as every other operation, with the new authhead at the destination
// instead of here. What the old one carried either goes with it or stays: a reserve that stays
// becomes ordinary supply of this wallet, and a minting NFT that stays keeps its authority here.
export function transferOutputs(
  authUtxo: Utxo,
  destination: string,
  addresses: { bch: string, token: string },
  tokensGoAlong: boolean,
) {
  if (!authUtxo.token) return [{ cashaddr: destination, value: authUtxo.satoshis }];
  if (tokensGoAlong) return [identityOutput(authUtxo, { bch: destination, token: destination })];
  return [
    { cashaddr: destination, value: authUtxo.satoshis },
    identityOutput(authUtxo, addresses, undefined, keptTokenOutputValue),
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
): Promise<PublicationUriStatus> {
  const content = await fetchRegistryText(uri, ipfsGateway);
  if (content === undefined) return 'unreachable';
  return registryContentHash(content) === expectedHash ? 'verified' : 'changed';
}

// The lists this feature persists, all of them per wallet per network and all of them ids,
// categories or txids, in one storage shape
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
  // authheads held and protected without a name: a BCH-only chain carries nothing on its identity
  // output to say which identity it is. Keyed by txid, so an authhead that moves earns a fresh walk.
  unnamed: 'unnamedAuthheads',
} as const;

// What the wallet last saw of each followed token identity, per wallet per network: the authhead
// and the publication, which is what a later diff reads and what says a category was looked up.
// Written whole, merged over what another tab stored since, and only ever from a fulfilled lookup.
export interface FollowedIdentity {
  authheadTxid: string;
  publicationHash?: string;
}
export type FollowedIdentities = Record<string, FollowedIdentity>;
function followedKey(network: Network, walletName: string): string {
  return `followedIdentities-${network}-${walletName}`;
}
export function loadFollowed(network: Network, walletName: string): FollowedIdentities {
  const stored = localStorage.getItem(followedKey(network, walletName));
  if (!stored) return {};
  try {
    return JSON.parse(stored) as FollowedIdentities;
  } catch {
    return {};
  }
}
export function saveFollowed(network: Network, walletName: string, followed: FollowedIdentities) {
  const merged = { ...loadFollowed(network, walletName), ...followed };
  localStorage.setItem(followedKey(network, walletName), JSON.stringify(merged));
}

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


// A future wallet created under the same name must not inherit the old wallet's identities
export function removeIdentityCategories(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    for (const list of Object.keys(identityListKeys) as IdentityList[]) {
      clearIdentityList(list, network, walletName);
    }
    localStorage.removeItem(followedKey(network, walletName));
    // the once-per-wallet dialog gate an earlier version kept
    localStorage.removeItem(`identitiesAnnounced-${network}-${walletName}`);
  }
}

// What one link of an authchain did, read off its outputs. The chain is the identity's whole
// history, and the explorer shows it raw; what the wallet can add is what each step meant, which
// its outputs say: a link carrying a BCMR output published metadata, and the reserve riding on the
// identity output before and after says how much supply moved.
export type ChainLinkKind = 'genesis' | 'publication' | 'mint' | 'transfer' | 'operation';

export interface DescribedLink {
  hash: string;
  timestamp?: number;
  kind: ChainLinkKind;
  reserveDelta: bigint; // and how that changed, which is the issuance schedule read down the list
  minted?: number; // NFTs of the category this link created beside the identity output
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

    // outputs of the category beside the identity output, with the reserve unchanged, are minted
    // NFTs; a reserve move also has them, and is told apart by the reserve changing. A transfer
    // that keeps a minting NFT behind looks the same and reads as a mint: telling those apart
    // needs the wallet's addresses, which this does not have.
    const minted = link.outputs.filter(output =>
      output.output_index !== "0" && output.token_category && output.token_category === identityOutput?.token_category
    ).length;
    let kind: ChainLinkKind = 'operation';
    if (index === 0) kind = 'genesis';
    else if (publication) kind = 'publication';
    else if (reserveDelta === 0n && minted) kind = 'mint';
    else if (reserveDelta === 0n && movedAddress) kind = 'transfer';

    previousReserve = reserve;
    previousLock = identityOutput?.locking_bytecode;
    return {
      hash: link.hash,
      ...(link.timestamp ? { timestamp: link.timestamp } : {}),
      kind,
      reserveDelta,
      ...(kind === 'mint' ? { minted } : {}),
      ...(publication ? { publication } : {}),
    };
  });
}

// Resolves where each category's authhead sits now and whether this wallet holds it. The lookups
// go in batches, one request after another: a public Chaingraph instance limits request size and
// rate, and each answer carries the chain's history. A batch that fails marks only its own
// categories 'unresolved' and does not stop the next; a category the server does not know is
// unresolved on its own. Shared by the identities list and the followed token identities.
export const authheadBatchSize = 25;
export async function resolveIdentities(
  categories: string[],
  chaingraphUrl: string,
  walletUtxos: Utxo[],
  guarded: Record<string, GuardedIdentity> = {},
): Promise<IdentityState[]> {
  const answers = new Map<string, { value?: AuthHeadResult; reason: string }>();
  for (let start = 0; start < categories.length; start += authheadBatchSize) {
    const batch = categories.slice(start, start + authheadBatchSize);
    try {
      const answered = await queryAuthHeadsWithOutputs(batch, chaingraphUrl);
      for (const category of batch) {
        const value = answered.get(category);
        answers.set(category, value ? { value, reason: '' } : { reason: t('chaingraph.errors.tokenNotFound') });
      }
    } catch (error) {
      console.error("Failed to resolve authchain identities:", batch, error);
      const reason = error instanceof Error ? error.message : String(error);
      for (const category of batch) answers.set(category, { reason });
    }
  }

  return categories.map(category => {
    const answer = answers.get(category);
    if (!answer?.value) {
      return { category, status: 'unresolved', ...(answer ? { unresolvedReason: answer.reason } : {}) };
    }
    const { txid: authheadTxid, publicationOutputs, links, fungibleSupply } = answer.value;
    const publication = findPublication(publicationOutputs);
    const resolved = { category, authheadTxid, links, fungibleSupply, ...(publication ? { publication } : {}) };
    // The authhead is always output 0 of the authchain's latest transaction
    const authUtxo = walletUtxos.find(utxo => utxo.txid === authheadTxid && utxo.vout === 0);
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

// Naming a coin from the registry its own chain published, forward at every step: the authhead
// query rooted at the coin's transaction returns the last publication on that chain, the file it
// points at is fetched and hashed against it, and every identity the file names is resolved
// forward; the one whose chain ends at this coin is the name. The registry is consulted, never
// trusted: the hash binds the file to the chain, and the forward resolution binds the name to the
// coin. It reaches hosting, so it is the caller's to run on a visit rather than at open.
const maxNamedIdentities = 20;
export async function nameChainFromRegistry(
  authheadTxid: string,
  chaingraphUrl: string,
  ipfsGateway: string,
): Promise<string | undefined> {
  const { publicationOutputs } = await queryAuthHeadWithOutputs(authheadTxid, chaingraphUrl);
  const publication = findPublication(publicationOutputs);
  if (!publication) return undefined;
  let registry: CandidateRegistry;
  try {
    registry = await fetchCandidateRegistry(publication.uris, ipfsGateway);
  } catch {
    return undefined;
  }
  if (registry.hash !== publication.hash) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(registry.content);
  } catch {
    return undefined;
  }
  const result = MetadataRegistrySchema.safeParse(parsed);
  if (!result.success) return undefined;
  const candidates = Object.keys(result.data.identities ?? {})
    .filter(candidate => /^[0-9a-f]{64}$/i.test(candidate))
    .slice(0, maxNamedIdentities);
  for (const candidate of candidates) {
    const resolved = await queryAuthHeadWithOutputs(candidate, chaingraphUrl)
      .then(chain => chain.txid)
      .catch(() => undefined);
    if (resolved === authheadTxid) return candidate;
  }
  return undefined;
}
