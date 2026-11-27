// The general scanner takes any code the wallet can act on and says which page it belongs to.
// Each page then does what it does with typed or pasted input: fill a form or ask for approval.

import { decodeCashAddress } from '@bitauth/libauth'
import { isScannableDappUri } from 'src/utils/dapp/dappUri'
import { addressFromUri } from 'src/utils/payments/bip21'
import { getCashAddressScanError } from 'src/utils/payments/recipientAddress'
import { isLegacyAddress } from 'src/utils/addressValidation'
import { getPrivateKeyScanError, isPrivateKeyCode } from 'src/utils/tools/privateKeyScan'
import type { AppNetwork } from 'src/utils/wallet/networks'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type ScanRoute = { page: 'send' | 'connect' | 'sweep' } | { error: string }

export function routeScannedCode(content: string, network: AppNetwork, networkPrefix: string): ScanRoute {
  if (isScannableDappUri(content)) return { page: 'connect' };

  // An address of any network gets the address's own reason when it is refused
  const address = addressFromUri(content);
  if (isLegacyAddress(address) || typeof decodeCashAddress(address) !== 'string') {
    const addressError = getCashAddressScanError(content, networkPrefix);
    return addressError ? { error: addressError } : { page: 'send' };
  }

  if (isPrivateKeyCode(content)) {
    const keyError = getPrivateKeyScanError(content, network);
    return keyError ? { error: keyError } : { page: 'sweep' };
  }

  return { error: t('qrScanner.errors.nothingToDo') };
}
