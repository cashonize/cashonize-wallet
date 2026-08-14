import { loadTxNotes, saveTxNote, removeTxNotes, maxTxNoteLength } from "../src/utils/history/txNotes";

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

describe('txNotes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should save and load a note per wallet per network', () => {
    saveTxNote('mainnet', 'mywallet', 'txid1', 'rent payment');
    expect(loadTxNotes('mainnet', 'mywallet')).toEqual({ txid1: 'rent payment' });
    expect(loadTxNotes('chipnet', 'mywallet')).toEqual({});
    expect(loadTxNotes('mainnet', 'otherwallet')).toEqual({});
  });

  it('should trim notes and cap them at the maximum length', () => {
    const notes = saveTxNote('mainnet', 'mywallet', 'txid1', '  ' + 'a'.repeat(maxTxNoteLength + 50) + '  ');
    expect(notes['txid1']).toBe('a'.repeat(maxTxNoteLength));
  });

  it('should delete the entry when saving an empty or whitespace note', () => {
    saveTxNote('mainnet', 'mywallet', 'txid1', 'note');
    const notes = saveTxNote('mainnet', 'mywallet', 'txid1', '   ');
    expect(notes).toEqual({});
    expect(loadTxNotes('mainnet', 'mywallet')).toEqual({});
  });

  it('should preserve notes written after load (concurrent tab)', () => {
    saveTxNote('mainnet', 'mywallet', 'txid1', 'from this tab');
    // simulate another tab writing a note for a different txid
    const key = 'txNotes-mainnet-mywallet';
    const otherTabNotes = { ...JSON.parse(localStorage.getItem(key)!), txid2: 'from other tab' };
    localStorage.setItem(key, JSON.stringify(otherTabNotes));
    // this tab saves a new note; the other tab's note must survive
    const notes = saveTxNote('mainnet', 'mywallet', 'txid3', 'also this tab');
    expect(notes).toEqual({ txid1: 'from this tab', txid2: 'from other tab', txid3: 'also this tab' });
  });

  it('should return an empty map for corrupted stored data', () => {
    localStorage.setItem('txNotes-mainnet-mywallet', 'not json');
    expect(loadTxNotes('mainnet', 'mywallet')).toEqual({});
  });

  it('should remove notes for both networks on wallet deletion', () => {
    saveTxNote('mainnet', 'mywallet', 'txid1', 'note');
    saveTxNote('chipnet', 'mywallet', 'txid2', 'note');
    saveTxNote('mainnet', 'otherwallet', 'txid3', 'kept');
    removeTxNotes('mywallet');
    expect(loadTxNotes('mainnet', 'mywallet')).toEqual({});
    expect(loadTxNotes('chipnet', 'mywallet')).toEqual({});
    expect(loadTxNotes('mainnet', 'otherwallet')).toEqual({ txid3: 'kept' });
  });
});
