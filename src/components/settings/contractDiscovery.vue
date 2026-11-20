<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { builtinBundle } from 'src/utils/contracts/builtins'
  import { MAX_DISCOVERY_BUNDLES, readBundle, type BundleProblem } from 'src/utils/contracts/discoveryBundles'
  import type { ContractBundle } from 'src/utils/contracts/contractManifest'
  import InfoPopup from 'src/components/general/InfoPopup.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const bundleInput = ref("")
  const problem = ref<BundleProblem | undefined>(undefined)

  const problemMessage = computed(() => {
    const found = problem.value
    if (!found) return undefined
    if (found.kind === 'invalid') return t('contractDiscovery.errors.invalid', { detail: found.detail })
    if (found.kind === 'nameTaken' || found.kind === 'idTaken') return t(`contractDiscovery.errors.${found.kind}`, { name: found.name })
    if (found.kind === 'tooMany') return t('contractDiscovery.errors.tooMany', { max: MAX_DISCOVERY_BUNDLES })
    return t(`contractDiscovery.errors.${found.kind}`)
  })

  function contractNames(bundle: ContractBundle) {
    return bundle.contracts.map(contract => contract.name).join(', ')
  }

  // The portfolio looks the positions up again on its next visit; the transaction index rescans
  // on its own when the bundles it reads announcements for have changed
  function addBundle() {
    const read = readBundle(bundleInput.value.trim(), settingsStore.discoveryBundles)
    if ('problem' in read) {
      problem.value = read.problem
      return
    }
    problem.value = undefined
    settingsStore.addDiscoveryBundle(read.bundle)
    bundleInput.value = ""
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('contractDiscovery.title') }}</legend>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(14)">
      ← {{ t('contractDiscovery.backToTools') }}
    </div>

    <div>
      {{ t('contractDiscovery.description') }}
      <InfoPopup>
        <div style="max-width: 320px;">{{ t('contractDiscovery.safetyInfo') }}</div>
      </InfoPopup>
    </div>

    <div class="bundle-heading">{{ t('contractDiscovery.builtIn') }}</div>
    <div class="bundle">
      <div>{{ builtinBundle.name }}</div>
      <div class="bundle-contracts">{{ contractNames(builtinBundle) }}</div>
    </div>

    <div class="bundle-heading">{{ t('contractDiscovery.added') }}</div>
    <div v-if="!settingsStore.discoveryBundles.length" class="bundle-contracts">{{ t('contractDiscovery.none') }}</div>
    <div v-for="bundle in settingsStore.discoveryBundles" :key="bundle.name" class="bundle">
      <div class="bundle-title">
        <span>{{ bundle.name }} <span class="bundle-contracts">({{ bundle.network ?? 'mainnet' }})</span></span>
        <span class="bundle-remove" @click="settingsStore.removeDiscoveryBundle(bundle.name)">{{ t('contractDiscovery.remove') }}</span>
      </div>
      <div v-if="bundle.description" class="bundle-contracts">{{ bundle.description }}</div>
      <div class="bundle-contracts">{{ contractNames(bundle) }}</div>
    </div>

    <textarea
      v-model="bundleInput"
      rows="6"
      :placeholder="t('contractDiscovery.pastePlaceholder')"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      style="width: 100%; margin-top: 15px;"
    ></textarea>
    <div v-if="problemMessage" style="margin-top: 8px; color: red; word-break: break-word;">{{ problemMessage }}</div>
    <input
      type="button"
      class="primaryButton"
      style="margin-top: 10px;"
      :value="t('contractDiscovery.add')"
      :disabled="!bundleInput.trim()"
      @click="addBundle()"
    >
  </fieldset>
</template>

<style scoped>
.bundle-heading {
  margin-top: 18px;
  margin-bottom: 6px;
  font-weight: 600;
}
.bundle {
  margin-bottom: 10px;
}
.bundle-title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.bundle-contracts {
  font-size: smaller;
  color: grey;
}
.bundle-remove {
  cursor: pointer;
  color: var(--color-error);
  white-space: nowrap;
}
</style>
