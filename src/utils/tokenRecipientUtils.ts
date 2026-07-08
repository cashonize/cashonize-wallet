import { Notify } from "quasar";
import { decodeCashAddress } from "@bitauth/libauth"
import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation';
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function parseTokenRecipientRequest(addressInput: string, expectedCategory: string) {
  if(!isBip21Uri(addressInput) || !addressInput.includes("?")) return;

  try {
    const parsed = parseBip21Uri(addressInput);
    const validationError = getBip21ValidationError(parsed);
    if (validationError) {
      Notify.create({ message: validationError, icon: 'warning', color: "red" });
      return;
    }

    if(parsed.otherParams?.c && parsed.otherParams.c !== expectedCategory){
      Notify.create({ message: t('tokenItem.errors.differentTokenRequest'), icon: 'warning', color: "grey-7" });
      return;
    }

    return { address: parsed.address, otherParams: parsed.otherParams };
  } catch {
    // If parsing fails, leave the input as-is.
  }
}

export function getCashAddressScanError(content: string, networkPrefix: string): string | undefined {
  let addressToCheck = content;
  if(isBip21Uri(content) && content.includes("?")){
    try {
      const parsed = parseBip21Uri(content);
      addressToCheck = parsed.address;
    } catch {
      // If parsing fails, try with original content.
    }
  }
  const decoded = decodeCashAddress(addressToCheck);
  if (typeof decoded === "string" || decoded.prefix !== networkPrefix) {
    return t('tokenItem.errors.notCashaddress');
  }
}

export function validateTokenRecipientAddress(
  destinationAddr: string,
  networkPrefix: string,
  opts?: { requireTokenSupport?: boolean }
): string {
  if(!destinationAddr) throw new Error(t('tokenItem.errors.noDestination'));
  const { address, decodedAddress } = normalizeCashAddressForNetwork(destinationAddr, networkPrefix, {
    invalidAddress: t('tokenItem.errors.invalidAddress'),
    wrongNetwork: t('tokenItem.errors.notCashaddress'),
  });
  if(opts?.requireTokenSupport){
    const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
    if(!supportsTokens) throw new Error(t('tokenItem.errors.notTokenAddress'));
  }
  return address;
}
