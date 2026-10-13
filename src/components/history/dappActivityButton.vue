<script setup lang="ts">
  // An icon opening the log of what this wallet signed for dapps (see utils/dapp/dappActivity.ts).
  // On the dapp sessions and, when the user opts in, in the top nav.
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { copyToClipboard, formatReadableDate } from 'src/utils/utils'
  import { confirmDialog } from 'src/utils/txHelpers'
  import type { DappActivityEntry } from 'src/utils/dapp/dappActivity'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const showDialog = ref(false);
  const pageSize = 20;
  const shownCount = ref(pageSize);
  const shownEntries = computed(() => store.dappActivity.slice(0, shownCount.value));

  const historyTxids = computed(() => new Set(store.walletHistory?.map(tx => tx.hash)));

  // A signed-only transaction is the dapp's to broadcast; the wallet history is what shows it did.
  // The history can be partial, so an old entry missing from it is not proof it never arrived.
  function isOnChain(entry: DappActivityEntry) {
    if (entry.outcome === 'sent') return true;
    return entry.outcome === 'signed' && entry.txid !== undefined && historyTxids.value.has(entry.txid);
  }

  function shortTxid(txid: string) {
    return txid.slice(0, 8) + '…' + txid.slice(-8);
  }

  function openLog() {
    shownCount.value = pageSize;
    showDialog.value = true;
  }

  async function clearLog() {
    const confirmed = await confirmDialog(
      t('dappActivity.clearTitle'), t('dappActivity.clearMessage'), t('dappActivity.clear'), 'red'
    );
    if (confirmed) store.clearActiveDappActivity();
  }
</script>

<template>
  <span>
    <q-btn icon="receipt_long" flat round dense size="sm" :aria-label="t('dappActivity.title')" @click="openLog">
      <q-tooltip>{{ t('dappActivity.title') }}</q-tooltip>
    </q-btn>

    <q-dialog v-model="showDialog">
      <q-card style="width: 500px" class="activityDialog">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ t('dappActivity.title') }}</div>
          <q-space />
          <q-btn icon="close" :color="settingsStore.darkMode ? 'white' : 'black'" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div v-if="!store.dappActivity.length">{{ t('dappActivity.empty') }}</div>
          <div v-for="entry in shownEntries" :key="`${entry.time}-${entry.txid ?? entry.outcome}`" class="activity-entry">
            <div class="activity-row">
              <span class="activity-title">
                {{ entry.dappName }}<template v-if="entry.userPrompt"> · <span class="activity-prompt">{{ entry.userPrompt }}</span></template>
              </span>
              <span class="activity-time">{{ formatReadableDate(Math.floor(entry.time / 1000)) }}</span>
            </div>
            <div class="activity-row activity-detail">
              <span :class="{ failed: entry.outcome === 'broadcastFailed' }">
                {{ t(`dappActivity.outcome.${entry.outcome}`) }}<template v-if="entry.outcome === 'signed' && !isOnChain(entry)">, {{ t('dappActivity.notSeenOnChain') }}</template>
              </span>
              <a v-if="entry.txid && isOnChain(entry)" :href="store.explorerUrl + `/${entry.txid}`" target="_blank" rel="noopener" class="activity-txid">
                {{ shortTxid(entry.txid) }}
              </a>
              <span v-else-if="entry.txid" class="activity-txid" style="cursor: pointer;" @click="copyToClipboard(entry.txid)">
                {{ shortTxid(entry.txid) }}
              </span>
            </div>
          </div>
          <div class="activity-actions" v-if="store.dappActivity.length">
            <span v-if="store.dappActivity.length > shownCount" class="activity-action" @click="shownCount += pageSize">
              {{ t('dappActivity.showMore') }}
            </span>
            <span class="activity-action" @click="clearLog">{{ t('dappActivity.clear') }}</span>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </span>
</template>

<style scoped>
body.dark .activityDialog {
  background-color: var(--bg-color);
}
.activity-entry {
  padding: 6px 0;
  border-bottom: 1px solid var(--color-lightGrey);
}
.activity-entry:last-of-type {
  border-bottom: none;
}
.activity-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.activity-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.activity-prompt {
  font-weight: normal;
}
.activity-time,
.activity-detail {
  color: var(--color-grey);
  font-size: smaller;
}
.activity-time,
.activity-txid {
  white-space: nowrap;
}
.failed {
  color: var(--color-error);
}
.activity-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}
.activity-action {
  cursor: pointer;
  color: var(--color-primary);
}
.activity-action:last-child {
  margin-left: auto;
}
</style>
