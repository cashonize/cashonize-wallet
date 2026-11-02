import { Notify } from "quasar"
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { useCashconnectStore } from 'src/stores/cashconnectStore'
import { confirmDialog } from 'src/utils/txHelpers'
import { isQuotaExceededError } from 'src/utils/errorHandling'
import { makeError, storeSeedWalletAsHd, type WalletOperationResult } from 'src/utils/wallet/walletUtils'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// How long the CashConnect dApps are given to be told their sessions end, so an unreachable relay
// cannot hold up the conversion
const CASHCONNECT_DISCONNECT_TIMEOUT_MS = 3000;

// Set while a conversion runs, so a second one cannot rewrite the same row meanwhile
let converting = false;

// Converts the active single-address wallet into the HD wallet on the same seed and reopens it, so
// its state resets and HD discovery runs. The HD wallet's CashConnect identity key is another one,
// so the CashConnect sessions are ended first: they could not continue.
export async function convertActiveWalletToHd(): Promise<WalletOperationResult> {
  if (converting) return makeError(t('walletUtils.errors.conversionRunning'), true);
  converting = true;
  const store = useStore();
  const walletName = store.activeWalletName;
  try {
    const network = store.network;
    const cashconnectStore = useCashconnectStore();
    if (Object.keys(cashconnectStore.sessions).length > 0) {
      const disconnect = (async () => {
        try {
          await cashconnectStore.cashConnectWallet?.disconnectAllSessions();
        } catch (error) {
          console.error("Failed to disconnect CashConnect sessions:", error);
        }
      })();
      const timeout = new Promise(resolve => setTimeout(resolve, CASHCONNECT_DISCONNECT_TIMEOUT_MS));
      await Promise.race([disconnect, timeout]);
    }

    const result = await storeSeedWalletAsHd(walletName, network);
    if (!result.success) return result;
    useSettingsStore().setWalletType(walletName, 'hd');
    // another wallet opened meanwhile stays open; this one opens as HD whenever it is opened next
    if (store.activeWalletName !== walletName) return result;
    // loaded before the reset, so a failure leaves the wallet open as it was
    const hdWallet = await store.loadExistingWallet(walletName, network);
    await store.resetWalletState();
    await store.setWallet(hdWallet);
    void store.initializeWallet();
    return result;
  } catch (error) {
    console.error(error);
    if (isQuotaExceededError(error)) {
      return makeError(t('walletUtils.errors.storageFull'), false);
    }
    return makeError(t('walletUtils.errors.failedToConvert', { name: walletName }), false);
  } finally {
    converting = false;
  }
}

// The confirmation and the conversion, for every place that offers it
export async function confirmAndConvertToHd(): Promise<void> {
  const store = useStore();
  const walletName = store.activeWalletName;
  const sessionCount = Object.keys(useCashconnectStore().sessions).length;
  let message = t('convertToHd.confirmMessage');
  if (sessionCount > 0) {
    message += '\n\n' + t('convertToHd.cashConnectSessions', { count: sessionCount }, sessionCount);
  }
  const confirmed = await confirmDialog(t('convertToHd.confirmTitle'), message, t('convertToHd.confirmButton'));
  if (!confirmed) return;

  const result = await convertActiveWalletToHd();
  if (!result.success) {
    Notify.create({
      message: result.message,
      icon: 'warning',
      color: result.isUserError ? "grey-7" : "red"
    });
    return;
  }
  Notify.create({
    message: t('convertToHd.converted', { name: walletName }),
    icon: 'info',
    color: "grey-6"
  });
}
