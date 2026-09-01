// The token identities this wallet keeps custody of, stored in localStorage per wallet per network
// as a list of categories. Everything else about an identity - which output currently is the
// authhead, the name, the icon - is resolved at runtime, because the authhead moves every time the
// identity's metadata is updated and those updates happen outside this wallet.

import type { Utxo } from "mainnet-js";
import { OpReturnData } from "mainnet-js";
import { binToHex, binToUtf8, hexToBin, sha256, utf8ToBin } from "@bitauth/libauth";
import { queryAuthHeadWithPublication } from "src/queryChainGraph";

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
