/**
 * BIP21 URI parsing utilities
 * Spec: https://en.bitcoin.it/wiki/BIP_0021
 *
 * Supports both Bitcoin Cash (bitcoincash:, bchtest:) URI schemes
 *
 * Note: BIP72 extends BIP21 with an `r` parameter for fetching BIP70 payment requests.
 * Some implementations also embed BIP70-like params directly (time, exp, sig).
 * BIP70 is largely deprecated - we don't handle these specially, they end up in otherParams.
 *
 * BCH-specific extensions (c, ft, nft for CashTokens, op_return) also land in otherParams.
 */

export interface Bip21ParseResult {
  address: string;
  amount?: number;
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

      // Detect duplicate keys (potential security concern)
      if (seenKeys.has(lowerKey)) {
        result.hasDuplicateKeys = true;
      }
      seenKeys.add(lowerKey);

      switch (lowerKey) {
        case 'amount': {
          const amount = parseAmount(value);
          if (amount !== undefined) {
            result.amount = amount;
          } else if (value !== '') {
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
            otherParams[key] = value;
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
 * Parse an amount string according to BIP21 rules
 * Amount must use period as decimal separator, no commas
 */
function parseAmount(value: string): number | undefined {
  if (!value) return undefined;

  // BIP21: "All amounts MUST contain no commas and use a period (.) as the separating character"
  if (value.includes(',')) {
    return undefined;
  }

  const amount = parseFloat(value);
  if (isNaN(amount) || amount < 0) {
    return undefined;
  }

  return amount;
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
