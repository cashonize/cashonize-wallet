import { Notify } from "quasar"
import { useStore } from 'src/stores/store'
import { useCashconnectStore } from 'src/stores/cashconnectStore'
import { useWalletconnectStore } from 'src/stores/walletconnectStore'
import { confirmDialog } from 'src/utils/txHelpers'
import { isQuotaExceededError } from 'src/utils/errorHandling'
import { checkSeedWalletConvertible, makeError, storeSeedWalletAsHd, type WalletOperationResult } from 'src/utils/wallet/walletUtils'
import type { AppNetwork } from 'src/utils/wallet/networks'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// How long the CashConnect dApps are given to be told their sessions end, so an unreachable relay
// cannot hold up the conversion
const CASHCONNECT_DISCONNECT_TIMEOUT_MS = 3000;

// Set while a conversion runs, so a second one cannot rewrite the same row meanwhile
let converting = false;

// Converts the active single-address wallet, as checked before the user confirmed, into the HD
// wallet on the same seed and reopens it, so its state resets and HD discovery runs. The HD wallet's
// CashConnect identity key is another one, so the CashConnect sessions are ended first: they could
// not continue. Reopening resets the dApp connections, which ends the WalletConnect sessions too.
async function convertActiveWalletToHd(walletName: string, network: AppNetwork, checkedSeedId: string): Promise<WalletOperationResult> {
  if (converting) return makeError(t('walletUtils.errors.conversionRunning'), true);
  const store = useStore();
  if (store.activeWalletName !== walletName || store.network !== network) {
    return makeError(t('walletUtils.errors.walletChangedBeforeConversion', { name: walletName }), false);
  }
  converting = true;
  // taken before any await, so a wallet switch meanwhile cannot end another wallet's sessions
  const cashConnectWallet = useCashconnectStore().cashConnectWallet;
  let rowWritten = false;
  try {
    if (cashConnectWallet && Object.keys(useCashconnectStore().sessions).length > 0) {
      const disconnect = (async () => {
        try {
          await cashConnectWallet.disconnectAllSessions();
        } catch (error) {
          console.error("Failed to disconnect CashConnect sessions:", error);
        }
      })();
      const timeout = new Promise(resolve => setTimeout(resolve, CASHCONNECT_DISCONNECT_TIMEOUT_MS));
      await Promise.race([disconnect, timeout]);
    }

    const result = await storeSeedWalletAsHd(walletName, network, checkedSeedId);
    if (!result.success) return result;
    rowWritten = true;
    // also sets the wallet type from the stored id, so it says HD only once an HD wallet is loaded
    const hdWallet = await store.loadExistingWallet(walletName, network);
    // another wallet opened meanwhile stays open; this one opens as HD whenever it is opened next
    if (store.activeWalletName !== walletName) return result;
    await store.resetWalletState();
    await store.setWallet(hdWallet);
    void store.initializeWallet();
    return result;
  } catch (error) {
    console.error(error);
    if (rowWritten) {
      return makeError(t('walletUtils.errors.convertedReloadToOpen', { name: walletName }), false);
    }
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.failedToConvert', { name: walletName }), false);
  } finally {
    converting = false;
  }
}

// What converting means, and the dApp connections it ends, for every dialog that offers it
function conversionConsequences(): string {
  let message = t('convertToHd.consequences');
  const cashConnectCount = Object.keys(useCashconnectStore().sessions).length;
  if (cashConnectCount > 0) {
    message += '\n\n' + t('convertToHd.cashConnectSessions', { count: cashConnectCount }, cashConnectCount);
  }
  const walletConnectCount = Object.keys(useWalletconnectStore().activeSessions ?? {}).length;
  if (walletConnectCount > 0) {
    message += '\n\n' + t('convertToHd.walletConnectSessions', { count: walletConnectCount }, walletConnectCount);
  }
  return message;
}

function notifyFailure(message: string, isUserError: boolean) {
  Notify.create({
    message,
    icon: 'warning',
    color: isUserError ? "grey-7" : "red"
  });
}

// Checks the active wallet converts, asks the user and converts it. A wallet that cannot be converted
// is refused before any dialog, so nothing is asked and no connection ends.
export async function confirmAndConvertToHd(): Promise<void> {
  const store = useStore();
  const walletName = store.activeWalletName;
  const network = store.network;
  let check: Awaited<ReturnType<typeof checkSeedWalletConvertible>>;
  try {
    check = await checkSeedWalletConvertible(walletName, network);
  } catch (error) {
    console.error(error);
    notifyFailure(t('walletUtils.errors.failedToConvert', { name: walletName }), false);
    return;
  }
  if (!check.success) {
    notifyFailure(check.message, check.isUserError);
    return;
  }

  // what the wallet gains comes first, then what converting costs
  const message = t('convertToHd.intro') + '\n\n' + conversionConsequences();
  const confirmed = await confirmDialog(t('convertToHd.confirmTitle'), message, t('convertToHd.confirmButton'));
  if (!confirmed) return;

  const result = await convertActiveWalletToHd(walletName, network, check.seedId);
  if (!result.success) {
    notifyFailure(result.message, result.isUserError);
    return;
  }
  Notify.create({
    message: t('convertToHd.converted', { name: walletName }),
    icon: 'info',
    color: "grey-6"
  });
}
