import { deleteNamedWallet, getAddrsByXpubKey, getNamedWalletId, getNetworkProvider, getXPubKey, NetworkType } from "@cashonize/bch-wallet-lib"
import { deriveSeedFromBip39Mnemonic } from "@bitauth/libauth"
import { GAP_LIMIT } from "src/utils/wallet/walletUtils"
import { walletDbName } from "src/utils/wallet/networks"
import { i18n } from "src/boot/i18n"
const { t } = i18n.global

// Older versions stored a chipnet copy of every wallet created or imported: the mainnet id
// with its network replaced, so the same keys on both networks (docs/indexeddb.md). These find
// such a copy and remove one that holds no coins, for the developer setting that unties a wallet.

// The stored id of the wallet's chipnet copy, when the chipnet row is exactly that
export async function tiedChipnetCopy(walletName: string): Promise<string | undefined> {
  const mainnetId = await getNamedWalletId(walletName, walletDbName('mainnet'));
  const chipnetId = await getNamedWalletId(walletName, walletDbName('chipnet'));
  if (!mainnetId || !chipnetId) return undefined;
  const [mainnetKind, mainnetNetwork, ...mainnetRest] = mainnetId.split(':');
  const [chipnetKind, chipnetNetwork, ...chipnetRest] = chipnetId.split(':');
  // the copies were only ever made of seed phrase wallets
  if (mainnetKind !== 'hd' && mainnetKind !== 'seed') return undefined;
  if (mainnetKind !== chipnetKind || mainnetNetwork !== 'mainnet' || chipnetNetwork !== 'testnet') return undefined;
  if (mainnetRest.join(':') !== chipnetRest.join(':')) return undefined;
  return chipnetId;
}

// What the chipnet copy holds on chipnet: 'unused' (no history), 'empty' (history, but no coins)
// or 'holdsCoins' (BCH or tokens). Removing a copy that holds no coins loses nothing: its keys are
// in the mainnet row, its history stays on the chain. An id of another form, or an HD copy used
// past the scan limit, counts as holding coins.
export type ChipnetCopyState = 'unused' | 'empty' | 'holdsCoins';

// How far an HD copy's chains are followed at most, an HD wallet used this far being implausible
const MAX_SCANNED_PER_CHAIN = 1000;
// Address lookups are pipelined over the one electrum connection in batches
const SCAN_BATCH_SIZE = 10;

// The account xpub and how to walk a stored seed or HD id's addresses: an HD wallet's receive and
// change chains and the defi chain WizardConnect dApps use (7), or the one address of a
// single-address wallet. Undefined for an id of another form.
function chipnetAddressSource(walletId: string): { xpub: string; chains: string[]; single: boolean } | undefined {
  const [kind, , mnemonic, path] = walletId.split(':');
  if (!mnemonic || !path) return undefined;
  const seed = deriveSeedFromBip39Mnemonic(mnemonic);
  if (kind === 'hd') {
    return { xpub: getXPubKey(seed, path, NetworkType.Testnet), chains: ['0', '1', '7'], single: false };
  }
  if (kind === 'seed') {
    // the full path of the one address: the account's xpub, then its unhardened branch and index
    const components = path.split('/');
    const relative = components.slice(-2);
    if (components.length < 3 || relative.some(component => component.endsWith("'"))) return undefined;
    const xpub = getXPubKey(seed, components.slice(0, -2).join('/'), NetworkType.Testnet);
    return { xpub, chains: [relative.join('/')], single: true };
  }
  return undefined;
}

export async function chipnetCopyState(chipnetId: string): Promise<ChipnetCopyState> {
  const source = chipnetAddressSource(chipnetId);
  if (!source) return 'holdsCoins';
  const provider = getNetworkProvider(NetworkType.Testnet);
  const usedAddresses: string[] = [];
  for (const chain of source.chains) {
    if (source.single) {
      const address = getAddrsByXpubKey(source.xpub, chain, 1)[0]!;
      if ((await provider.getHistory(address)).length > 0) usedAddresses.push(address);
      continue;
    }
    // follow the chain until GAP_LIMIT addresses in a row are unused, as discovery does
    let index = 0;
    let unusedInARow = 0;
    while (unusedInARow < GAP_LIMIT) {
      if (index >= MAX_SCANNED_PER_CHAIN) return 'holdsCoins';
      const batch = getAddrsByXpubKey(source.xpub, `${chain}/${index}`, SCAN_BATCH_SIZE);
      const histories = await Promise.all(batch.map(address => provider.getHistory(address)));
      histories.forEach((history, position) => {
        if (history.length > 0) {
          usedAddresses.push(batch[position]!);
          unusedInARow = 0;
        } else {
          unusedInARow++;
        }
      });
      index += SCAN_BATCH_SIZE;
    }
  }
  if (usedAddresses.length === 0) return 'unused';
  for (let i = 0; i < usedAddresses.length; i += SCAN_BATCH_SIZE) {
    const batch = usedAddresses.slice(i, i + SCAN_BATCH_SIZE);
    const utxos = await Promise.all(batch.map(address => provider.getUtxos(address)));
    if (utxos.some(addressUtxos => addressUtxos.length > 0)) return 'holdsCoins';
  }
  return 'empty';
}

// Deletes the chipnet copy the user checked, once it still holds no coins and, read immediately
// before the delete, is still that copy of the mainnet row: the slow chipnet reads come first, so a
// row changed meanwhile (another tab deleting the wallet and making a new one of that name) is
// caught. Throws, having deleted nothing, when any of that fails or cannot be told.
export async function removeEmptyChipnetCopy(walletName: string, checkedChipnetId: string): Promise<void> {
  if (await chipnetCopyState(checkedChipnetId) === 'holdsCoins') {
    throw new Error(t('store.errors.chipnetCopyHoldsCoins', { name: walletName }));
  }
  const chipnetId = await tiedChipnetCopy(walletName);
  if (chipnetId === undefined || chipnetId !== checkedChipnetId) {
    throw new Error(t('store.errors.chipnetCopyChanged', { name: walletName }));
  }
  await deleteNamedWallet(walletName, walletDbName('chipnet'));
}
