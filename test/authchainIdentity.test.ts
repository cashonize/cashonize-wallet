import { OpReturnData, type Utxo } from "mainnet-js";
import { binToHex, hexToBin } from "@bitauth/libauth";
import {
  loadIdentityList,
  addToIdentityList,
  removeFromIdentityList,
  removeIdentityCategories,
  resolveIdentities,
  isTokenCategory,
} from "../src/utils/tools/authchainIdentity";

// The global setup stubs localStorage as a no-op; these tests need a working store
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

const categoryA = "0123456789abcdef".repeat(4);
const categoryB = "fedcba9876543210".repeat(4);
const authheadA = "00112233445566778899aabbccddeeff".repeat(2);
const authheadB = "ffeeddccbbaa99887766554433221100".repeat(2);

const utxo = (txid: string, vout: number, token?: Utxo["token"]): Utxo =>
  ({ txid, vout, satoshis: 1000n, address: "bitcoincash:qtest", ...(token ? { token } : {}) });

const chaingraphUrl = "https://chaingraph.example.com/v1/graphql";

// Answers each authhead query with the txid mapped to the category it asks about, and rejects a
// query for any category not in the map, the way an unreachable server would
function stubAuthheadQueries(
  authheads: Record<string, string>,
  chains: Record<string, { hash: string; publication?: string }[]> = {},
) {
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    const { variables } = JSON.parse(options.body as string) as { variables: { hash?: string } };
    const category = Object.keys(authheads).find(listed => variables.hash === `\\x${listed}`);
    if (!category) return Promise.reject(new TypeError("Failed to fetch"));
    // the query asks for each link's BCMR-prefixed outputs only, so a link without one answers empty
    const migrations = (chains[category] ?? []).map(link => ({
      transaction: [{
        hash: `\\x${link.hash}`,
        outputs: link.publication ? [{ locking_bytecode: `\\x${link.publication}` }] : [],
      }],
    }));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: { transaction: [{ authchains: [{
          authhead: { hash: `\\x${authheads[category]}` }, // chaingraph returns bytea as \x-prefixed hex
          migrations,
        }] }] },
      }),
    });
  }));
}

// Built the way the wallet publishes one, so the resolve is read against the writer
function publicationOutput(hash: string, uris: string[]) {
  const chunks: (string | Uint8Array)[] = ['BCMR', hexToBin(hash), ...uris];
  return binToHex(OpReturnData.fromArray(chunks).buffer);
}

// An identity's registry is the last publication its chain carries. Transfers and reserve moves
// carry none, and those are the operations this wallet makes, so reading the publication off the
// authhead alone loses the metadata of exactly the identities it manages.
describe('the publication a resolve reports', () => {
  const registryHash = 'ab'.repeat(32);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the last one the chain carries, not the last transaction', async () => {
    const published = publicationOutput(registryHash, ['example.com']);
    stubAuthheadQueries({ [categoryA]: authheadA }, {
      [categoryA]: [
        { hash: 'aa'.repeat(32), publication: published },
        { hash: 'bb'.repeat(32) }, // a transfer
        { hash: authheadA }, // and another
      ],
    });

    const [resolved] = await resolveIdentities([categoryA], chaingraphUrl, []);

    expect(resolved?.publication?.uris).toEqual(['example.com']);
    expect(resolved?.publication?.hash).toBe(registryHash);
  });

  it('is the newest of several, since a chain republishes', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, {
      [categoryA]: [
        { hash: 'aa'.repeat(32), publication: publicationOutput(registryHash, ['old.example']) },
        { hash: authheadA, publication: publicationOutput(registryHash, ['new.example']) },
      ],
    });

    const [resolved] = await resolveIdentities([categoryA], chaingraphUrl, []);

    expect(resolved?.publication?.uris).toEqual(['new.example']);
  });

  it('reports none when no link ever carried one', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, { [categoryA]: [{ hash: authheadA }] });

    const [resolved] = await resolveIdentities([categoryA], chaingraphUrl, []);

    expect(resolved?.publication).toBeUndefined();
  });
});

describe('identity categories', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads categories per wallet per network', () => {
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    expect(loadIdentityList('categories', 'mainnet', 'mywallet')).toEqual([categoryA]);
    expect(loadIdentityList('categories', 'chipnet', 'mywallet')).toEqual([]);
    expect(loadIdentityList('categories', 'mainnet', 'otherwallet')).toEqual([]);
  });

  it('does not list the same category twice', () => {
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    expect(loadIdentityList('categories', 'mainnet', 'mywallet')).toEqual([categoryA]);
  });

  it('re-reads before writing, so a category added in another tab survives', () => {
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    // simulates another tab adding a second identity against the same key
    const otherTab = loadIdentityList('categories', 'mainnet', 'mywallet');
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryB);
    expect(otherTab).toHaveLength(1);
    expect(loadIdentityList('categories', 'mainnet', 'mywallet')).toHaveLength(2);
  });

  it('deletes only the category given', () => {
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryB);
    removeFromIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    expect(loadIdentityList('categories', 'mainnet', 'mywallet')).toEqual([categoryB]);
  });

  // a future wallet created under the same name must not inherit these
  it('removes both networks when the wallet is deleted', () => {
    addToIdentityList('categories', 'mainnet', 'mywallet', categoryA);
    addToIdentityList('categories', 'chipnet', 'mywallet', categoryB);
    removeIdentityCategories('mywallet');
    expect(loadIdentityList('categories', 'mainnet', 'mywallet')).toEqual([]);
    expect(loadIdentityList('categories', 'chipnet', 'mywallet')).toEqual([]);
  });

  it('accepts a token category and rejects anything else', () => {
    expect(isTokenCategory(categoryA)).toBe(true);
    expect(isTokenCategory(categoryA.toUpperCase())).toBe(true);
    expect(isTokenCategory(categoryA.slice(0, 63))).toBe(false);
    expect(isTokenCategory(`${categoryA}:0`)).toBe(false);
    expect(isTokenCategory("")).toBe(false);
  });
});

describe('resolveIdentities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds an authhead the wallet has as a BCH-only coin at vout 0', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA });
    const authUtxo = utxo(authheadA, 0);
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [authUtxo]);
    expect(resolved).toEqual([
      { category: categoryA, authheadTxid: authheadA, authUtxo, links: [], status: 'held' },
    ]);
  });

  // the authhead is output 0 of the authchain's latest transaction, another output of the same
  // transaction is an ordinary coin
  it('does not take another output of the authhead transaction for the authhead', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA });
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [utxo(authheadA, 1)]);
    expect(resolved[0]?.status).toBe('notHeld');
    expect(resolved[0]?.authUtxo).toBeUndefined();
  });

  // both are held back, they are told apart because an authhead carrying a reserve cannot be
  // transferred on its own yet
  it('marks an authhead carrying a reserve, and still holds it back', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA });
    const tokenAuthUtxo = utxo(authheadA, 0, { category: categoryA, amount: 100n });
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [tokenAuthUtxo]);
    expect(resolved[0]?.status).toBe('carriesTokens');
    expect(resolved[0]?.authUtxo).toEqual(tokenAuthUtxo);
  });

  it('marks only the identity whose query failed as unresolved', async () => {
    // only categoryB answers, so categoryA's query is the one that fails
    stubAuthheadQueries({ [categoryB]: authheadB });
    const authUtxo = utxo(authheadB, 0);
    const resolved = await resolveIdentities([categoryA, categoryB], chaingraphUrl, [authUtxo]);
    // the reason travels with the status, so the page can say what went wrong
    expect(resolved[0]).toEqual({ category: categoryA, status: 'unresolved', unresolvedReason: expect.any(String) });
    expect(resolved[1]?.status).toBe('held');
  });
});
