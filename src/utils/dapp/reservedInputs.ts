// A dapp builds its own transaction and picks its own coins, so refusing to sign is the only way
// this wallet keeps a held back coin unspent. A pledged or frozen coin is refused outright. An
// identity's AuthKey is the exception the AuthGuard covenant forces: it requires the key at input
// 1, so every publish, mint or issue a dapp builds for a guarded identity spends the very coin the
// identities page holds back; the key is let through when the same NFT provably comes back. An
// identity UTXO the wallet holds directly is refused unless the user option allows it, and even
// then only when the authchain continues at an output of this wallet: moving an identity out is
// the identities page's job. Every other held coin in the same transaction still refuses.

import { binToHex } from "@bitauth/libauth";
import type { Utxo } from "mainnet-js";
import { i18n } from 'src/boot/i18n';
import {
  outpointOf,
  reservedTransactionInputs,
  type Outpoint,
  type ReservedUtxos,
} from "src/utils/wallet/reservedUtxos";
const { t } = i18n.global;

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
  allowIdentitySpends: boolean; // the user option letting a dapp spend those
  ownsOutput: (output: SignedOutput) => boolean;
}

// 'identityHeld' is an identity UTXO the user option keeps from dapps. 'identityLeaves' is control
// over an identity ending up elsewhere, which is a transfer rather than an operation.
// 'identityMerge' is two authheads spent by one transaction: output 0 continues both chains, so
// the identities become one. The spec allows that (a merger is its example); this wallet refuses
// it because it cannot yet show the user which identity survives or that there is no way back.
// 'held' is any other held coin: a pledge, a frozen coin, or one this wallet cannot account for.
export type RefusalReason = 'held' | 'identityHeld' | 'identityLeaves' | 'identityMerge';

export interface ReservedInputRefusal {
  outpoint: Outpoint;
  reason: RefusalReason;
}

// What rides on an identity output: the reserved supply and the minting NFT
export interface IdentityCarry {
  reserve: bigint;
  mintingNft: boolean;
}

// An identity coin the transaction spends and this wallet keeps the authority of: the key itself,
// or an identity UTXO whose chain continues at output 0, with what that output carried before
// and carries after, which is what the approval dialog has to say
export type ReturningIdentity =
  | { outpoint: Outpoint; kind: 'key' }
  | { outpoint: Outpoint; kind: 'authhead'; category?: string; before: IdentityCarry; after: IdentityCarry };

export interface ReservedInputsCheck {
  refusals: ReservedInputRefusal[];
  returning: ReturningIdentity[];
}

const identityReasons: RefusalReason[] = ['identityHeld', 'identityLeaves', 'identityMerge'];

// The refusal that is about an identity, when there is one: told in a dialog with the identity's name
export function identityRefusal(check: ReservedInputsCheck): ReservedInputRefusal | undefined {
  return check.refusals.find(refusal => identityReasons.includes(refusal.reason));
}

// What the user is told when a check refuses, in the identity's own words when that is the reason
export function refusalMessage(check: ReservedInputsCheck, identityName?: string): string {
  const refusal = identityRefusal(check);
  if (refusal?.reason === 'identityHeld') return t('store.errors.identityHeld', { name: identityName ?? '' });
  if (refusal?.reason === 'identityLeaves') return t('store.errors.identityLeavesWallet');
  if (refusal?.reason === 'identityMerge') return t('store.errors.identityMerge');
  return t('store.errors.reservedInputs');
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

function carriedByCoin(coin: Utxo): IdentityCarry {
  return { reserve: coin.token?.amount ?? 0n, mintingNft: coin.token?.nft?.capability === 'minting' };
}

// what output 0 carries of the identity's own category; a token of another category is not the reserve
function carriedByOutput(output: SignedOutput, category: string | undefined): IdentityCarry {
  const token = output.token;
  if (!token || !sameCategory(token, category)) return { reserve: 0n, mintingNft: false };
  return { reserve: BigInt(token.amount), mintingNft: token.nft?.capability === 'minting' };
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
    const reason = context.reservedUtxos[outpoint];
    // a pledge or a coin the user froze is held for its own reason, which an identity cannot lift
    if (reason !== 'auth') {
      refusals.push({ outpoint, reason: 'held' });
      continue;
    }
    const coin = context.walletUtxos.find(utxo => outpointOf(utxo) === outpoint);
    if (!coin) {
      refusals.push({ outpoint, reason: 'held' });
      continue;
    }
    if (context.identityKeys.includes(outpoint)) {
      const returnedKey = outputs.find(output => context.ownsOutput(output) && isSameKey(output, coin));
      if (!returnedKey) {
        refusals.push({ outpoint, reason: 'identityLeaves' });
        continue;
      }
      returning.push({ outpoint, kind: 'key' });
      continue;
    }
    if (context.authheads.includes(outpoint)) {
      if (!context.allowIdentitySpends) {
        refusals.push({ outpoint, reason: 'identityHeld' });
        continue;
      }
      // the authchain continues through output 0, so that is the output that has to be this wallet's
      const newAuthhead = outputs[0];
      if (!newAuthhead || !context.ownsOutput(newAuthhead)) {
        refusals.push({ outpoint, reason: 'identityLeaves' });
        continue;
      }
      const category = coin.token?.category;
      returning.push({
        outpoint,
        kind: 'authhead',
        ...(category ? { category } : {}),
        before: carriedByCoin(coin),
        after: carriedByOutput(newAuthhead, category),
      });
      continue;
    }
    // a held coin this wallet cannot account for: refused because it cannot be checked
    refusals.push({ outpoint, reason: 'held' });
  }
  // Each authhead's chain continues through output 0 of the transaction that spends it, so two
  // in one transaction end up sharing one authhead: a merge, which this wallet does not support yet
  const authheadsReturning = returning.filter(entry => entry.kind === 'authhead');
  if (authheadsReturning.length > 1) {
    for (const entry of authheadsReturning) refusals.push({ outpoint: entry.outpoint, reason: 'identityMerge' });
    return { refusals, returning: returning.filter(entry => entry.kind !== 'authhead') };
  }
  return { refusals, returning };
}
