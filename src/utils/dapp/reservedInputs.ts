// A dapp builds its own transaction and picks its own coins, so refusing to sign is the only way
// this wallet keeps a held back coin unspent. Identity operations are the exception the AuthGuard
// covenant forces: it requires the AuthKey at input 1, so every publish, mint or issue a dapp
// builds for a guarded identity spends the very coin phase 5 holds back.
// The exemption is per input and only for what provably comes back: the key itself, or a raw
// authhead's new output 0. Every other held coin in the same transaction still refuses.

import { binToHex } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import {
  outpointOf,
  reservedTransactionInputs,
  type Outpoint,
  type ReservedUtxos,
} from "src/utils/wallet/reservedUtxos";

// What this reads of a decoded transaction, which libauth's shapes satisfy
export interface SignedInput {
  outpointTransactionHash: Uint8Array | string;
  outpointIndex: number;
}

// Only the two fields this reads are declared, and both forms the dapp protocols still allow for
// them: WalletConnect and WizardConnect requests may carry bytes as hex strings.
export type Bytes = Uint8Array | string;

export interface SignedOutputToken {
  category: Bytes;
  amount: bigint | string;
  nft?: { capability: string; commitment: Bytes } | undefined;
}

export interface SignedOutput {
  lockingBytecode: Bytes;
  token?: SignedOutputToken | undefined;
}

function toHex(bytes: Bytes): string {
  return typeof bytes === "string" ? bytes : binToHex(bytes);
}

export interface ReservedInputContext {
  reservedUtxos: ReservedUtxos;
  walletUtxos: Utxo[];
  identityKeys: Outpoint[]; // AuthKeys this wallet holds, which a covenant spend takes along
  authheads: Outpoint[]; // identity outputs this wallet holds directly, named or not
  ownsOutput: (output: SignedOutput) => boolean;
}

// 'identityLeaves' is the one that matters: control over an identity would end up elsewhere, which
// is a transfer rather than an operation. 'identityMerge' is two authheads spent by one
// transaction: output 0 continues both chains, so the identities become one. 'unrecognised' is a
// held coin this wallet cannot account for, refused because it cannot be checked rather than
// because it is known to be wrong.
export type RefusalReason = 'pledge' | 'manual' | 'identityLeaves' | 'identityMerge' | 'unrecognised';

export interface ReservedInputRefusal {
  outpoint: Outpoint;
  reason: RefusalReason;
}

export interface ReturningIdentity {
  outpoint: Outpoint;
  kind: 'key' | 'authhead';
  category?: string;
  reserveMoved?: bigint; // supply the authhead carried in that this transaction does not put back
}

export interface ReservedInputsCheck {
  refusals: ReservedInputRefusal[];
  returning: ReturningIdentity[];
}

function sameCategory(token: SignedOutputToken | undefined, category: string | undefined): boolean {
  if (!token || !category) return false;
  return toHex(token.category) === category;
}

// The key is the NFT itself, so it is the same key only when every part of it matches
function isSameKey(output: SignedOutput, key: Utxo): boolean {
  const keyNft = key.token?.nft;
  const outputNft = output.token?.nft;
  if (!keyNft || !outputNft) return false;
  if (!sameCategory(output.token, key.token?.category)) return false;
  if (outputNft.capability !== keyNft.capability) return false;
  return toHex(outputNft.commitment) === keyNft.commitment;
}

// What the identity output carries out of a transaction that spends it, against what it carried in
function reserveMovedOut(authhead: Utxo, newAuthhead: SignedOutput): bigint | undefined {
  const carriedIn = authhead.token?.amount ?? 0n;
  if (!carriedIn) return undefined;
  const carriedOut = sameCategory(newAuthhead.token, authhead.token?.category)
    ? BigInt(newAuthhead.token?.amount ?? 0n)
    : 0n;
  return carriedIn > carriedOut ? carriedIn - carriedOut : undefined;
}

// Held coins a signing request would spend, and which of them are identity operations this wallet
// can sign because the authority comes back to it.
export function checkReservedInputs(
  inputs: readonly SignedInput[],
  outputs: readonly SignedOutput[],
  context: ReservedInputContext,
): ReservedInputsCheck {
  const refusals: ReservedInputRefusal[] = [];
  const returning: ReturningIdentity[] = [];
  for (const outpoint of reservedTransactionInputs(inputs, context.reservedUtxos)) {
    const reason = context.reservedUtxos[outpoint]?.reason;
    // a pledge or a coin the user froze is held for its own reason, which an identity cannot lift
    if (reason !== 'auth') {
      refusals.push({ outpoint, reason: reason === 'pledge' ? 'pledge' : 'manual' });
      continue;
    }
    const coin = context.walletUtxos.find(utxo => outpointOf(utxo) === outpoint);
    if (!coin) {
      refusals.push({ outpoint, reason: 'unrecognised' });
      continue;
    }
    if (context.identityKeys.includes(outpoint)) {
      const returnedKey = outputs.find(output => context.ownsOutput(output) && isSameKey(output, coin));
      if (!returnedKey) {
        refusals.push({ outpoint, reason: 'identityLeaves' });
        continue;
      }
      returning.push({ outpoint, kind: 'key', ...(coin.token ? { category: coin.token.category } : {}) });
      continue;
    }
    if (context.authheads.includes(outpoint)) {
      // the authchain continues through output 0, so that is the output that has to be this wallet's
      const newAuthhead = outputs[0];
      if (!newAuthhead || !context.ownsOutput(newAuthhead)) {
        refusals.push({ outpoint, reason: 'identityLeaves' });
        continue;
      }
      const reserveMoved = reserveMovedOut(coin, newAuthhead);
      returning.push({
        outpoint,
        kind: 'authhead',
        ...(coin.token ? { category: coin.token.category } : {}),
        ...(reserveMoved ? { reserveMoved } : {}),
      });
      continue;
    }
    refusals.push({ outpoint, reason: 'unrecognised' });
  }
  // Each authhead's chain continues through output 0 of the transaction that spends it, so two
  // in one transaction would end up sharing one authhead; no operation a dapp builds means that
  const authheadsReturning = returning.filter(entry => entry.kind === 'authhead');
  if (authheadsReturning.length > 1) {
    for (const entry of authheadsReturning) refusals.push({ outpoint: entry.outpoint, reason: 'identityMerge' });
    return { refusals, returning: returning.filter(entry => entry.kind !== 'authhead') };
  }
  return { refusals, returning };
}
