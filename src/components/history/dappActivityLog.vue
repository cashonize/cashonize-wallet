<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { copyToClipboard, formatReadableDate } from 'src/utils/utils'
  import { confirmDialog } from 'src/utils/txHelpers'
  import type { DappActivityEntry } from 'src/utils/dapp/dappActivity'

  const store = useStore()
  const { t } = useI18n()

  const pageSize = 10;
  const shownCount = ref(pageSize);
  const shownEntries = computed(() => store.dappActivity.slice(0, shownCount.value));

  const historyTxids = computed(() => new Set(store.walletHistory?.map(tx => tx.hash)));

  // A signed-only transaction is the dapp's to broadcast; the wallet history is what shows it did.
  // The history can be partial, so an old entry missing from it is not proof it never arrived.
  function notSeenOnChain(entry: DappActivityEntry) {
    return entry.outcome === 'signed' && entry.txid !== undefined && !historyTxids.value.has(entry.txid);
  }

  // Sent by this wallet, or signed and since seen in the history
  function isOnChain(entry: DappActivityEntry) {
    if (entry.outcome === 'sent') return true;
    return entry.outcome === 'signed' && entry.txid !== undefined && historyTxids.value.has(entry.txid);
  }

  function shortTxid(txid: string) {
    return txid.slice(0, 10) + '...' + txid.slice(-10);
  }

  async function clearLog() {
    const confirmed = await confirmDialog(
      t('dappActivity.clearTitle'), t('dappActivity.clearMessage'), t('dappActivity.clear'), 'red'
    );
    if (confirmed) store.clearActiveDappActivity();
  }
</script>

<template>
  <fieldset class="item">
    <legend>{{ t('dappActivity.title') }}</legend>
    <div v-if="!store.dappActivity.length" class="q-pa-md">{{ t('dappActivity.empty') }}</div>
    <div v-for="entry in shownEntries" :key="`${entry.time}-${entry.txid ?? entry.outcome}`" class="activity-entry">
      <div class="activity-top-row">
        <span class="activity-dapp">{{ entry.dappName }}</span>
        <span class="activity-time">{{ formatReadableDate(Math.floor(entry.time / 1000)) }}</span>
      </div>
      <div v-if="entry.userPrompt" class="activity-prompt">{{ entry.userPrompt }}</div>
      <div class="activity-outcome" :class="{ failed: entry.outcome === 'broadcastFailed' }">
        {{ t(`dappActivity.outcome.${entry.outcome}`) }}
        <span v-if="notSeenOnChain(entry)" class="activity-not-seen">· {{ t('dappActivity.notSeenOnChain') }}</span>
      </div>
      <div v-if="entry.txid" class="activity-txid">
        <span @click="copyToClipboard(entry.txid)" style="cursor: pointer;">
          {{ shortTxid(entry.txid) }}
          <img class="copyIcon icon" src="images/copyGrey.svg">
        </span>
        <a v-if="isOnChain(entry)" :href="store.explorerUrl + `/${entry.txid}`" target="_blank" rel="noopener">
          {{ t('dappActivity.explorer') }}
        </a>
      </div>
    </div>
    <div class="activity-actions" v-if="store.dappActivity.length">
      <span v-if="store.dappActivity.length > shownCount" class="activity-action" @click="shownCount += pageSize">
        {{ t('dappActivity.showMore') }}
      </span>
      <span class="activity-action" @click="clearLog">{{ t('dappActivity.clear') }}</span>
    </div>
  </fieldset>
</template>

<style scoped>
.activity-entry {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-lightGrey);
}
.activity-entry:last-of-type {
  border-bottom: none;
}
.activity-top-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.activity-dapp {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.activity-time,
.activity-prompt,
.activity-not-seen,
.activity-txid {
  color: var(--color-grey);
  font-size: smaller;
}
.activity-time {
  white-space: nowrap;
}
.activity-prompt {
  overflow-wrap: anywhere;
}
.activity-outcome.failed {
  color: var(--color-error);
}
.activity-txid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
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
