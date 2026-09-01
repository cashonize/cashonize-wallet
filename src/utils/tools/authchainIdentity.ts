// The token identities this wallet keeps custody of, stored in localStorage per wallet per network
// as a list of categories. Everything else about an identity - which output currently is the
// authhead, the name, the icon - is resolved at runtime, because the authhead moves every time the
// identity's metadata is updated and those updates happen outside this wallet.

import type { Utxo } from "mainnet-js";
import { OpReturnData, TokenSendRequest } from "mainnet-js";
import { binToHex, binToUtf8, hexToBin, sha256, utf8ToBin } from "@bitauth/libauth";
import { queryAuthHeadWithPublication } from "src/queryChainGraph";
import type { Registry } from "src/parsing/bcmr-v2.schema";
import { i18n } from 'src/boot/i18n';
const { t } = i18n.global;

type Network = 'mainnet' | 'chipnet';

// 'held' and 'carriesTokens' are both authheads this wallet holds and keeps out of coin selection;
// they are told apart because an authhead carrying a token reserve has no transfer of its own yet.
// 'unresolved' is a failed Chaingraph query, which says nothing about where the authhead is.
export type IdentityStatus = 'held' | 'carriesTokens' | 'notHeld' | 'unresolved';

// What one run of the ownership scan over the wallet's token categories turned up
export interface IdentityScanSummary {
  found: number; // authheads newly added to the list
  alreadyListed: number; // categories the list already covered, which the scan skips
  carriesTokens: number; // of those found, the ones holding a token reserve alongside the authority
  failed: number; // categories whose lookup did not come back
}

export interface IdentityState {
  category: string;
  authheadTxid?: string;
  authUtxo?: Utxo; // the coin the 'auth' reservation is made on, whenever the wallet holds it
  status: IdentityStatus;
  publication?: MetadataPublication; // absent when the authchain has never carried one
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
// per spec, a bare domain names the registry at this well-known path
const WELL_KNOWN_REGISTRY_PATH = "/.well-known/bitcoin-cash-metadata-registry.json";

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
  // a location naming no file is a bare domain, which per spec means the well-known path on it
  const location = uri.replace(/^https:\/\//, "").replace(/\/$/, "");
  const namesAFile = location.includes("/");
  return `https://${location}${namesAFile ? "" : WELL_KNOWN_REGISTRY_PATH}`;
}

// The hash the wallet publishes for a registry file, and so also the one it verifies against:
// sha256 over the file's bytes exactly as served.
export function registryContentHash(content: string): string {
  return binToHex(sha256.hash(utf8ToBin(content)));
}

// Output 0 of every identity operation: the new authhead, carrying whatever the operation leaves
// on it. Spending the old one as input 0 and recreating it here is what continues the authchain.
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
    try {
      const response = await fetch(registryUrlOf(uri, ipfsGateway), { cache: "no-store" });
      if (response.ok) return await response.text();
    } catch { /* a location that does not answer is not the one to read the current file from */ }
  }
  return undefined;
}

// What one publication output may take up. The hash and the locations share the standard
// data-carrier limit, so the number of locations is capped by their length rather than by the form.
export const maxPublicationOutputSize = 220;

// Mirrors how mainnet-js encodes the output: OP_RETURN, then a length-prefixed push per chunk,
// two bytes of prefix once a chunk reaches 76 bytes.
export function publicationOutputSize(uris: string[]): number {
  const pushSize = (length: number) => (length < 76 ? 1 : 2) + length;
  const bcmrPrefix = pushSize(4);
  const hash = pushSize(32);
  const locations = uris.reduce((total, uri) => total + pushSize(utf8ToBin(uri).length), 0);
  return 1 + bcmrPrefix + hash + locations;
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
  let registry: Registry;
  try {
    registry = JSON.parse(content) as Registry;
  } catch {
    return undefined;
  }
  const history = registry.identities?.[authbase];
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
    let content: string;
    try {
      const response = await fetch(registryUrlOf(uri, ipfsGateway), { cache: "no-store" });
      if (!response.ok) throw new Error();
      content = await response.text();
    } catch {
      throw new Error(t('identities.publish.errors.unreachable', { uri }));
    }
    return { uri, content, hash: registryContentHash(content) };
  }));
  const first = fetched[0]!;
  const mismatch = fetched.find(entry => entry.hash !== first.hash);
  if (mismatch) throw new Error(t('identities.publish.errors.mirrorMismatch', { uri: mismatch.uri }));
  return { hash: first.hash, content: first.content };
}

// Fetched rather than read from the metadata cache on purpose: the question is what the host is
// serving now, which a cached copy cannot answer.
export async function checkPublicationUri(
  uri: string,
  expectedHash: string,
  ipfsGateway: string,
): Promise<PublicationUriCheck> {
  try {
    const response = await fetch(registryUrlOf(uri, ipfsGateway), { cache: "no-store" });
    if (!response.ok) return { uri, status: 'unreachable' };
    const content = await response.text();
    return { uri, status: registryContentHash(content) === expectedHash ? 'verified' : 'changed' };
  } catch {
    return { uri, status: 'unreachable' };
  }
}

function identitiesKey(network: Network, walletName: string): string {
  return `identities-${network}-${walletName}`;
}

export function loadIdentityCategories(network: Network, walletName: string): string[] {
  const readCategories = localStorage.getItem(identitiesKey(network, walletName));
  if (!readCategories) return [];
  try {
    return JSON.parse(readCategories) as string[];
  } catch {
    return [];
  }
}

// Fresh read-modify-write: another tab may have added or removed an identity since this tab loaded
// them, so re-read before writing to only ever change the single category in hand.
// Returns the updated list for the caller's reactive state.
export function saveIdentityCategory(network: Network, walletName: string, category: string): string[] {
  const categories = loadIdentityCategories(network, walletName);
  if (!categories.includes(category)) categories.push(category);
  localStorage.setItem(identitiesKey(network, walletName), JSON.stringify(categories));
  return categories;
}

// Same fresh read-modify-write approach as saveIdentityCategory.
export function deleteIdentityCategory(network: Network, walletName: string, category: string): string[] {
  const categories = loadIdentityCategories(network, walletName).filter(listed => listed !== category);
  localStorage.setItem(identitiesKey(network, walletName), JSON.stringify(categories));
  return categories;
}

// A future wallet created under the same name must not inherit the old wallet's identities
export function removeIdentityCategories(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(identitiesKey(network, walletName));
  }
}

export function isTokenCategory(category: string): boolean {
  return /^[0-9a-f]{64}$/i.test(category);
}

// Resolves where each category's authhead sits now and whether this wallet holds it. Queries run
// in parallel and a failed one only marks its own category 'unresolved', so one unreachable answer
// does not cost the others. Shared by the identities list and the ownership scan.
export async function resolveIdentities(
  categories: string[],
  chaingraphUrl: string,
  walletUtxos: Utxo[],
): Promise<IdentityState[]> {
  const authheadResults = await Promise.allSettled(
    categories.map(category => queryAuthHeadWithPublication(category, chaingraphUrl))
  );

  return categories.map((category, index) => {
    const result = authheadResults[index];
    if (result?.status === 'rejected') {
      console.error("Failed to resolve authchain identity:", category, result.reason);
    }
    if (result?.status !== 'fulfilled') return { category, status: 'unresolved' };
    const { txid: authheadTxid, publicationOutput } = result.value;
    const publication = publicationOutput ? parsePublicationOutput(publicationOutput) : undefined;
    const resolved = { category, authheadTxid, ...(publication ? { publication } : {}) };
    // The authhead is always output 0 of the authchain's latest transaction
    const authUtxo = walletUtxos.find(utxo => utxo.txid === authheadTxid && utxo.vout === 0);
    if (!authUtxo) return { ...resolved, status: 'notHeld' };
    if (authUtxo.token) return { ...resolved, authUtxo, status: 'carriesTokens' };
    return { ...resolved, authUtxo, status: 'held' };
  });
}
