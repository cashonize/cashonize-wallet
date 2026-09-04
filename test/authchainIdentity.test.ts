import { OpReturnData, type Utxo } from "mainnet-js";
import { binToHex, hexToBin } from "@bitauth/libauth";
import {
  loadIdentityList,
  addToIdentityList,
  removeFromIdentityList,
  removeIdentityCategories,
  resolveIdentities,
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

// the identity output as the stub reports it: at a P2PKH address, or burned in an OP_RETURN
const p2pkhOutput = `76a914${"ab".repeat(20)}88ac`;
const burnOutput = "6a04deadbeef";

// Answers the authhead queries, single or batched, with the txid mapped to each category asked
// about. A batch none of whose categories is mapped rejects, the way an unreachable server would;
// otherwise the unmapped ones are left out of the answer, which is that category unresolved alone
function stubAuthheadQueries(
  authheads: Record<string, string>,
  chains: Record<string, { hash: string; publication?: string }[]> = {},
  // what each category's genesis made; a token without fungible supply unless said otherwise
  genesis: Record<string, 'fungible' | 'nft' | 'none'> = {},
  burned: string[] = [], // categories whose identity output is an OP_RETURN
) {
  const answer = (category: string) => {
    // the server picks the last link carrying a BCMR-prefixed output, and answers the chain's
    // latest links newest first
    const links = chains[category] ?? [];
    const lastPublished = [...links].reverse().find(link => link.publication);
    const lastPublication = lastPublished
      ? [{ transaction: [{ outputs: [{ locking_bytecode: `\\x${lastPublished.publication}` }] }] }]
      : [];
    const recent = [...links].reverse().map(link => ({ transaction: [{ hash: `\\x${link.hash}` }] }));
    // the chain's second link is the genesis, the one transaction that can make the category, so
    // its outputs say whether the chain is a token's at all and whether that token has supply
    const made = genesis[category] ?? 'nft';
    const genesisOutputs = made === 'none' ? [] : [{
      token_category: `\\x${category}`,
      fungible_token_amount: made === 'fungible' ? "1000" : null,
    }];
    const lockingBytecode = burned.includes(category) ? burnOutput : p2pkhOutput;
    return { hash: `\\x${category}`, authchains: [{
      authchain_length: links.length,
      authhead: { // chaingraph returns bytea as \x-prefixed hex
        hash: `\\x${authheads[category]}`,
        outputs: [{ locking_bytecode: `\\x${lockingBytecode}`, value_satoshis: "1000" }],
      },
      genesis: [{ transaction: [{ outputs: genesisOutputs }] }],
      lastPublication,
      recent,
    }] };
  };
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    const { variables } = JSON.parse(options.body as string) as { variables: { hash?: string; hashes?: string[] } };
    const asked = variables.hashes ?? (variables.hash ? [variables.hash] : []);
    const known = Object.keys(authheads).filter(listed => asked.includes(`\\x${listed}`));
    if (!known.length) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: { transaction: known.map(answer) } }),
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

  // the server answers the latest links newest first; the wallet keeps them in chain order
  it('hands the chain length and its latest links on in chain order', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, {
      [categoryA]: [{ hash: 'aa'.repeat(32) }, { hash: 'bb'.repeat(32) }, { hash: authheadA }],
    });

    const [resolved] = await resolveIdentities([categoryA], chaingraphUrl, []);

    expect(resolved?.chainLength).toBe(3);
    expect(resolved?.recentLinks).toEqual(['aa'.repeat(32), 'bb'.repeat(32), authheadA]);
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
      {
        category: categoryA,
        authheadTxid: authheadA,
        identityOutput: { lockingBytecode: p2pkhOutput, satoshis: 1000n },
        authUtxo,
        chainLength: 0,
        recentLinks: [],
        status: 'held',
        isToken: true,
        fungibleSupply: false,
        genesisSupply: 0n,
      },
    ]);
  });

  // an OP_RETURN at output 0 can never be spent, so the identity ended there
  it('reads a burned identity off an OP_RETURN identity output', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA }, {}, {}, [categoryA]);
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, []);
    expect(resolved[0]?.status).toBe('burned');
    expect(resolved[0]?.identityOutput?.lockingBytecode).toBe(burnOutput);
  });

  // the authhead is output 0 of the authchain's latest transaction, another output of the same
  // transaction is an ordinary coin
  it('does not take another output of the authhead transaction for the authhead', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA });
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [utxo(authheadA, 1)]);
    expect(resolved[0]?.status).toBe('notHeld');
    expect(resolved[0]?.authUtxo).toBeUndefined();
  });

  // what the authhead carries is on the UTXO itself, held back like any other
  it('holds back an authhead carrying a reserve like any other', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA });
    const tokenAuthUtxo = utxo(authheadA, 0, { category: categoryA, amount: 100n });
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [tokenAuthUtxo]);
    expect(resolved[0]?.status).toBe('held');
    expect(resolved[0]?.authUtxo).toEqual(tokenAuthUtxo);
  });

  // a just-added identity sits at its authbase, which Chaingraph may not have seen yet; the coin
  // is here, so the card says held rather than sending the user to check the server
  it('holds an identity still at its authbase before the server knows it', async () => {
    stubAuthheadQueries({});
    const authbaseCoin = utxo(categoryA, 0);
    const resolved = await resolveIdentities([categoryA], chaingraphUrl, [authbaseCoin]);
    expect(resolved[0]).toMatchObject({ status: 'held', authheadTxid: categoryA, authUtxo: authbaseCoin, isToken: false });
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

  // a reserve is only possible for a category whose genesis created fungible supply, whatever the
  // wallet holds of it now; an NFT-only category never gets the reserve actions
  it('reads off the genesis whether the category has fungible supply', async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB }, {}, { [categoryA]: 'fungible' });
    const resolved = await resolveIdentities([categoryA, categoryB], chaingraphUrl, []);
    expect(resolved[0]?.fungibleSupply).toBe(true);
    expect(resolved[0]?.genesisSupply).toBe(1000n);
    expect(resolved[1]?.fungibleSupply).toBe(false);
    expect(resolved[1]?.genesisSupply).toBe(0n);
  });

  // an identity that is not a token is a chain like any other, with no token made at its second link
  it("reads off the genesis whether the chain is a token's at all", async () => {
    stubAuthheadQueries({ [categoryA]: authheadA, [categoryB]: authheadB }, {}, { [categoryB]: 'none' });
    const resolved = await resolveIdentities([categoryA, categoryB], chaingraphUrl, []);
    expect(resolved[0]?.isToken).toBe(true);
    expect(resolved[1]?.isToken).toBe(false);
    expect(resolved[1]?.fungibleSupply).toBe(false);
  });
});
