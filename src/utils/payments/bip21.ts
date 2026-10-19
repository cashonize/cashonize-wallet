/**
 * BIP21 URI parsing and building utilities
 * Spec: https://en.bitcoin.it/wiki/BIP_0021
 *
 * Supports both Bitcoin Cash (bitcoincash:, bchtest:) URI schemes
 *
 * Note: BIP72 extends BIP21 with an `r` parameter for fetching BIP70 payment requests.
 * Some implementations also embed BIP70-like params directly (time, exp, sig).
 * BIP70 is largely deprecated - we don't handle these specially, they end up in otherParams.
 *
 * This module knows the BIP21 keys only. Everything else lands in otherParams as raw strings,
 * including the CashTokens parameters, which paymentRequest.ts reads and writes on top of this.
 * Keys are matched case-insensitively, so otherParams holds them lowercased.
 */

import { formatTokenAmountFromBigInt } from 'src/utils/utils'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export interface Bip21ParseResult {
  address: string;
  /** The amount= parameter, converted from whole BCH to satoshis */
  satoshis?: bigint;
  label?: string;
  message?: string;
  /** Other non-required parameters that were present */
  otherParams?: Record<string, string>;
  /** If true, URI contains unknown req-* parameters and should be rejected */
  hasUnknownRequired: boolean;
  /** If true, amount= was present but malformed (violates BIP21 MUST requirement) */
  hasInvalidAmount?: boolean;
  /** If true, URI contains duplicate keys (potential security concern) */
  hasDuplicateKeys?: boolean;
}

/** Valid URI schemes for Bitcoin Cash */
const VALID_SCHEMES = ['bitcoincash:', 'bchtest:'];

/**
 * Parse a BIP21 URI into its components
 *
 * @param uri - The BIP21 URI to parse (e.g., "bitcoincash:qz...?amount=1.5&label=Shop")
 * @returns Parsed result with address, parameters, and validation info
 * @throws Error if the URI is malformed or has an invalid scheme
 */
export function parseBip21Uri(uri: string): Bip21ParseResult {
  if (!uri || typeof uri !== 'string') {
    throw new Error('URI must be a non-empty string');
  }

  // Check for valid scheme
  const lowerUri = uri.toLowerCase();
  const scheme = VALID_SCHEMES.find(s => lowerUri.startsWith(s));
  if (!scheme) {
    throw new Error(`Invalid URI scheme. Expected one of: ${VALID_SCHEMES.join(', ')}`);
  }

  // Split into address and query parts
  const [address, queryString] = uri.split("?");

  // Validate address has something after the scheme
  if (!address || address.length <= scheme.length) {
    throw new Error('URI must contain an address');
  }

  const result: Bip21ParseResult = {
    address,
    hasUnknownRequired: false,
  };

  // Parse query parameters if present
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const otherParams: Record<string, string> = {};
    const seenKeys = new Set<string>();

    for (const [key, value] of params.entries()) {
      const lowerKey = key.toLowerCase();

      // Detect duplicate keys
      if (seenKeys.has(lowerKey)) {
        result.hasDuplicateKeys = true;
      }
      seenKeys.add(lowerKey);

      switch (lowerKey) {
        case 'amount': {
          const satoshis = parseAmountAsSatoshis(value);
          if (satoshis !== undefined) {
            result.satoshis = satoshis;
          } else {
            result.hasInvalidAmount = true;
          }
          break;
        }
        case 'label':
          result.label = value;
          break;
        case 'message':
          result.message = value;
          break;
        default:
          if (lowerKey.startsWith('req-')) {
            result.hasUnknownRequired = true;
          } else {
            otherParams[lowerKey] = value;
          }
      }
    }

    if (Object.keys(otherParams).length > 0) {
      result.otherParams = otherParams;
    }
  }

  return result;
}

/**
 * Format satoshis as the whole-BCH decimal string BIP21 asks for, without trailing zeros.
 * Uses integer math so amounts never pick up floating point artifacts.
 */
export function formatSatoshisAsBch(satoshis: bigint): string {
  return formatTokenAmountFromBigInt(satoshis, 8);
}

/**
 * Parse an amount= value into satoshis. BIP21 allows only digits with an optional period as the
 * decimal separator; more than 8 decimals would be a fraction of a satoshi.
 * @returns The amount in satoshis, or undefined if the value does not follow that grammar
 */
function parseAmountAsSatoshis(value: string): bigint | undefined {
  const match = /^(\d*)(?:\.(\d{0,8}))?$/.exec(value);
  if (!match) return undefined;
  const [, whole = '', fraction = ''] = match;
  if (!whole && !fraction) return undefined;
  return BigInt(whole || '0') * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}

/**
 * Check if a string is a valid BIP21 URI
 */
export function isBip21Uri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false;
  }

  const lowerUri = uri.toLowerCase();
  return VALID_SCHEMES.some(s => lowerUri.startsWith(s));
}

/**
 * The address a pasted or scanned string points at: the address part of a BIP21 URI, or the
 * input unchanged when it is not one. Used to check the address before the rest of the URI
 * is looked at, so a malformed URI still gets judged on the address it carries.
 */
export function addressFromUri(content: string) {
  if (!isBip21Uri(content) || !content.includes("?")) return content;
  try {
    return parseBip21Uri(content).address;
  } catch {
    // not parseable as a URI, treat the whole input as the address
    return content;
  }
}

/**
 * Check a parsed BIP21 result for validation errors that should block payment.
 * @returns Error message string if invalid, null if valid
 */
export function getBip21ValidationError(parsed: Bip21ParseResult): string | null {
  if (parsed.hasUnknownRequired) return t('bip21.errors.unsupportedPaymentRequest');
  if (parsed.hasDuplicateKeys) return t('bip21.errors.duplicateParameters');
  if (parsed.hasInvalidAmount) return t('bip21.errors.invalidAmountFormat');
  return null;
}
