// Validation of an address the user typed, pasted or scanned into a recipient field.
//
// This is the localized layer over the cashaddr primitives in addressValidation, which stay
// message-free and take their error strings as an argument.

import { decodeCashAddress } from "@bitauth/libauth"
import { addressFromUri } from 'src/utils/payments/bip21';
import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

/** Reason a scanned code cannot be used as a recipient, or undefined when it can */
export function getCashAddressScanError(content: string, networkPrefix: string) {
  const decoded = decodeCashAddress(addressFromUri(content));
  if (typeof decoded === "string" || decoded.prefix !== networkPrefix) {
    return t('tokenItem.errors.notCashaddress');
  }
}

function validateAddress(destinationAddr: string, networkPrefix: string, requireTokenSupport: boolean) {
  if(!destinationAddr) throw new Error(t('tokenItem.errors.noDestination'));
  const { address, decodedAddress } = normalizeCashAddressForNetwork(destinationAddr, networkPrefix, {
    invalidAddress: t('tokenItem.errors.invalidAddress'),
    wrongNetwork: t('tokenItem.errors.notCashaddress'),
  });
  if(requireTokenSupport){
    const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
    if(!supportsTokens) throw new Error(t('tokenItem.errors.notTokenAddress'));
  }
  return address;
}

/** For outputs that carry no token, where a plain address is a valid destination */
export function validateRecipientAddress(destinationAddr: string, networkPrefix: string) {
  return validateAddress(destinationAddr, networkPrefix, false);
}

/**
 * For outputs that carry a token. Insisting on a token-aware address does not change where the
 * tokens land, both address forms lock to the same script, but it is how the recipient signals
 * their wallet understands tokens rather than spending the UTXO as plain BCH.
 */
export function validateTokenRecipientAddress(destinationAddr: string, networkPrefix: string) {
  return validateAddress(destinationAddr, networkPrefix, true);
}
