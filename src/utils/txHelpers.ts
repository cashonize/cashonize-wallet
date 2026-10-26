// Shared helpers for the transaction lifecycle in components:
// user confirmation, progress notification and success reporting.
// For error display, use displayAndLogError from errorHandling.ts.
import { Dialog, Notify } from "quasar";
import alertDialog from 'src/components/general/alertDialog.vue'
import sendSuccessDialog from 'src/components/general/sendSuccessDialog.vue'
import sendConfirmDialog from 'src/components/general/sendConfirmDialog.vue'
import { useStore } from 'src/stores/store'
import { useIdentitiesStore } from 'src/stores/identitiesStore'
import { useSettingsStore } from 'src/stores/settingsStore'
import { displayAndLogError } from 'src/utils/errorHandling'
import { identityRefusal, refusalMessage, type ReservedInputsCheck } from 'src/utils/dapp/reservedInputs'
import type { SendSummary } from 'src/interfaces/interfaces'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// A dapp request refused for an identity's sake is told in a dialog: there is something to know,
// which identity, and something to do, the option under user options. A pledged or frozen coin's
// refusal stays a toast like every other error.
export function reportDappRefusal(check: ReservedInputsCheck) {
  const refusal = identityRefusal(check)
  if (!refusal) {
    displayAndLogError(refusalMessage(check))
    return
  }
  const identitiesStore = useIdentitiesStore()
  const message = refusalMessage(check, identitiesStore.identityNameAt(refusal.outpoint))
  console.error(message)
  Dialog.create({
    title: t('store.errors.dappRefusedTitle'),
    message,
    ok: { color: 'primary', textColor: 'white' },
  })
}

// Promisified Quasar confirmation dialog, resolves to false on cancel
export function confirmDialog(
  title: string, message: string, okLabel: string, okColor: 'primary' | 'red' = 'primary'
): Promise<boolean> {
  const settingsStore = useSettingsStore()
  const cancelColor = settingsStore.darkMode ? 'white' : 'dark'
  return new Promise((resolve) => {
    Dialog.create({
      title,
      message,
      cancel: { flat: true, color: cancelColor },
      ok: { label: okLabel, color: okColor, textColor: 'white' },
      persistent: true
    }).onOk(() => resolve(true))
      .onCancel(() => resolve(false))
  })
}

// The review before a send, resolves to false when the user backs out
export function confirmSend(summary: SendSummary): Promise<boolean> {
  return new Promise((resolve) => {
    Dialog.create({
      component: sendConfirmDialog,
      componentProps: { summary }
    }).onOk(() => resolve(true))
      .onCancel(() => resolve(false))
  })
}

export function notifySending(message?: string){
  Notify.create({
    spinner: true,
    message: message ?? t('common.status.sending'),
    color: 'grey-5',
    timeout: 1000
  })
}

// Handles a successful transaction broadcast: shows feedback, logs the tx and refreshes wallet state.
// A send passes `sendInfo` and gets the success screen, which replaces the dialog and the toast;
// the other broadcasts (burns, mints, pledges, identity updates) keep the message dialog.
export async function handleTransactionBroadcastSuccess(
  alertMessage: string, txId: string, successMessage: string, sendInfo?: SendSummary
){
  const store = useStore()
  if (sendInfo) {
    Dialog.create({
      component: sendSuccessDialog,
      componentProps: {
        sendInfo: { ...sendInfo, txid: txId }
      }
    })
  } else {
    Dialog.create({
      component: alertDialog,
      componentProps: {
        alertInfo: { message: alertMessage, txid: txId }
      }
    })
    Notify.create({
      type: 'positive',
      message: successMessage
    })
  }
  console.log(alertMessage);
  console.log(`${store.explorerUrl}/${txId}`);
  // update utxo list
  await store.updateWalletUtxos();
  // update wallet history as fire-and-forget promise
  void store.updateWalletHistory();
}
