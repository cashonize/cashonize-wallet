import { hexToBin } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import {
  loadReservedUtxos,
  saveReservedUtxo,
  deleteReservedUtxo,
  removeReservedUtxos,
  spendableFromUtxos,
  reservedFromUtxos,
  reservedTransactionInputs,
  outpointOf,
} from "../src/utils/wallet/reservedUtxos";

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

// Not repeated characters, which survive byte reversal and would not catch a reversed comparison
const txidA = "0123456789abcdef".repeat(4);
const txidB = "fedcba9876543210".repeat(4);
const txidC = "00112233445566778899aabbccddeeff".repeat(2);

const utxo = (txid: string, vout: number, satoshis: bigint): Utxo =>
  ({ txid, vout, satoshis, address: "bitcoincash:qtest" });

const coinA = utxo(txidA, 0, 100_000n);
const coinB = utxo(txidB, 1, 250_000n);
const coinC = utxo(txidC, 0, 50_000n);

describe('reservedUtxos', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads reservations per wallet per network', () => {
    saveReservedUtxo('mainnet', 'mywallet', coinA, 'pledge', 1_700_000_000);
    expect(loadReservedUtxos('mainnet', 'mywallet')).toEqual({
      [`${txidA}:0`]: { reason: 'pledge', satoshis: '100000', reservedAt: 1_700_000_000 },
    });
    expect(loadReservedUtxos('chipnet', 'mywallet')).toEqual({});
    expect(loadReservedUtxos('mainnet', 'otherwallet')).toEqual({});
  });

  // satoshis is a bigint, which JSON.stringify throws on, so it is stored as a string
  it('round-trips a coin value through storage without throwing', () => {
    expect(() => saveReservedUtxo('mainnet', 'mywallet', coinB, 'pledge', 1)).not.toThrow();
    expect(loadReservedUtxos('mainnet', 'mywallet')[`${txidB}:1`]?.satoshis).toBe('250000');
  });

  it('re-reads before writing, so a reservation from another tab survives', () => {
    saveReservedUtxo('mainnet', 'mywallet', coinA, 'pledge', 1);
    // simulates another tab reserving a second coin against the same key
    const otherTab = loadReservedUtxos('mainnet', 'mywallet');
    saveReservedUtxo('mainnet', 'mywallet', coinB, 'pledge', 2);
    expect(Object.keys(otherTab)).toHaveLength(1);
    expect(Object.keys(loadReservedUtxos('mainnet', 'mywallet'))).toHaveLength(2);
  });

  it('deletes only the outpoint given', () => {
    saveReservedUtxo('mainnet', 'mywallet', coinA, 'pledge', 1);
    saveReservedUtxo('mainnet', 'mywallet', coinB, 'pledge', 2);
    deleteReservedUtxo('mainnet', 'mywallet', `${txidA}:0`);
    expect(Object.keys(loadReservedUtxos('mainnet', 'mywallet'))).toEqual([`${txidB}:1`]);
  });

  // a future wallet created under the same name must not inherit these
  it('removes both networks when the wallet is deleted', () => {
    saveReservedUtxo('mainnet', 'mywallet', coinA, 'pledge', 1);
    saveReservedUtxo('chipnet', 'mywallet', coinB, 'pledge', 2);
    removeReservedUtxos('mywallet');
    expect(loadReservedUtxos('mainnet', 'mywallet')).toEqual({});
    expect(loadReservedUtxos('chipnet', 'mywallet')).toEqual({});
  });

  it('returns an empty map rather than throwing on corrupted storage', () => {
    localStorage.setItem('reservedUtxos-mainnet-mywallet', 'not json');
    expect(loadReservedUtxos('mainnet', 'mywallet')).toEqual({});
  });
});

// This is the subtraction every spend path narrows mainnet-js's coin selection through, so a
// coin wrongly left in the pool is a reserved coin that gets spent.
describe('spendableFromUtxos', () => {
  it('excludes reserved coins and keeps the rest', () => {
    const reserved = { [`${txidB}:1`]: { reason: 'pledge' as const, satoshis: '250000', reservedAt: 1 } };
    expect(spendableFromUtxos([coinA, coinB, coinC], reserved)).toEqual([coinA, coinC]);
  });

  it('matches on vout, not on txid alone', () => {
    const sameTxOtherVout = utxo(txidA, 1, 70_000n);
    const reserved = { [`${txidA}:0`]: { reason: 'pledge' as const, satoshis: '100000', reservedAt: 1 } };
    expect(spendableFromUtxos([coinA, sameTxOtherVout], reserved)).toEqual([sameTxOtherVout]);
  });

  it('returns every coin when nothing is reserved', () => {
    expect(spendableFromUtxos([coinA, coinB], {})).toEqual([coinA, coinB]);
  });

  it('can exclude everything, rather than falling back to the full set', () => {
    const reserved = {
      [`${txidA}:0`]: { reason: 'pledge' as const, satoshis: '100000', reservedAt: 1 },
      [`${txidB}:1`]: { reason: 'pledge' as const, satoshis: '250000', reservedAt: 1 },
    };
    expect(spendableFromUtxos([coinA, coinB], reserved)).toEqual([]);
  });
});

describe('reservedFromUtxos', () => {
  it('returns the reserved coins the wallet still holds', () => {
    const reserved = { [`${txidB}:1`]: { reason: 'pledge' as const, satoshis: '250000', reservedAt: 1 } };
    expect(reservedFromUtxos([coinA, coinB, coinC], reserved)).toEqual([coinB]);
  });

  // a reservation can outlive its coin, spent from another tab, device or wallet
  it('omits a reservation whose coin is gone', () => {
    const reserved = { [`${txidB}:1`]: { reason: 'pledge' as const, satoshis: '250000', reservedAt: 1 } };
    expect(reservedFromUtxos([coinA, coinC], reserved)).toEqual([]);
  });
});

// The only enforcement point for WalletConnect and WizardConnect, where the wallet cannot
// withhold the coin and has to refuse to sign instead.
describe('reservedTransactionInputs', () => {
  const reserved = { [`${txidA}:2`]: { reason: 'pledge' as const, satoshis: '100000', reservedAt: 1 } };

  // libauth's decodeTransaction reverses outpointTransactionHash on read, so it hex-encodes to
  // the same txid form reservations are keyed by; the wrong order here would silently never match
  it('finds a reserved input given libauth-decoded bytes', () => {
    const inputs = [
      { outpointTransactionHash: hexToBin(txidB), outpointIndex: 0 },
      { outpointTransactionHash: hexToBin(txidA), outpointIndex: 2 },
    ];
    expect(reservedTransactionInputs(inputs, reserved)).toEqual([`${txidA}:2`]);
  });

  it('accepts a hex string hash, as the request types still allow one', () => {
    const inputs = [{ outpointTransactionHash: txidA, outpointIndex: 2 }];
    expect(reservedTransactionInputs(inputs, reserved)).toEqual([`${txidA}:2`]);
  });

  it('does not match the same txid at a different index', () => {
    const inputs = [{ outpointTransactionHash: hexToBin(txidA), outpointIndex: 3 }];
    expect(reservedTransactionInputs(inputs, reserved)).toEqual([]);
  });

  it('returns nothing when no input is reserved', () => {
    const inputs = [{ outpointTransactionHash: hexToBin(txidC), outpointIndex: 0 }];
    expect(reservedTransactionInputs(inputs, reserved)).toEqual([]);
  });
});

describe('outpointOf', () => {
  it('formats the outpoint the way mainnet-js accepts for utxoIds', () => {
    expect(outpointOf(coinB)).toBe(`${txidB}:1`);
  });
});
