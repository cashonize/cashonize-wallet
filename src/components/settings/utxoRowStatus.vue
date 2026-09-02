<script setup lang="ts">
  // The status column every UTXO list shares: what is holding a coin back, or the marker and the
  // trigger for the actions on a coin nothing is. One copy so the four lists cannot drift apart.
  // The actions menu itself stays with the row, which is what opens it, and the actions belong to
  // the page, so this only says which ones it offers.
  import { computed } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import { isFeatureReservation, outpointOf } from 'src/utils/wallet/reservedUtxos'
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'

  const store = useStore()
  const { t } = useI18n()

  // The token lists put their coins on two lines and carry their own menu, so there the state
  // shows only when there is one: a coin nothing holds back says nothing at all.
  const props = defineProps<{ utxo: Utxo, compact?: boolean }>()

  const reason = computed(() => store.reservedUtxos[outpointOf(props.utxo)])
  const heldByFeature = computed(() => isFeatureReservation(reason.value))
</script>

<template>
  <span v-if="compact" class="held-state-compact">
    <InfoPopup v-if="heldByFeature">
      <template #trigger>
        <span class="held-state">
          <q-icon name="lock" size="15px" class="held-marker" />
          <span class="held-label">{{ t('utxoManagement.markers.reservedShort') }}</span>
        </span>
      </template>
      <div style="max-width: 300px;">{{
        reason === 'auth'
          ? t('utxoManagement.markers.reservedAuth')
          : t('utxoManagement.markers.reserved')
      }}</div>
      <div class="info-popup-note" style="max-width: 300px;">{{
        reason === 'auth'
          ? t('utxoManagement.markers.reservedAuthRelease')
          : t('utxoManagement.markers.reservedRelease')
      }}</div>
    </InfoPopup>
    <span v-else-if="reason === 'manual'" class="held-state">
      <q-icon name="ac_unit" size="15px" class="held-marker frozen" :title="t('utxoManagement.markers.frozen')" />
      <span class="held-label">{{ t('utxoManagement.markers.frozenShort') }}</span>
    </span>
  </span>
  <div v-else class="cell held-cell">
    <span class="cell-label">{{ t('utxoManagement.tableHeaders.status') }}</span>
    <InfoPopup v-if="heldByFeature">
      <template #trigger>
        <span class="held-state">
          <q-icon name="lock" size="15px" class="held-marker" />
          <span class="held-label">{{ t('utxoManagement.markers.reservedShort') }}</span>
        </span>
      </template>
      <div style="max-width: 300px;">{{
        reason === 'auth'
          ? t('utxoManagement.markers.reservedAuth')
          : t('utxoManagement.markers.reserved')
      }}</div>
      <div class="info-popup-note" style="max-width: 300px;">{{
        reason === 'auth'
          ? t('utxoManagement.markers.reservedAuthRelease')
          : t('utxoManagement.markers.reservedRelease')
      }}</div>
    </InfoPopup>
    <template v-else>
      <span class="held-state">
        <q-icon
          v-if="reason === 'manual'"
          name="ac_unit"
          size="15px"
          class="held-marker frozen"
          :title="t('utxoManagement.markers.frozen')"
        />
        <span class="held-label">{{
          reason === 'manual'
            ? t('utxoManagement.markers.frozenShort')
            : t('utxoManagement.markers.availableShort')
        }}</span>
      </span>
      <span class="held-action actions-trigger">
        <span class="cell-label">{{ t('utxoManagement.tableHeaders.action') }}</span>
        <q-icon name="more_vert" size="18px" />
      </span>
    </template>
  </div>
</template>
