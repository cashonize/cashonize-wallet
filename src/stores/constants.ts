// Constants extracted to this file to solve circular dependencies between stores.
// store.ts imports from settingsStore.ts, and settingsStore.ts needs defaultWalletName,
// which would create a circular import if defined in store.ts.

export const defaultWalletName = 'mywallet';

// WalletConnect/CashConnect configuration used by both walletconnectStore.ts and cashconnectStore.ts.
// Centralized here to avoid duplication and ensure consistency.
export const walletConnectProjectId = '3fd234b8e2cd0e1da4bc08a0011bbf64';

export const walletConnectMetadata = {
  name: 'Cashonize',
  description: 'Cashonize Bitcoin Cash Wallet',
  url: 'https://cashonize.com',
  icons: ['https://cashonize.com/icons/favicon-128x128.png'],
};
