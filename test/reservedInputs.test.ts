import { hexToBin } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import { checkReservedInputs, refusalMessage, type SignedOutput } from "../src/utils/dapp/reservedInputs";
import type { ReservedUtxos } from "../src/utils/wallet/reservedUtxos";

// Every AuthGuard spend takes the AuthKey as an input, so a wallet that refuses every held back
// input refuses CashTokens Studio's operations for the identities it protects. These pin the rule
// that lets those through: the exemption is per input, and only for authority that comes back.
// An identity UTXO the wallet holds directly is behind a user option, and never leaves.

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
  token: { category: tokenCategory, amount: 5000n, nft: { capability: "minting", commitment: "" } },
};

const pledgeCoin: Utxo = {
  txid: pledgeTxid, vout: 0, satoshis: 100_000n, address: "bitcoincash:qours",
};

const reserved: ReservedUtxos = {
  [`${keyCategory}:1`]: 'auth',
  [`${authheadTxid}:0`]: 'auth',
  [`${pledgeTxid}:0`]: 'pledge',
};

// the user option off, which is the default
const context = {
  reservedUtxos: reserved,
  walletUtxos: [authKey, authhead, pledgeCoin],
  identityKeys: [`${keyCategory}:1`],
  authheads: [`${authheadTxid}:0`],
  allowIdentitySpends: false,
  ownsOutput: (output: SignedOutput) => output.lockingBytecode === ours,
};
const allowing = { ...context, allowIdentitySpends: true };

const spends = (txid: string, vout: number) =>
  ({ outpointTransactionHash: hexToBin(txid), outpointIndex: vout });

const keyOutput = (lockingBytecode: Uint8Array): SignedOutput => ({
  lockingBytecode,
  token: { category: hexToBin(keyCategory), amount: 0n, nft: { capability: "none", commitment: hexToBin("00") } },
});

const identityOutput = (lockingBytecode: Uint8Array, amount: bigint, minting = true): SignedOutput => ({
  lockingBytecode,
  token: {
    category: hexToBin(tokenCategory),
    amount,
    ...(minting ? { nft: { capability: "minting", commitment: hexToBin("") } } : {}),
  },
});

describe('a covenant operation a dapp builds', () => {
  it('is signable when the AuthKey comes back to this wallet, whatever the option says', () => {
    for (const setting of [context, allowing]) {
      const check = checkReservedInputs([spends(keyCategory, 1)], [keyOutput(ours)], setting);
      expect(check.refusals).toEqual([]);
      expect(check.returning).toEqual([{ outpoint: `${keyCategory}:1`, kind: 'key' }]);
    }
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
});

describe('an identity UTXO the wallet holds, spent by a dapp', () => {
  // the default: refused the way a pledged coin is, even when the chain would continue here
  it('is refused while the option is off, in the identity\'s own words', () => {
    const check = checkReservedInputs([spends(authheadTxid, 0)], [identityOutput(ours, 5000n)], context);
    expect(check.refusals).toEqual([{ outpoint: `${authheadTxid}:0`, reason: 'identityHeld' }]);
    expect(check.returning).toEqual([]);
    expect(refusalMessage(check, 'Named')).toContain('Named');
  });

  // with the option on, the dialog has to say what the identity output carried and carries after
  it('is signable with the option on when the chain continues at output 0 of this wallet, saying what it carries', () => {
    const check = checkReservedInputs([spends(authheadTxid, 0)], [identityOutput(ours, 4000n)], allowing);
    expect(check.refusals).toEqual([]);
    expect(check.returning).toEqual([{
      outpoint: `${authheadTxid}:0`,
      kind: 'authhead',
      category: tokenCategory,
      before: { reserve: 5000n, mintingNft: true },
      after: { reserve: 4000n, mintingNft: true },
    }]);
  });

  // the reserve moved to output 1 and the minting NFT went with it: output 0 is ours, and empty
  it('reads a reserve and a minting NFT taken off output 0', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0)],
      [{ lockingBytecode: ours }, identityOutput(theirs, 5000n)],
      allowing,
    );
    expect(check.refusals).toEqual([]);
    expect(check.returning[0]).toMatchObject({
      before: { reserve: 5000n, mintingNft: true },
      after: { reserve: 0n, mintingNft: false },
    });
  });

  // moving an identity out is the identities page's job, whatever the option says
  it('is refused when the chain would continue at an output that is not this wallet\'s', () => {
    for (const setting of [context, allowing]) {
      const check = checkReservedInputs(
        [spends(authheadTxid, 0)],
        [identityOutput(theirs, 5000n), identityOutput(ours, 5000n)],
        setting,
      );
      expect(check.refusals).toHaveLength(1);
      expect(check.refusals[0]?.reason).toBe(setting.allowIdentitySpends ? 'identityLeaves' : 'identityHeld');
    }
  });

  // output 0 would continue both chains at once, which no operation means
  it('refuses two identity UTXOs spent by one transaction, even when output 0 comes back', () => {
    const otherAuthheadTxid = "ffeeddccbbaa99887766554433221100".repeat(2);
    const otherAuthhead: Utxo = { ...authhead, txid: otherAuthheadTxid };
    const twoAuthheads = {
      ...allowing,
      reservedUtxos: { ...reserved, [`${otherAuthheadTxid}:0`]: 'auth' as const },
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
  it('lets a key and one identity UTXO return in the same transaction', () => {
    const check = checkReservedInputs(
      [spends(authheadTxid, 0), spends(keyCategory, 1)],
      [identityOutput(ours, 5000n), keyOutput(ours)],
      allowing,
    );
    expect(check.refusals).toEqual([]);
    expect(check.returning.map(entry => entry.kind)).toEqual(['authhead', 'key']);
  });
});

describe('the exemption reaches no further than the identity input', () => {
  it('still refuses a pledged coin spent in the same transaction', () => {
    const check = checkReservedInputs(
      [spends(keyCategory, 1), spends(pledgeTxid, 0)],
      [keyOutput(ours)],
      context,
    );
    expect(check.refusals).toEqual([{ outpoint: `${pledgeTxid}:0`, reason: 'held' }]);
    // the key is still recognised as returning, the transaction is refused all the same
    expect(check.returning).toHaveLength(1);
  });

  it('refuses a held coin it cannot account for', () => {
    const strayReserved: ReservedUtxos = {
      ...reserved,
      [`${tokenCategory}:0`]: 'auth',
    };
    const check = checkReservedInputs(
      [spends(tokenCategory, 0)],
      [identityOutput(ours, 5000n)],
      { ...allowing, reservedUtxos: strayReserved },
    );
    expect(check.refusals).toEqual([{ outpoint: `${tokenCategory}:0`, reason: 'held' }]);
  });

  it('leaves a transaction spending nothing held back alone', () => {
    const check = checkReservedInputs([spends(tokenCategory, 3)], [identityOutput(ours, 1n)], context);
    expect(check).toEqual({ refusals: [], returning: [] });
  });
});
