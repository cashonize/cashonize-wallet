import type { AppNetwork } from "src/utils/wallet/networks";

// localStorage key holding a Record<topic, `${network}:${walletName}`>. WalletKit keeps one set of
// sessions for the whole app, with nothing in them saying which wallet approved one, so that is
// recorded here: a session is listed and served only while its wallet is the one open.
const WC_SESSION_WALLETS_STORAGE_KEY = "walletConnectSessionWallets";

function readSessionWallets() {
  return JSON.parse(localStorage.getItem(WC_SESSION_WALLETS_STORAGE_KEY) ?? "{}") as Record<string, string>;
}

export function sessionWalletKey(network: AppNetwork, walletName: string) {
  return `${network}:${walletName}`;
}

// a network has no colon in its name, a wallet may
export function parseSessionWalletKey(walletKey: string) {
  const separator = walletKey.indexOf(":");
  return { network: walletKey.slice(0, separator), walletName: walletKey.slice(separator + 1) };
}

export function sessionWalletOf(topic: string): string | undefined {
  return readSessionWallets()[topic];
}

export function setSessionWallet(topic: string, walletKey: string) {
  const sessionWallets = readSessionWallets();
  sessionWallets[topic] = walletKey;
  localStorage.setItem(WC_SESSION_WALLETS_STORAGE_KEY, JSON.stringify(sessionWallets));
}

export function removeSessionWallet(topic: string) {
  const sessionWallets = readSessionWallets();
  if (!(topic in sessionWallets)) return;
  delete sessionWallets[topic];
  localStorage.setItem(WC_SESSION_WALLETS_STORAGE_KEY, JSON.stringify(sessionWallets));
}

// The sessions a wallet has on one network, or on any
export function sessionTopicsOfWallet(walletName: string, network?: AppNetwork): string[] {
  return Object.entries(readSessionWallets())
    .filter(([, walletKey]) => {
      const sessionWallet = parseSessionWalletKey(walletKey);
      return sessionWallet.walletName === walletName && (!network || sessionWallet.network === network);
    })
    .map(([topic]) => topic);
}
