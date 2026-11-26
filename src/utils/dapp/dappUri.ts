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

/** A pairing URI as a QR code carries it; WalletConnect's is checked in full, the others on pairing */
export function isScannableDappUri(content: string): boolean {
  const matchWalletConnect = /^wc:([0-9a-fA-F]{64})@(\d+)\?([a-zA-Z0-9\-._~%!$&'()*+,;=:@/?=&]*)$/i.test(content);
  // WizardConnect QR codes use an uppercased, percent-escaped alphanumeric-mode form
  // (WIZ://%3FP%3D...), so only the scheme is matched
  const matchWizardConnect = /^wiz:\/\//i.test(content);
  return matchWalletConnect || isCashConnectUri(content) || matchWizardConnect;
}
