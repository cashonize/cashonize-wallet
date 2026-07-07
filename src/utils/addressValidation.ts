import { decodeCashAddress } from "@bitauth/libauth";

const CASH_ADDRESS_PREFIXES = ["bitcoincash:", "bchtest:"];

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
