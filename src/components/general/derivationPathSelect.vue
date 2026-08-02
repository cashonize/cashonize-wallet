<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { DERIVATION_PATHS, scanDerivationPaths } from 'src/utils/walletUtils'
  import type { DerivationPathType, DerivationPathDetectionResult } from 'src/utils/walletUtils'
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:modelValue': [value: DerivationPathType]
  }>()

  const props = defineProps<{
    modelValue: DerivationPathType
    seedPhrase: string
    seedPhraseValid: boolean
    walletType: 'single' | 'hd'
  }>()

  const selectedPath = computed({
    get: () => props.modelValue,
    set: (value: DerivationPathType) => emit('update:modelValue', value)
  })

  const detectionStatus = ref<'idle' | 'scanning' | DerivationPathDetectionResult>('idle')
  const multipleAddressesUsed = ref(false)

  const SCAN_TIMEOUT_MS = 15_000

  // Incremented on every seed phrase change so a scan can tell its result is outdated
  let scanId = 0

  // A scan result no longer applies once the seed phrase changes
  watch(() => [props.seedPhrase, props.seedPhraseValid], () => {
    scanId++
    detectionStatus.value = 'idle'
    multipleAddressesUsed.value = false
  })

  async function scanForWalletActivity() {
    if (!props.seedPhraseValid || detectionStatus.value === 'scanning') return
    const currentScanId = ++scanId
    detectionStatus.value = 'scanning'
    try {
      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('derivation path scan timed out')), SCAN_TIMEOUT_MS)
      )
      const result = await Promise.race([scanDerivationPaths(props.seedPhrase), timeout])
      if (currentScanId !== scanId) return
      detectionStatus.value = result.path
      multipleAddressesUsed.value = result.multipleAddressesUsed
      if (result.path === 'standard' || result.path === 'bitcoindotcom') {
        selectedPath.value = result.path
      }
    } catch {
      // Scanning is best-effort: on electrum errors fall back to manual selection
      if (currentScanId !== scanId) return
      detectionStatus.value = 'idle'
    }
  }
</script>

<template>
  <div>
    <label>{{ t('derivationPathSelect.label') }} </label>
    <select v-model="selectedPath">
      <option value="standard">{{ DERIVATION_PATHS.standard.parent }} ({{ t('derivationPathSelect.standard') }})</option>
      <option value="bitcoindotcom">{{ DERIVATION_PATHS.bitcoindotcom.parent }} ({{ t('derivationPathSelect.bitcoindotcom') }})</option>
    </select>
    <div v-if="seedPhraseValid && detectionStatus === 'idle'" style="margin-top: 5px; font-size: smaller; color: grey;">
      <i18n-t keypath="derivationPathSelect.scanPrompt" tag="span">
        <template #link>
          <span class="scan-link" @click="scanForWalletActivity()">🔍 {{ t('derivationPathSelect.scanLinkText') }}</span>
        </template>
      </i18n-t>
    </div>
    <div v-else-if="detectionStatus !== 'idle'" style="margin-top: 5px; font-size: smaller; color: grey;">
      <span v-if="detectionStatus === 'scanning'">{{ t('derivationPathSelect.scanning') }}</span>
      <span v-else-if="detectionStatus === 'standard' || detectionStatus === 'bitcoindotcom'">
        {{ t('derivationPathSelect.detected', { path: DERIVATION_PATHS[detectionStatus].parent }) }}
      </span>
      <span v-else-if="detectionStatus === 'both'">{{ t('derivationPathSelect.detectedBoth') }}</span>
      <span v-else>{{ t('derivationPathSelect.noneFound') }}</span>
    </div>
    <div v-if="multipleAddressesUsed && walletType === 'single'" style="margin-top: 5px; font-size: smaller; color: orange;">
      {{ t('derivationPathSelect.multiAddressWarning') }}
    </div>
  </div>
</template>

<style scoped>
.scan-link {
  color: var(--color-primary);
  cursor: pointer;
}
.scan-link:hover {
  text-decoration: underline;
}
</style>
