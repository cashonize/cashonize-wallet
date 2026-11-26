<script setup lang="ts">
  // What the electrum server in use reports, read-only. Nothing here is verified: the tip is the
  // server's own claim, which the page says rather than suggest a check the wallet does not make.
  import { computed, ref, onActivated, onDeactivated } from 'vue'
  import { useI18n } from 'vue-i18n'
  import BackRow from 'src/components/general/BackRow.vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { menuSectionViewBase } from 'src/stores/constants'
  import { formatRelativeTime } from 'src/utils/utils'
  import { formatDecimal } from 'src/utils/numberFormat'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const connectionStatus = computed(() => {
    if (!store.electrumServerInUse[store.network]) return 'connecting';
    if (store.electrumConnectionLost[store.network]) return 'reconnecting';
    return 'connected';
  });
  const modeLabels = {
    automatic: 'settings.advanced.electrumModeAutomatic',
    preferred: 'settings.advanced.electrumModePreferred',
    single: 'settings.advanced.electrumModeSingle',
  } as const;

  // the block's age grows while the page is open, with no new block to recompute it
  const tick = ref(0);
  let ticking: ReturnType<typeof setInterval> | undefined;
  onActivated(() => { ticking = setInterval(() => tick.value++, 30_000) });
  onDeactivated(() => clearInterval(ticking));
  const latestBlockAge = computed(() => {
    void tick.value;
    if (store.currentBlockTimestamp === undefined) return undefined;
    return formatRelativeTime(store.currentBlockTimestamp);
  });

  // The explorer's front page, from the transaction link the setting holds: a second source to
  // hold the server's height against
  const explorerHome = computed(() => {
    const [path = '', query] = store.explorerUrl.split('?');
    const home = path.replace(/\/(tx|transaction)\/?$/, '');
    return query ? `${home}?${query}` : home;
  });
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('networkStatus.title') }}</legend>
    <BackRow @click="store.goBack()" />

    <div>
      <div class="description" style="margin-bottom: 14px;">{{ t('networkStatus.description') }}</div>

      <div class="statusHeading">{{ t('networkStatus.electrumHeading') }}</div>
      <dl class="statusRows">
        <dt>{{ t('networkStatus.status') }}</dt>
        <dd><span class="statusDot" :class="connectionStatus"></span>{{ t(`networkStatus.${connectionStatus}`) }}</dd>
        <dt>{{ t('networkStatus.server') }}</dt>
        <dd class="mono">{{ store.electrumServerInUse[store.network] ?? '…' }}</dd>
        <dt>{{ t('networkStatus.mode') }}</dt>
        <dd>{{ t(modeLabels[settingsStore.electrumMode[store.network]]) }}</dd>
        <dt>{{ t('networkStatus.blockHeight') }}</dt>
        <dd>{{ store.currentBlockHeight !== undefined ? formatDecimal(store.currentBlockHeight) : '…' }}</dd>
        <dt>{{ t('networkStatus.latestBlock') }}</dt>
        <dd>{{ latestBlockAge ?? '…' }}</dd>
      </dl>
      <div class="statusLinks">
        <a :href="explorerHome" target="_blank" rel="noopener">{{ t('networkStatus.seeOnExplorer') }} ↗</a>
        <span class="action-link" @click="store.changeView(menuSectionViewBase + 3)">{{ t('networkStatus.changeServer') }} →</span>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.statusHeading {
  margin-bottom: 6px;
  font-weight: 600;
}
/* a label beside its value, the value wrapping under itself: server urls are long */
.statusRows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 0 0 8px;
}
.statusRows dt {
  color: grey;
  font-weight: normal;
}
.statusRows dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.statusLinks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin-top: 12px;
  font-size: smaller;
}
.statusDot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
  border-radius: 50%;
  background: orange;
}
.statusDot.connected {
  background: var(--color-primary);
}
.statusDot.reconnecting {
  background: #e65100;
}
/* on a phone the value goes under its label */
@media (max-width: 450px) {
  .statusRows {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .statusRows dd {
    margin-bottom: 8px;
  }
}
</style>
