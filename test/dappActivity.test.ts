import { loadDappActivity, appendDappActivity, clearDappActivity, removeDappActivity, loadDappActivitySeen, saveDappActivitySeen, type DappActivityEntry } from "../src/utils/dapp/dappActivity";

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

function entry(txid: string): DappActivityEntry {
  return { time: 0, protocol: 'walletconnect', dappName: 'ParyonUSD', userPrompt: 'Claim Payout', txid, outcome: 'sent' };
}

describe('dappActivity', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should keep the newest entry first, per wallet per network', () => {
    appendDappActivity('mainnet', 'mywallet', entry('txid1'));
    appendDappActivity('mainnet', 'mywallet', entry('txid2'));
    expect(loadDappActivity('mainnet', 'mywallet').map(e => e.txid)).toEqual(['txid2', 'txid1']);
    expect(loadDappActivity('chipnet', 'mywallet')).toEqual([]);
    expect(loadDappActivity('mainnet', 'otherwallet')).toEqual([]);
  });

  it('should drop the oldest entries past the cap', () => {
    for (let i = 0; i < 210; i++) appendDappActivity('mainnet', 'mywallet', entry(`txid${i}`));
    const dappActivity = loadDappActivity('mainnet', 'mywallet');
    expect(dappActivity).toHaveLength(200);
    expect(dappActivity[0]?.txid).toBe('txid209');
    expect(dappActivity[199]?.txid).toBe('txid10');
  });

  it("should keep another tab's entries when appending", () => {
    appendDappActivity('mainnet', 'mywallet', entry('txid1'));
    // this tab's in-memory copy is stale, the append re-reads storage instead of trusting it
    localStorage.setItem('dappActivity-mainnet-mywallet', JSON.stringify([entry('otherTab'), entry('txid1')]));
    const dappActivity = appendDappActivity('mainnet', 'mywallet', entry('txid2'));
    expect(dappActivity.map(e => e.txid)).toEqual(['txid2', 'otherTab', 'txid1']);
  });

  it('should treat corrupt or non-array storage as empty', () => {
    localStorage.setItem('dappActivity-mainnet-mywallet', '{not json');
    expect(loadDappActivity('mainnet', 'mywallet')).toEqual([]);
    localStorage.setItem('dappActivity-mainnet-mywallet', '{"txid1": "x"}');
    expect(loadDappActivity('mainnet', 'mywallet')).toEqual([]);
  });

  it('should remember when the log was last opened, per wallet per network', () => {
    expect(loadDappActivitySeen('mainnet', 'mywallet')).toBe(0);
    saveDappActivitySeen('mainnet', 'mywallet', 1234);
    expect(loadDappActivitySeen('mainnet', 'mywallet')).toBe(1234);
    expect(loadDappActivitySeen('chipnet', 'mywallet')).toBe(0);
    localStorage.setItem('dappActivitySeen-mainnet-mywallet', 'garbage');
    expect(loadDappActivitySeen('mainnet', 'mywallet')).toBe(0);
  });

  it('should clear one network and remove both on wallet deletion', () => {
    appendDappActivity('mainnet', 'mywallet', entry('txid1'));
    appendDappActivity('chipnet', 'mywallet', entry('txid2'));
    clearDappActivity('mainnet', 'mywallet');
    expect(loadDappActivity('mainnet', 'mywallet')).toEqual([]);
    expect(loadDappActivity('chipnet', 'mywallet')).toHaveLength(1);
    saveDappActivitySeen('chipnet', 'mywallet', 1234);
    removeDappActivity('mywallet');
    expect(loadDappActivity('chipnet', 'mywallet')).toEqual([]);
    expect(loadDappActivitySeen('chipnet', 'mywallet')).toBe(0);
  });
});
