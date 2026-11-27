// What a scanned code has to be to go into the sweep tool, shared by its own scanner and the
// general one.

import { NetworkType, decodeWif } from '@cashonize/bch-wallet-lib'
import { isBip38Key } from 'src/utils/tools/bip38'
import type { AppNetwork } from 'src/utils/wallet/networks'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function withoutWifScheme(input: string) {
  return input.startsWith('bch-wif:') ? input.slice(8) : input;
}

/** A private key in a form the sweep tool reads, of whichever network */
export function isPrivateKeyCode(content: string) {
  const key = withoutWifScheme(content);
  if (isBip38Key(key)) return true;
  try {
    decodeWif(key);
    return true;
  } catch {
    return false;
  }
}

/** Reason a scanned code cannot be swept on this network, or undefined when it can */
export function getPrivateKeyScanError(content: string, network: AppNetwork) {
  const key = withoutWifScheme(content);
  // Encrypted keys are the same on both networks, so which one it is only shows after decrypting
  if (isBip38Key(key)) return undefined;
  let wifNetwork: NetworkType;
  try {
    wifNetwork = decodeWif(key).network;
  } catch {
    return t('sweepPrivateKey.qrErrors.notWif');
  }
  if (network === 'mainnet' && wifNetwork !== NetworkType.Mainnet) {
    return t('sweepPrivateKey.qrErrors.notMainnetWif');
  }
  if (network !== 'mainnet' && wifNetwork !== NetworkType.Testnet) {
    return t('sweepPrivateKey.qrErrors.notTestnetWif', { network });
  }
}
