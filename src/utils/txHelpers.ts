// Shared helpers for the transaction lifecycle in components:
// user confirmation, progress notification and success reporting.
// For error display, use displayAndLogError from errorHandling.ts.
import { Dialog, Notify } from "quasar";
import alertDialog from 'src/components/general/alertDialog.vue'
import { useStore } from 'src/stores/store'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

// Promisified Quasar confirmation dialog, resolves to false on cancel
export function confirmDialog(
  title: string, message: string, okLabel: string, okColor: 'primary' | 'red' = 'primary'
): Promise<boolean> {
  return new Promise((resolve) => {
    Dialog.create({
      title,
      message,
      cancel: { flat: true, color: 'dark' },
      ok: { label: okLabel, color: okColor, textColor: 'white' },
      persistent: true
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

// Shows the success dialog + toast, logs the tx and refreshes the wallet state
// txId can be undefined because mainnet-js send() types its txId as optional
export async function showTransactionResult(alertMessage: string, txId: string | undefined, successMessage: string){
  const store = useStore()
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
  console.log(alertMessage);
  console.log(`${store.explorerUrl}/${txId}`);
  // update utxo list
  await store.updateWalletUtxos();
  // update wallet history as fire-and-forget promise
  void store.updateWalletHistory();
}
