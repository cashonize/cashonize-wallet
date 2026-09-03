// The arithmetic and the readiness checks of the create page, apart from the page so they can be
// tested: amounts typed in tokens become base units by the chosen decimals, and a metadata
// location counts only once the wallet has fetched and verified what it serves.

import { formatTokenAmountFromBigInt } from '../utils';
import type { RegistrySummary } from './authchainIdentity';

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

// Tokens with thousands separators, the way the amounts are shown back
export function formatTokens(baseUnits: bigint, decimals: number): string {
  const [whole = '', fraction] = formatTokenAmountFromBigInt(baseUnits, decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
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
