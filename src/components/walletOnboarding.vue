<script setup lang="ts">
  import { ref } from "vue"
  import Toggle from '@vueform/toggle'
  import { Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { defaultWalletName } from 'src/stores/constants'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import seedPhraseInput from './general/seedPhraseInput.vue'
  import LanguageSelector from './general/LanguageSelector.vue'
  import { createNewWallet as createWallet, importWallet as importWalletUtil, createNewHDWallet, importHDWallet, DERIVATION_PATHS } from 'src/utils/walletUtils'
  import type { DerivationPathType } from 'src/utils/walletUtils'
  import type { Currency } from 'src/interfaces/interfaces'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const { t } = useI18n()

  // Step: 1 = choose create/import, 2 = enter details & create, 3 = preferences
  const step = ref(1);
  const mode = ref<"create" | "import">("create");

  // Wallet creation
  const walletName = ref(defaultWalletName);
  const seedPhrase = ref('');
  const seedPhraseValid = ref(false);
  const selectedDerivationPath = ref<DerivationPathType>("standard");
  const walletType = ref<'single' | 'hd'>('single');

  // Preferences - initialize from settingsStore (which reads from localStorage/system preferences)
  const selectedCurrency = ref<Currency>(settingsStore.currency);
  const selectedDarkMode = ref(settingsStore.darkMode);
  const confirmBeforeSending = ref(true); // default in settingsStore is false, but we want true for new users

  function selectCreate() {
    mode.value = "create";
    step.value = 2;
  }

  function selectImport() {
    mode.value = "import";
    step.value = 2;
  }

  function goBack() {
    step.value = 1;
  }

  async function createNewWallet() {
    const createFn = walletType.value === 'hd' ? createNewHDWallet : createWallet;
    const result = await createFn(walletName.value);
    if (result.success) {
      step.value = 3;
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
      step.value = 3;
    } else {
      $q.notify({
        message: result.message,
        icon: 'warning',
        color: result.isUserError ? "grey-7" : "red"
      });
    }
  }

  function applyDarkMode() {
    document.body.classList.toggle("dark", selectedDarkMode.value);
  }

  function savePreferencesAndFinish() {
    // Save currency
    Config.DefaultCurrency = selectedCurrency.value;
    settingsStore.currency = selectedCurrency.value;
    localStorage.setItem("currency", selectedCurrency.value);

    // Save dark mode
    settingsStore.darkMode = selectedDarkMode.value;
    localStorage.setItem("darkMode", selectedDarkMode.value ? "true" : "false");
    applyDarkMode();

    // Save confirm before sending
    settingsStore.confirmBeforeSending = confirmBeforeSending.value;
    localStorage.setItem("confirmBeforeSending", confirmBeforeSending.value ? "true" : "false");

    // Wallet is already initialized in step 2, just navigate to wallet view
    store.changeView(1);
  }
</script>

<template>
  <fieldset class="item">
    <!-- Step 1: Welcome & Choose Create or Import -->
    <div v-if="step === 1">
      <div style="margin-bottom: 25px;">
        <div class="welcome-header">
          <h3 style="margin-bottom: 0;">{{ t('onboarding.welcome.title') }}</h3>
          <LanguageSelector class="language-selector" style="width: 124px;" />
        </div>
        <p style="color: grey; margin-bottom: 20px;">
          {{ t('onboarding.welcome.description') }}
        </p>
        <div class="features-list">
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>{{ t('onboarding.welcome.featureSendReceive') }}</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>{{ t('onboarding.welcome.featureWalletConnect') }}</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>{{ t('onboarding.welcome.featureOpenSource') }}</span>
          </div>
        </div>
      </div>
      <hr style="margin: 25px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon plusIcon" :src="settingsStore.darkMode ? 'images/plus-square-lightGrey.svg' : 'images/plus-square.svg'"> {{ t('onboarding.create.title') }}</h4>
        <p style="color: grey; font-size: 14px; margin: 5px 0 10px 0;">{{ t('onboarding.create.description') }}</p>
        <input @click="selectCreate()" class="button primary" type="button" :value="t('onboarding.create.button')">
      </div>
      <hr style="margin: 25px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon importIcon" :src="settingsStore.darkMode ? 'images/import-lightGrey.svg' : 'images/import.svg'"> {{ t('onboarding.import.title') }}</h4>
        <p style="color: grey; font-size: 14px; margin: 5px 0 10px 0;">{{ t('onboarding.import.description') }}</p>
        <input @click="selectImport()" class="button primary" type="button" :value="t('onboarding.import.button')">
      </div>
    </div>

    <!-- Step 2: Enter details and create/import -->
    <div v-else-if="step === 2">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="goBack()">
        ← {{ t('common.actions.back') }}
      </div>

      <!-- Create mode -->
      <div v-if="mode === 'create'">
        <legend>{{ t('onboarding.create.title') }}</legend>
        <div style="margin: 20px 0;">
          <label for="walletName" style="display: block; margin-bottom: 8px;">{{ t('onboarding.walletName.label') }}</label>
          <input
            v-model="walletName"
            id="walletName"
            type="text"
            :placeholder="t('onboarding.walletName.placeholder')"
            style="padding: 8px; min-width: 200px;"
          >
        </div>
        <div style="margin: 15px 0;">
          <label style="display: block; margin-bottom: 8px;">{{ t('onboarding.walletType.label') }}</label>
          <select v-model="walletType" style="padding: 8px; min-width: 200px;">
            <option value="single">{{ t('onboarding.walletType.single') }}</option>
            <option value="hd">{{ t('onboarding.walletType.hd') }}</option>
          </select>
          <div style="margin-top: 5px; font-size: smaller; color: grey;">
            {{ walletType === 'hd' ? t('onboarding.walletType.hdDescription') : t('onboarding.walletType.singleDescription') }}
          </div>
        </div>
        <div style="font-size: smaller; color: grey; margin: 10px 0;">
          {{ t('onboarding.create.seedPhraseNote') }}
        </div>
        <input @click="createNewWallet()" class="button primary" type="button" :value="t('onboarding.create.submitButton')" style="margin-bottom: 15px;">
      </div>

      <!-- Import mode -->
      <div v-else>
        <legend>{{ t('onboarding.import.title') }}</legend>
        <div style="margin: 20px 0;">
          <label for="walletNameImport" style="display: block; margin-bottom: 8px;">{{ t('onboarding.walletName.label') }}</label>
          <input
            v-model="walletName"
            id="walletNameImport"
            type="text"
            :placeholder="t('onboarding.walletName.placeholder')"
            style="padding: 8px; min-width: 200px;"
          >
        </div>
        <div style="margin: 20px 0;">
          <seedPhraseInput v-model="seedPhrase" v-model:isValid="seedPhraseValid" />
        </div>
        <div style="margin: 15px 0;">
          <label style="display: block; margin-bottom: 8px;">{{ t('onboarding.walletType.label') }}</label>
          <select v-model="walletType" style="padding: 8px; min-width: 200px;">
            <option value="single">{{ t('onboarding.walletType.single') }}</option>
            <option value="hd">{{ t('onboarding.walletType.hd') }}</option>
          </select>
          <div style="margin-top: 5px; font-size: smaller; color: grey;">
            {{ walletType === 'hd' ? t('onboarding.walletType.hdDescription') : t('onboarding.walletType.singleDescription') }}
          </div>
        </div>
        <div style="margin-bottom: 20px;">
          <span>{{ t('onboarding.derivationPath.label') }} </span>
          <select v-model="selectedDerivationPath">
            <option value="standard">{{ DERIVATION_PATHS.standard.parent }} ({{ t('onboarding.derivationPath.standard') }})</option>
            <option value="bitcoindotcom">{{ DERIVATION_PATHS.bitcoindotcom.parent }} ({{ t('onboarding.derivationPath.bitcoindotcom') }})</option>
          </select>
          <div style="margin-top: 5px; font-size: smaller; color: grey;">
            {{ t('onboarding.derivationPath.note') }}
          </div>
        </div>
        <input @click="importWallet()" class="button primary" type="button" :value="t('onboarding.import.submitButton')" style="margin-bottom: 15px;">
      </div>
    </div>

    <!-- Step 3: Preferences -->
    <div v-else-if="step === 3">
      <legend>{{ t('onboarding.preferences.title') }}</legend>
      <p style="margin-top: 15px; margin-bottom: 20px;">{{ t('onboarding.preferences.description') }}</p>

      <div style="margin-bottom: 20px;">
        <label for="selectCurrency" style="display: block; margin-bottom: 8px;">{{ t('onboarding.preferences.currency.label') }}</label>
        <select v-model="selectedCurrency" id="selectCurrency" style="padding: 8px; min-width: 150px;">
          <option value="usd">{{ t('onboarding.preferences.currency.usd') }}</option>
          <option value="eur">{{ t('onboarding.preferences.currency.eur') }}</option>
          <option value="gbp">{{ t('onboarding.preferences.currency.gbp') }}</option>
          <option value="cad">{{ t('onboarding.preferences.currency.cad') }}</option>
          <option value="aud">{{ t('onboarding.preferences.currency.aud') }}</option>
        </select>
      </div>

      <div style="margin-bottom: 20px;">
        {{ t('onboarding.preferences.darkMode') }} <Toggle v-model="selectedDarkMode" @change="applyDarkMode" />
      </div>

      <div style="margin-bottom: 25px;">
        {{ t('onboarding.preferences.confirmPayments') }} <Toggle v-model="confirmBeforeSending" />
        <div style="font-size: smaller; color: grey;">
          {{ t('onboarding.preferences.confirmPaymentsHint') }}
        </div>
      </div>

      <input
        @click="savePreferencesAndFinish()"
        class="button primary"
        type="button"
        :value="t('onboarding.preferences.finishButton')"
        style="padding: 12px 24px; margin-bottom: 15px;"
      >
    </div>
  </fieldset>
</template>

<style scoped>
.welcome-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.language-selector {
  padding: 4px 8px;
}
@media (max-width: 500px) {
  .welcome-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
.features-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.feature-icon {
  color: var(--color-primary);
  font-weight: bold;
}
</style>
