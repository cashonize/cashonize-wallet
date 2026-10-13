// Reports what was signed for a dapp: an entry in the activity log and a toast.
// A failed broadcast is only recorded, its error notification is displayBroadcastError's.
// The toast is grouped per dapp and outcome, so a flow signing many transactions counts up a
// badge on one toast instead of stacking a notification per transaction.
import { Notify } from 'quasar'
import { useStore } from 'src/stores/store'
import type { DappActivityEntry } from 'src/utils/dapp/dappActivity'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function notifyDappActivity(entry: Omit<DappActivityEntry, 'time'>) {
  const store = useStore();
  store.recordDappActivity(entry);
  if (entry.outcome === 'broadcastFailed') return;
  Notify.create({
    type: 'positive',
    message: t(`dappActivity.toast.${entry.outcome}`, { dappName: entry.dappName }),
    group: `dappActivity-${entry.dappName}-${entry.outcome}`,
    timeout: 5000,
  });
}
