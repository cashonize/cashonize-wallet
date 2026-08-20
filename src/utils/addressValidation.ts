import {
  assertSuccess,
  decodeCashAddress,
  decodeCashAddressFormatWithoutPrefix,
  encodeCashAddress
} from "@bitauth/libauth";

const CASH_ADDRESS_PREFIXES = ["bitcoincash:", "bchtest:"];

// Wallets match their own addresses by the plain p2pkh form: the HD wallet cache is keyed
// that way and single-address wallets compare against their deposit and change address,
// so a token-aware address has to be converted before it can be matched.
// Expects a valid cashaddr, it throws on anything else.
export function toPlainAddress(address: string): string {
  const decodedAddress = assertSuccess(decodeCashAddress(address));
  return encodeCashAddress({
    prefix: decodedAddress.prefix,
    type: "p2pkh",
    payload: decodedAddress.payload,
  }).address;
}

// Token payment requests have to name a token-aware address, while the addresses the wallet
// hands around are the plain p2pkh form. Expects a valid cashaddr, it throws on anything else.
export function toTokenAddress(address: string): string {
  const decodedAddress = assertSuccess(decodeCashAddress(address));
  return encodeCashAddress({
    prefix: decodedAddress.prefix,
    type: "p2pkhWithTokens",
    payload: decodedAddress.payload,
  }).address;
}

// A cashaddr is often written without its prefix, and Electron Cash accepts that form, so a
// campaign template may carry one. Returns the prefixed form, or undefined if it is not a cashaddr.
export function toPrefixedAddress(address: string): string | undefined {
  const trimmedAddress = address.trim();
  const lowerAddress = trimmedAddress.toLowerCase();
  if (CASH_ADDRESS_PREFIXES.some(prefix => lowerAddress.startsWith(prefix))) {
    return typeof decodeCashAddress(trimmedAddress) === "string" ? undefined : trimmedAddress;
  }
  const decodedAddress = decodeCashAddressFormatWithoutPrefix(trimmedAddress);
  if (typeof decodedAddress === "string") return undefined;
  return `${decodedAddress.prefix}:${trimmedAddress}`;
}

export function normalizeCashAddressForNetwork(
  input: string,
  expectedPrefix: string,
  errorMessages: { invalidAddress: string; wrongNetwork: string }
) {
  let address = input.trim();
  const lowerAddress = address.toLowerCase();

  if (!CASH_ADDRESS_PREFIXES.some(prefix => lowerAddress.startsWith(prefix))) {
    address = `${expectedPrefix}:${address}`;
  }

  const decodedAddress = decodeCashAddress(address);
  if (typeof decodedAddress === "string") throw new Error(errorMessages.invalidAddress);
  if (decodedAddress.prefix !== expectedPrefix) throw new Error(errorMessages.wrongNetwork);

  return { address, decodedAddress };
}
