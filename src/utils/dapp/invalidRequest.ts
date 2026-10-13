// Reports a dapp request the wallet refused as malformed. The details always go to the console; in
// strict validation mode, the developer setting for testing a dapp, they also open in a dialog, since
// a toast hides why the request was refused. Ordinary users only get the toast.
import { Dialog } from 'quasar'
import { useSettingsStore } from 'src/stores/settingsStore'
import { displayAndLogError } from 'src/utils/errorHandling'
import dappRequestErrorDialog from 'src/components/general/dappRequestErrorDialog.vue'

export function reportInvalidDappRequest(message: string, details: string) {
  console.error(details);
  if (useSettingsStore().strictWcSchema) {
    Dialog.create({ component: dappRequestErrorDialog, componentProps: { message, details } });
    return;
  }
  displayAndLogError(message);
}
