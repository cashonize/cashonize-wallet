import { deleteNamedWallet, getAddrsByXpubKey, getNamedWalletId, getNetworkProvider, getXPubKey, NetworkType } from "@cashonize/bch-wallet-lib"
import { deriveSeedFromBip39Mnemonic } from "@bitauth/libauth"
import { anyAddressHasActivity, GAP_LIMIT } from "src/utils/wallet/walletUtils"
import { walletDbName } from "src/utils/wallet/networks"
import { i18n } from "src/boot/i18n"
const { t } = i18n.global

// Older versions stored a chipnet copy of every wallet created or imported: the mainnet id
// with its network replaced, so the same keys on both networks (docs/indexeddb.md). These find
// such a copy and remove an unused one, for the developer setting that unties a wallet.

// The stored id of the wallet's chipnet copy, when the chipnet row is exactly that
export async function tiedChipnetCopy(walletName: string): Promise<string | undefined> {
  const mainnetId = await getNamedWalletId(walletName, walletDbName('mainnet'));
  const chipnetId = await getNamedWalletId(walletName, walletDbName('chipnet'));
  if (!mainnetId || !chipnetId) return undefined;
  const [mainnetKind, mainnetNetwork, ...mainnetRest] = mainnetId.split(':');
  const [chipnetKind, chipnetNetwork, ...chipnetRest] = chipnetId.split(':');
  if (mainnetKind !== chipnetKind || mainnetNetwork !== 'mainnet' || chipnetNetwork !== 'testnet') return undefined;
  if (mainnetRest.join(':') !== chipnetRest.join(':')) return undefined;
  return chipnetId;
}

// The chipnet addresses of a stored seed or HD id that hold its history, if any: the one address
// of a single-address wallet, or the first GAP_LIMIT receive and change addresses of an HD wallet
// (BIP44 wallets fill addresses from index 0). Undefined for an id of another form.
function chipnetAddressesOf(walletId: string): string[] | undefined {
  const [kind, , mnemonic, path] = walletId.split(':');
  if (!mnemonic || !path) return undefined;
  const seed = deriveSeedFromBip39Mnemonic(mnemonic);
  if (kind === 'hd') {
    const xpub = getXPubKey(seed, path, NetworkType.Testnet);
    return [...getAddrsByXpubKey(xpub, "0/0", GAP_LIMIT), ...getAddrsByXpubKey(xpub, "1/0", GAP_LIMIT)];
  }
  if (kind === 'seed') {
    // the full path of the one address: the account's xpub, then its unhardened branch and index
    const components = path.split('/');
    const relative = components.slice(-2);
    if (components.length < 3 || relative.some(component => component.endsWith("'"))) return undefined;
    const xpub = getXPubKey(seed, components.slice(0, -2).join('/'), NetworkType.Testnet);
    return getAddrsByXpubKey(xpub, relative.join('/'), 1);
  }
  return undefined;
}

// Whether the chipnet copy was used on chipnet; true when that cannot be told from its id
export async function chipnetCopyHasHistory(chipnetId: string): Promise<boolean> {
  const addresses = chipnetAddressesOf(chipnetId);
  if (!addresses) return true;
  return anyAddressHasActivity(getNetworkProvider(NetworkType.Testnet), addresses);
}

// Deletes the chipnet copy, checking right before the delete that the chipnet row is still the copy
// the user checked, that the mainnet row still holds the same keys, and that the copy is still
// unused. Throws, having deleted nothing, when any of that fails or cannot be told.
export async function removeUnusedChipnetCopy(walletName: string, checkedChipnetId: string): Promise<void> {
  const chipnetId = await tiedChipnetCopy(walletName);
  if (chipnetId === undefined || chipnetId !== checkedChipnetId) {
    throw new Error(t('store.errors.chipnetCopyChanged', { name: walletName }));
  }
  if (await chipnetCopyHasHistory(chipnetId)) {
    throw new Error(t('store.errors.chipnetCopyUsed', { name: walletName }));
  }
  await deleteNamedWallet(walletName, walletDbName('chipnet'));
}
