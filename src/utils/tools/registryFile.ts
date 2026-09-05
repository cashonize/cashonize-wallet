// The hosted registry file a publication points at: where it is fetched from, how it is hashed
// against the chain, and what the wallet reads out of it to show a publisher. Nothing here
// touches the chain; the publication output that carries the hash is authchainIdentity's.

import { binToHex, binToUtf8, sha256 } from "@bitauth/libauth";
import { MetadataRegistrySchema } from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n';
const { t } = i18n.global;

// Where a registry is written: the form for a token's; the schema and the example registries for
// one written by hand. The docs are the standard rendered for reading, rather than the markdown.
export const BCMR_GENERATOR_URL = "https://bcmr-generator.app/";
export const BCMR_SCHEMA_URL = "https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.json";
export const BCMR_EXAMPLES_URL = "https://cashtokens.org/docs/bcmr/examples";
export const BCMR_DOCS_URL = "https://cashtokens.org/docs/category/metadata-registries-chip";

// What a fetch of one published location found. 'changed' means the location answered with
// something other than what the on-chain hash commits to: for an HTTPS location that is the
// hosted file having been edited since publication, and for an IPFS CID, which cannot serve
// different content, that its content never matched the hash it was published with.
export type PublicationUriStatus = 'verified' | 'changed' | 'unreachable';

// a publication location that hangs must not hang the page; the same bound the Chaingraph requests have
const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
// per spec, a bare domain names the registry at this well-known path
const WELL_KNOWN_REGISTRY_PATH = "/.well-known/bitcoin-cash-metadata-registry.json";

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
export function registryContentHash(content: Uint8Array): string {
  return binToHex(sha256.hash(content));
}

// Always a fresh fetch, never the metadata cache: every caller here is asking what a location
// serves right now, which a cached copy cannot answer. Undefined when it does not answer at all.
// The bytes as served, since that is what the hash covers: decoding to text first would drop a
// byte order mark and mend invalid sequences, and hash a file nothing else would recognise.
async function fetchRegistryBytes(uri: string, ipfsGateway: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(registryUrlOf(uri, ipfsGateway), {
      cache: "no-store",
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function fetchRegistryText(uri: string, ipfsGateway: string): Promise<string | undefined> {
  const served = await fetchRegistryBytes(uri, ipfsGateway);
  return served === undefined ? undefined : binToUtf8(served);
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

export async function checkPublicationUri(
  uri: string,
  expectedHash: string,
  ipfsGateway: string,
): Promise<PublicationUriStatus> {
  const served = await fetchRegistryBytes(uri, ipfsGateway);
  if (served === undefined) return 'unreachable';
  return registryContentHash(served) === expectedHash ? 'verified' : 'changed';
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
    const served = await fetchRegistryBytes(uri, ipfsGateway);
    if (served === undefined) throw new Error(t('identities.publish.errors.unreachable', { uri }));
    return { uri, content: binToUtf8(served), hash: registryContentHash(served) };
  }));
  const first = fetched[0]!;
  const mismatch = fetched.find(entry => entry.hash !== first.hash);
  if (mismatch) throw new Error(t('identities.publish.errors.mirrorMismatch', { uri: mismatch.uri }));
  return { hash: first.hash, content: first.content };
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
