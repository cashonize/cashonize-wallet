// The arithmetic and the readiness checks of the create page, apart from the page so they can be
// tested: amounts typed in tokens become base units by the chosen decimals, and a metadata
// location counts only once the wallet has fetched and verified what it serves.

import { NFTCapability, TokenSendRequest, type OpReturnData, type TokenGenesisRequest, type Utxo } from '@cashonize/bch-wallet-lib';
import { binToHex, decodeCashAddress, type CashAddressNetworkPrefix, type TransactionCommon } from '@bitauth/libauth';
import type { RegistrySummary } from './registryFile';
import { tokenOutputValue } from './authchainIdentity';
import { authGuardAddress, isAuthGuardOf, STUDIO_KEY_COMMITMENT } from './authGuard';
import { i18n } from 'src/boot/i18n';
const { t } = i18n.global;

// A category's fungible supply is capped at the largest signed 64-bit integer
export const maxTokenSupply = 9223372036854775807n;
// BCMR gives no upper bound; 18 is where every wallet's number formatting still copes
export const maxDecimals = 18;

export interface GenesisAmounts {
  supply: bigint;
  circulating: bigint;
  reserve: bigint;
}
export type AmountProblem = 'invalidDecimals' | 'invalidAmount' | 'overMaxSupply' | 'overSupply';

export function parseDecimals(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined;
  const decimals = Number(text);
  return decimals <= maxDecimals ? decimals : undefined;
}

// Tokens typed with up to the chosen decimals, as base units. String math, since these numbers
// outgrow a float; an empty field is zero, so the split can be read while the other is typed.
function toBaseUnits(text: string, decimals: number): bigint | undefined {
  const cleaned = text.trim().replace(/,/g, '');
  if (!cleaned) return 0n;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return undefined;
  const [whole = '', fraction = ''] = cleaned.split('.');
  if (fraction.length > decimals) return undefined;
  return BigInt((whole || '0') + fraction.padEnd(decimals, '0'));
}

// Base units from what was typed in tokens, or the reason the genesis would refuse them
export function genesisAmounts(supplyText: string, circulatingText: string, decimalsText: string): GenesisAmounts | AmountProblem {
  const decimals = parseDecimals(decimalsText);
  if (decimals === undefined) return 'invalidDecimals';
  const supply = toBaseUnits(supplyText, decimals);
  const circulating = toBaseUnits(circulatingText, decimals);
  if (supply === undefined || circulating === undefined) return 'invalidAmount';
  if (supply > maxTokenSupply) return 'overMaxSupply';
  if (circulating > supply) return 'overSupply';
  return { supply, circulating, reserve: supply - circulating };
}

// What the wallet fetched from the typed locations and verified names this category
export interface CheckedRegistry {
  uris: string[];
  summary: RegistrySummary;
  hash: string;
}

// What stands between the typed locations and Create: nothing while none is typed, a check once
// one is, a fresh check once they were edited, and the registry agreeing on the decimals
export type MetadataReadiness = 'none' | 'unchecked' | 'decimalsMismatch' | 'ready';

export function metadataReadiness(uris: string[], checked: CheckedRegistry | undefined, decimals: number): MetadataReadiness {
  if (!uris.length) return 'none';
  if (!checked || checked.uris.length !== uris.length || checked.uris.some((uri, index) => uri !== uris[index])) {
    return 'unchecked';
  }
  // a registry that says nothing about decimals means zero, per the spec
  if ((checked.summary.decimals ?? 0) !== decimals) return 'decimalsMismatch';
  return 'ready';
}

// The UTXOs an identity can start from: at output 0, since that is where a category is read from,
// and without a token, since a token UTXO already belongs to one. Largest first for a genesis,
// which returns the change; smallest first for an identity, which keeps the whole UTXO.
export function genesisCandidates(utxos: Utxo[], order: 'largest' | 'smallest' = 'largest'): Utxo[] {
  const sign = order === 'largest' ? 1 : -1;
  return utxos
    .filter(utxo => !utxo.token && utxo.vout === 0)
    .sort((left, right) => sign * Number(right.satoshis - left.satoshis));
}

// What the genesis issues to circulation: nothing when everything stays in the reserve, since a
// token output with neither an amount nor an NFT is invalid and the library refuses to build one
export function circulationOutputs(tokenAddress: string, category: string, amount: bigint, value: bigint) {
  if (amount <= 0n) return [];
  return [new TokenSendRequest({ cashaddr: tokenAddress, category, amount, value })];
}

// The UTXO whose txid becomes an AuthKey's category. The user has no reason to choose it, so the
// wallet picks it: the smallest candidate left once the token's own genesis input is taken, since
// only its change comes back.
export function authKeyGenesisInput(utxos: Utxo[], tokenInput: Utxo | undefined): Utxo | undefined {
  return genesisCandidates(utxos, 'smallest').find(utxo => utxo.txid !== tokenInput?.txid);
}

// What a prepared UTXO carries, which stays the user's: the genesis or the identity spends it to self
export const preparedUtxoValue = 10_000n;

// "Step 1 of 3: title", the same on the open step and on the greyed list under it
export function stepLabel(current: number, total: number, title: string): string {
  return `${t('createTokens.step', { current, total })}: ${title}`;
}

// What the create page made, shown in its place as the last step until the user starts over
export interface CreatedToken {
  category: string;
  txId: string | undefined;
  name?: string;
  symbol?: string;
  iconUrl?: string;
  guarded: boolean;
  hasSupply: boolean;
  supply: bigint;
  reserve: bigint;
  circulating: bigint;
  decimals: number;
}

export interface GenesisPlan {
  tokenCategory: string;
  walletTokenAddress: string;
  reserve: bigint;
  mintingNft: boolean;
  circulating: bigint;
  publication?: OpReturnData;
  // the AuthKey's category, for a genesis that keeps the identity in an AuthGuard
  keyCategory?: string;
}

// The genesis requests and the outputs beside them. Output 0 is the authhead, carrying the reserve
// and the minting NFT if there is one: in this wallet, or in an AuthGuard with the AuthKey at
// output 1, the order CashTokens Studio builds it in. Then what enters circulation and the
// publication. The requests take the picked genesis inputs in order, so the key's category is its
// own input's, never the token's: any NFT of the key's category opens the guard, and a token's own
// category gains NFTs whenever it has a minting NFT.
export function genesisOutputs(plan: GenesisPlan) {
  const authhead: TokenGenesisRequest = {
    cashaddr: plan.walletTokenAddress,
    amount: plan.reserve,
    value: tokenOutputValue,
    ...(plan.mintingNft ? { nft: { commitment: "", capability: NFTCapability.minting } } : {}),
  };
  const genesisRequests: TokenGenesisRequest[] = [authhead];
  if (plan.keyCategory) {
    const decoded = decodeCashAddress(plan.walletTokenAddress);
    if (typeof decoded === 'string') throw new Error(decoded);
    authhead.cashaddr = authGuardAddress(plan.keyCategory, decoded.prefix as CashAddressNetworkPrefix);
    genesisRequests.push({
      cashaddr: plan.walletTokenAddress,
      value: tokenOutputValue,
      nft: { commitment: STUDIO_KEY_COMMITMENT, capability: NFTCapability.none },
    });
  }
  const extraOutputs: (TokenSendRequest | OpReturnData)[] = [
    ...circulationOutputs(plan.walletTokenAddress, plan.tokenCategory, plan.circulating, tokenOutputValue),
    ...(plan.publication ? [plan.publication] : []),
  ];
  return { genesisRequests, extraOutputs };
}

// Whether a built AuthGuard genesis is what was planned before it is sent: the guard at output 0
// opened by the key category, the key at output 1. A guard of any other category would lock the
// reserve and the minting NFT for good, since no key for it exists.
export function guardsAsPlanned(transaction: TransactionCommon, keyCategory: string): boolean {
  const [guard, key] = transaction.outputs;
  if (!guard || !key?.token?.nft) return false;
  return isAuthGuardOf(keyCategory, binToHex(guard.lockingBytecode))
    && binToHex(key.token.category) === keyCategory
    && key.token.nft.capability === 'none'
    && binToHex(key.token.nft.commitment) === STUDIO_KEY_COMMITMENT;
}
