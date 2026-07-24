import { PROTOCOL_HANDLER } from '@cashconnect-js/nostr';

// URI schemes of the supported dApp connection methods, defined once so the deep-link /
// URL-param filter (WalletPage) and the connect handling (connectDapp) can't drift apart.
export const WALLETCONNECT_SCHEME = 'wc:';
export const CASHCONNECT_SCHEME = PROTOCOL_HANDLER;
export const WIZARDCONNECT_SCHEME = 'wiz:';

export function isWalletConnectUri(uri: string): boolean {
  return uri.startsWith(WALLETCONNECT_SCHEME);
}

export function isCashConnectUri(uri: string): boolean {
  return uri.startsWith(CASHCONNECT_SCHEME);
}

// Case-insensitive: WizardConnect QR codes use an uppercased alphanumeric-mode form (WIZ://...)
export function isWizardConnectUri(uri: string): boolean {
  return uri.toLowerCase().startsWith(WIZARDCONNECT_SCHEME);
}

export function isDappConnectionUri(uri: string): boolean {
  return isWalletConnectUri(uri) || isCashConnectUri(uri) || isWizardConnectUri(uri);
}
