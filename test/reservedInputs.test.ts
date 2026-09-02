import { hexToBin } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import { checkReservedInputs, type SignedOutput } from "../src/utils/dapp/reservedInputs";
import type { ReservedUtxos } from "../src/utils/wallet/reservedUtxos";

// Every AuthGuard spend takes the AuthKey as an input, so a wallet that refuses every held back
// input refuses CashTokens Studio's operations for the identities it protects. These pin the rule
// that lets those through: the exemption is per input, and only for authority that comes back.

const keyCategory = "0123456789abcdef".repeat(4);
const tokenCategory = "fedcba9876543210".repeat(4);
const authheadTxid = "00112233445566778899aabbccddeeff".repeat(2);
const pledgeTxid = "a1b2c3d4e5f60718".repeat(4);

const ours = hexToBin("76a914" + "11".repeat(20) + "88ac");
const theirs = hexToBin("76a914" + "22".repeat(20) + "88ac");

const authKey: Utxo = {
  txid: keyCategory, vout: 1, satoshis: 1000n, address: "bitcoincash:qours",
  token: { category: keyCategory, amount: 0n, nft: { capability: "none", commitment: "00" } },
};

const authhead: Utxo = {
  txid: authheadTxid, vout: 0, satoshis: 1000n, address: "bitcoincash:qours",
  token: { category: tokenCategory, amount: 5000n },
};

const pledgeCoin: Utxo = {
  txid: pledgeTxid, vout: 0, satoshis: 100_000n, address: "bitcoincash:qours",
};

const reserved: ReservedUtxos = {
  [`${keyCategory}:1`]: { reason: 'auth', satoshis: '1000', reservedAt: 1 },
  [`${authheadTxid}:0`]: { reason: 'auth', satoshis: '1000', reservedAt: 1 },
  [`${pledgeTxid}:0`]: { reason: 'pledge', satoshis: '100000', reservedAt: 1 },
};

const context = {
  reservedUtxos: reserved,
  walletUtxos: [authKey, authhead, pledgeCoin],
  identityKeys: [`${keyCategory}:1`],
  authheads: [`${authheadTxid}:0`],
  ownsOutput: (output: SignedOutput) => output.lockingBytecode === ours,
};

const spends = (txid: string, vout: number) =>
  ({ outpointTransactionHash: hexToBin(txid), outpointIndex: vout });

const keyOutput = (lockingBytecode: Uint8Array): SignedOutput => ({
  lockingBytecode,
  token: { category: hexToBin(keyCategory), amount: 0n, nft: { capability: "none", commitment: hexToBin("00") } },
});

const identityOutput = (lockingBytecode: Uint8Array, amount: bigint): SignedOutput => ({
  lockingBytecode,
  token: { category: hexToBin(tokenCategory), amount },
});

describe('an identity operation a dapp builds', () => {
  it('is signable when the AuthKey comes back to this wallet', () => {
    const check = checkReservedInputs([spends(keyCategory, 1)], [keyOutput(ours)], context);
    expect(check.refusals).toEqual([]);
    expect(check.returning).toEqual([{ outpoint: `${keyCategory}:1`, kind: 'key', category: keyCategory }]);
  });

  it('is refused when the AuthKey goes somewhere else', () => {
    const check = checkReservedInputs([spends(keyCategory, 1)], [keyOutput(theirs)], context);
    expect(check.refusals).toEqual([{ outpoint: `${keyCategory}:1`, reason: 'identityLeaves' }]);
    expect(check.returning).toEqual([]);
  });

  // an NFT of the same category is not the same key: only this one carries the authority
  it('is refused when another NFT of the key category comes back instead', () => {
    const otherNft: SignedOutput = {
      lockingBytecode: ours,
      token: { category: hexToBin(keyCategory), amount: 0n, nft: { capability: "none", commitment: hexToBin("01") } },
    };
    const check = checkReservedInputs([spends(keyCategory, 1)], [otherNft], context);
    expect(check.refusals).toEqual([{ outpoint: `${keyCategory}:1`, reason: 'identityLeaves' }]);
  });

  it('is signable when a raw AuthHead continues at output 0 of this wallet', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0)],
      [identityOutput(ours, 5000n)],
      context,
    );
    expect(check.refusals).toEqual([]);
    expect(check.returning).toEqual([
      { outpoint: `${authheadTxid}:0`, kind: 'authhead', category: tokenCategory },
    ]);
  });

  it('is refused when the AuthHead continues at an output that is not this wallet\'s', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0)],
      [identityOutput(theirs, 5000n), identityOutput(ours, 5000n)],
      context,
    );
    expect(check.refusals).toEqual([{ outpoint: `${authheadTxid}:0`, reason: 'identityLeaves' }]);
  });

  // output 0 would continue both chains at once, which no operation means
  it('refuses two AuthHeads spent by one transaction, even when output 0 comes back', () => {
    const otherAuthheadTxid = "ffeeddccbbaa99887766554433221100".repeat(2);
    const otherAuthhead: Utxo = { ...authhead, txid: otherAuthheadTxid };
    const twoAuthheads = {
      ...context,
      reservedUtxos: { ...reserved, [`${otherAuthheadTxid}:0`]: { reason: 'auth' as const, satoshis: '1000', reservedAt: 1 } },
      walletUtxos: [...context.walletUtxos, otherAuthhead],
      authheads: [`${authheadTxid}:0`, `${otherAuthheadTxid}:0`],
    };
    const check = checkReservedInputs(
      [spends(authheadTxid, 0), spends(otherAuthheadTxid, 0)],
      [identityOutput(ours, 10000n)],
      twoAuthheads,
    );
    expect(check.refusals).toEqual([
      { outpoint: `${authheadTxid}:0`, reason: 'identityMerge' },
      { outpoint: `${otherAuthheadTxid}:0`, reason: 'identityMerge' },
    ]);
    expect(check.returning).toEqual([]);
  });

  // one identity continuing at output 0 while the key of another rides along is the covenant's shape
  it('lets a key and one AuthHead return in the same transaction', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0), spends(keyCategory, 1)],
      [identityOutput(ours, 5000n), keyOutput(ours)],
      context,
    );
    expect(check.refusals).toEqual([]);
    expect(check.returning.map(entry => entry.kind)).toEqual(['authhead', 'key']);
  });

  // the identity stays, the supply on it does not: signable, and said out loud rather than implied
  it('reports the reserve an operation moves off the AuthHead', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0)],
      [identityOutput(ours, 1000n)],
      context,
    );
    expect(check.refusals).toEqual([]);
    expect(check.returning[0]?.reserveMoved).toBe(4000n);
  });
});

describe('the exemption reaches no further than the identity input', () => {
  it('still refuses a pledged coin spent in the same transaction', () => {
    const check = checkReservedInputs(
      [spends(keyCategory, 1), spends(pledgeTxid, 0)],
      [keyOutput(ours)],
      context,
    );
    expect(check.refusals).toEqual([{ outpoint: `${pledgeTxid}:0`, reason: 'pledge' }]);
    // the key is still recognised as returning, the transaction is refused all the same
    expect(check.returning).toHaveLength(1);
  });

  it('refuses a held coin it cannot account for', () => {
    const strayReserved: ReservedUtxos = {
      ...reserved,
      [`${tokenCategory}:0`]: { reason: 'auth', satoshis: '1000', reservedAt: 1 },
    };
    const check = checkReservedInputs(
      [spends(tokenCategory, 0)],
      [identityOutput(ours, 5000n)],
      { ...context, reservedUtxos: strayReserved },
    );
    expect(check.refusals).toEqual([{ outpoint: `${tokenCategory}:0`, reason: 'unrecognised' }]);
  });

  it('leaves a transaction spending nothing held back alone', () => {
    const check = checkReservedInputs([spends(tokenCategory, 3)], [identityOutput(ours, 1n)], context);
    expect(check).toEqual({ refusals: [], returning: [] });
  });
});
