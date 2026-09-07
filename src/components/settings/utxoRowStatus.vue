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
  const frozen = computed(() => reason.value === 'manual')

  const heldText = computed(() => {
    if (reason.value === 'auth') return t('utxoManagement.markers.reservedAuth')
    return t('utxoManagement.markers.reserved')
  })
  const releaseText = computed(() => {
    if (reason.value === 'auth') return t('utxoManagement.markers.reservedAuthRelease')
    return t('utxoManagement.markers.reservedRelease')
  })
  const stateLabel = computed(() => {
    if (frozen.value) return t('utxoManagement.markers.frozenShort')
    return t('utxoManagement.markers.availableShort')
  })
</script>

<template>
  <component :is="compact ? 'span' : 'div'" :class="compact ? 'held-state-compact' : 'cell held-cell'">
    <span v-if="!compact" class="cell-label">{{ t('utxoManagement.tableHeaders.status') }}</span>
    <InfoPopup v-if="heldByFeature">
      <template #trigger>
        <span class="held-state">
          <q-icon name="lock" size="15px" class="held-marker" />
          <span class="held-label">{{ t('utxoManagement.markers.reservedShort') }}</span>
        </span>
      </template>
      <div style="max-width: 300px;">{{ heldText }}</div>
      <div class="info-popup-note" style="max-width: 300px;">{{ releaseText }}</div>
    </InfoPopup>
    <template v-else-if="!compact || frozen">
      <span class="held-state">
        <q-icon v-if="frozen" name="ac_unit" size="15px" class="held-marker frozen" :title="t('utxoManagement.markers.frozen')" />
        <span class="held-label">{{ stateLabel }}</span>
      </span>
      <span v-if="!compact" class="held-action actions-trigger">
        <span class="cell-label">{{ t('utxoManagement.tableHeaders.action') }}</span>
        <q-icon name="more_vert" size="18px" />
      </span>
    </template>
  </component>
</template>
