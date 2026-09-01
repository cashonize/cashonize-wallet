import type { Utxo } from "mainnet-js";
import {
  loadIdentityCategories,
  saveIdentityCategory,
  deleteIdentityCategory,
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
function stubAuthheadQueries(authheads: Record<string, string>) {
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    const query = (JSON.parse(options.body as string) as { query: string }).query;
    const category = Object.keys(authheads).find(listed => query.includes(listed));
    if (!category) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: { transaction: [{ authchains: [{ authhead: {
          hash: `\\x${authheads[category]}`, // chaingraph returns bytea as \x-prefixed hex
          identity_output: [{ fungible_token_amount: "0" }],
          outputs: [],
        } }] }] },
      }),
    });
  }));
}

describe('identity categories', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads categories per wallet per network', () => {
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    expect(loadIdentityCategories('mainnet', 'mywallet')).toEqual([categoryA]);
    expect(loadIdentityCategories('chipnet', 'mywallet')).toEqual([]);
    expect(loadIdentityCategories('mainnet', 'otherwallet')).toEqual([]);
  });

  it('does not list the same category twice', () => {
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    expect(loadIdentityCategories('mainnet', 'mywallet')).toEqual([categoryA]);
  });

  it('re-reads before writing, so a category added in another tab survives', () => {
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    // simulates another tab adding a second identity against the same key
    const otherTab = loadIdentityCategories('mainnet', 'mywallet');
    saveIdentityCategory('mainnet', 'mywallet', categoryB);
    expect(otherTab).toHaveLength(1);
    expect(loadIdentityCategories('mainnet', 'mywallet')).toHaveLength(2);
  });

  it('deletes only the category given', () => {
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    saveIdentityCategory('mainnet', 'mywallet', categoryB);
    deleteIdentityCategory('mainnet', 'mywallet', categoryA);
    expect(loadIdentityCategories('mainnet', 'mywallet')).toEqual([categoryB]);
  });

  // a future wallet created under the same name must not inherit these
  it('removes both networks when the wallet is deleted', () => {
    saveIdentityCategory('mainnet', 'mywallet', categoryA);
    saveIdentityCategory('chipnet', 'mywallet', categoryB);
    removeIdentityCategories('mywallet');
    expect(loadIdentityCategories('mainnet', 'mywallet')).toEqual([]);
    expect(loadIdentityCategories('chipnet', 'mywallet')).toEqual([]);
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
    expect(resolved[0]).toEqual({ category: categoryA, status: 'unresolved' });
    expect(resolved[1]?.status).toBe('held');
  });
});
