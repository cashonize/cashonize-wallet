<script setup lang="ts">
  import { ref, computed } from "vue"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { namedWalletExistsInDb } from 'src/utils/dbUtils'
  import { createNewWallet as createWallet, importWallet as importWalletUtil, createNewHDWallet, importHDWallet, DERIVATION_PATHS } from 'src/utils/walletUtils'
  import type { DerivationPathType } from 'src/utils/walletUtils'
  import seedPhraseInput from '../general/seedPhraseInput.vue'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const $q = useQuasar()
  const { t } = useI18n()

  // Step: 1 = name, 2 = choose type (create exits here), 3 = import details (import only)
  const step = ref<1 | 2 | 3>(1);
  const walletName = ref('');
  const seedPhrase = ref('');
  const seedPhraseValid = ref(false);
  const selectedDerivationPath = ref<DerivationPathType>("standard");
  const walletType = ref<'single' | 'hd'>('single');

  const effectiveWalletName = computed(() => walletName.value.trim());

  async function proceedToStep2() {
    const name = walletName.value.trim();
    if (!name) {
      $q.notify({
        message: t('addWallet.walletName.emptyError'),
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    // Check if wallet already exists
    const existsMainnet = await namedWalletExistsInDb(name, "bitcoincash");
    const existsChipnet = await namedWalletExistsInDb(name, "bchtest");
    if (existsMainnet || existsChipnet) {
      $q.notify({
        message: t('addWallet.walletName.existsError', { name }),
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    step.value = 2;
  }

  async function createNewWallet() {
    const createFn = walletType.value === 'hd' ? createNewHDWallet : createWallet;
    const result = await createFn(walletName.value);
    if (result.success) {
      store.changeView(1);
    } else {
      $q.notify({
        message: result.message,
        icon: 'warning',
        color: result.isUserError ? "grey-7" : "red"
      });
    }
  }

  async function importWallet() {
    const importFn = walletType.value === 'hd' ? importHDWallet : importWalletUtil;
    const result = await importFn({
      name: walletName.value,
      seedPhrase: seedPhrase.value,
      seedPhraseValid: seedPhraseValid.value,
      derivationPath: selectedDerivationPath.value
    });
    if (result.success) {
      // Clear seed phrase from memory (defense in depth)
      seedPhrase.value = '';
      store.changeView(1);
    } else {
      $q.notify({
        message: result.message,
        icon: 'warning',
        color: result.isUserError ? "grey-7" : "red"
      });
    }
  }
</script>

<template>
  <fieldset class="item">
    <legend>{{ t('addWallet.title') }}</legend>

    <!-- Step 1: Enter wallet name -->
    <div v-if="step === 1">
      <div style="margin-bottom: 20px;">
        <label for="walletName" style="display: block; margin-bottom: 8px;">{{ t('addWallet.walletName.label') }}</label>
        <input
          v-model="walletName"
          type="text"
          id="walletName"
          :placeholder="t('addWallet.walletName.placeholder')"
          style="width: 100%; max-width: 300px; padding: 8px;"
        >
      </div>
      <input
        @click="proceedToStep2()"
        class="button primary"
        type="button"
        :value="t('addWallet.continueButton')"
        style="margin-bottom: 15px;"
      >
    </div>

    <!-- Step 2: Choose wallet type -->
    <div v-else-if="step === 2">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="step = 1">
        {{ t('addWallet.backButton') }}
      </div>
      <div style="margin-bottom: 20px;">
        {{ t('addWallet.creating') }} <span class="wallet-name-styled">{{ effectiveWalletName }}</span>
      </div>
      <div style="margin-bottom: 5px;">
        <label style="display: block; margin-bottom: 8px;">{{ t('onboarding.walletType.label') }}</label>
        <select v-model="walletType" style="padding: 8px; min-width: 200px;">
          <option value="single">{{ t('onboarding.walletType.single') }}</option>
          <option value="hd">{{ t('onboarding.walletType.hd') }}</option>
        </select>
        <div style="margin-top: 5px;">
          {{ walletType === 'hd' ? t('onboarding.walletType.hdDescription') : t('onboarding.walletType.singleDescription') }}
        </div>
      </div>
      <div style="margin-top:10px; margin-bottom: 15px;">
        <div style="font-size: smaller; color: grey; margin-bottom: 10px;">
          {{ t('addWallet.createNew.hint') }}
        </div>
        <input
          @click="createNewWallet()"
          class="button primary"
          type="button"
          :value="t('addWallet.createNew.button')"
          style="margin-bottom: 15px;"
        >
        <div style="font-size: smaller; color: grey; margin-bottom: 10px;">
          {{ t('addWallet.importExisting.hint') }}
        </div>
        <input
          @click="step = 3"
          class="button"
          type="button"
          :value="t('addWallet.importExisting.button')"
        >
      </div>
    </div>

    <!-- Step 3: Import wallet details (only reached when importing) -->
    <div v-else-if="step === 3">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="step = 2">
        {{ t('addWallet.backButton') }}
      </div>
      <div style="margin-bottom: 10px;">
        {{ t('addWallet.importing') }} <span class="wallet-name-styled">{{ effectiveWalletName }}</span>
        <span v-if="walletType === 'single'"> as single address wallet</span>
      </div>
      <div v-if="walletType === 'single'" style="margin-bottom: 10px; font-size: smaller; color: grey;">
        {{ t('addWallet.singleAddressNote') }}
      </div>
      <div style="margin-bottom: 15px;">
        <seedPhraseInput v-model="seedPhrase" v-model:isValid="seedPhraseValid" />
        <div style="margin-top: 15px;">
          <label>{{ t('addWallet.derivationPath.label') }} </label>
          <select v-model="selectedDerivationPath">
            <option value="standard">{{ DERIVATION_PATHS.standard.parent }} ({{ t('addWallet.derivationPath.standard') }})</option>
            <option value="bitcoindotcom">{{ DERIVATION_PATHS.bitcoindotcom.parent }} ({{ t('addWallet.derivationPath.bitcoindotcom') }})</option>
          </select>
        </div>
        <input
          @click="importWallet()"
          class="button primary"
          type="button"
          style="margin-top: 15px; margin-bottom: 15px;"
          :value="t('addWallet.importButton')"
        >
      </div>
    </div>
  </fieldset>
</template>

