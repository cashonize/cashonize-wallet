<script setup lang="ts">
  import { ref } from "vue"
  import Toggle from '@vueform/toggle'
  import { Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { defaultWalletName } from 'src/stores/constants'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import seedPhraseInput from './general/seedPhraseInput.vue'
  import { createNewWallet as createWallet, importWallet as importWalletUtil } from 'src/utils/walletUtils'
  import type { DerivationPathType } from 'src/utils/walletUtils'
  import type { Currency } from 'src/interfaces/interfaces'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()

  // Step: 1 = choose create/import, 2 = enter details & create, 3 = preferences
  const step = ref(1);
  const mode = ref<"create" | "import">("create");

  // Wallet creation
  const walletName = ref(defaultWalletName);
  const seedPhrase = ref('');
  const seedPhraseValid = ref(false);
  const selectedDerivationPath = ref<DerivationPathType>("standard");

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
    const result = await createWallet(walletName.value);
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
    const result = await importWalletUtil({
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
    <div v-if="step === 1" data-testid="step-1">
      <div style="margin-bottom: 25px;">
        <h3 style="margin-bottom: 10px;">Welcome to Cashonize</h3>
        <p style="color: grey; margin-bottom: 20px;">
          An easy-to-use Bitcoin Cash wallet with a focus on CashTokens and BCH dApps.
        </p>
        <div class="features-list">
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Send &amp; receive BCH and CashTokens</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Connect to dApps via WalletConnect</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">✓</span>
            <span>Open-source and non-custodial</span>
          </div>
        </div>
      </div>
      <hr style="margin: 25px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon plusIcon" :src="settingsStore.darkMode ? 'images/plus-square-lightGrey.svg' : 'images/plus-square.svg'"> Create new wallet</h4>
        <p style="color: grey; font-size: 14px; margin: 5px 0 10px 0;">Get started with a fresh wallet in seconds</p>
        <input @click="selectCreate()" class="button primary" type="button" value="Create new wallet" data-testid="create-wallet-cta">
      </div>
      <hr style="margin: 25px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon importIcon" :src="settingsStore.darkMode ? 'images/import-lightGrey.svg' : 'images/import.svg'"> Import existing wallet</h4>
        <p style="color: grey; font-size: 14px; margin: 5px 0 10px 0;">Restore using your seed phrase</p>
        <input @click="selectImport()" class="button primary" type="button" value="Import wallet" data-testid="import-wallet-cta">
      </div>
    </div>

    <!-- Step 2: Enter details and create/import -->
    <div v-else-if="step === 2" data-testid="step-2">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="goBack()" data-testid="back-button">
        ← Back
      </div>

      <!-- Create mode -->
      <div v-if="mode === 'create'">
        <legend>Create new wallet</legend>
        <div style="margin: 20px 0;">
          <label for="walletName" style="display: block; margin-bottom: 8px;">Wallet name:</label>
          <input
            v-model="walletName"
            id="walletName"
            type="text"
            placeholder="Enter wallet name"
            style="padding: 8px; min-width: 200px;"
          >
        </div>
        <div style="font-size: smaller; color: grey; margin: 10px 0;">
          A new seed phrase will be generated. Back it up to secure your wallet.
        </div>
        <input @click="createNewWallet()" class="button primary" type="button" value="Create wallet" data-testid="create-wallet-submit" style="margin-bottom: 15px;">
      </div>

      <!-- Import mode -->
      <div v-else>
        <legend>Import existing wallet</legend>
        <div style="margin: 20px 0;">
          <label for="walletNameImport" style="display: block; margin-bottom: 8px;">Wallet name:</label>
          <input
            v-model="walletName"
            id="walletNameImport"
            type="text"
            placeholder="Enter wallet name"
            style="padding: 8px; min-width: 200px;"
          >
        </div>
        <div style="margin: 20px 0;">
          <seedPhraseInput v-model="seedPhrase" v-model:isValid="seedPhraseValid" />
        </div>
        <div style="margin-bottom: 20px;">
          <span>Derivation path: </span>
          <select v-model="selectedDerivationPath">
            <option value="standard">m/44'/145'/0' (standard)</option>
            <option value="bitcoindotcom">m/44'/0'/0' (bitcoin.com wallet)</option>
          </select>
          <div style="margin-top: 5px; font-size: smaller; color: grey;">
            Note: Only the first address from your seed phrase will be used.
            If you've used this seed with other wallets, funds on other addresses won't appear.
          </div>
        </div>
        <input @click="importWallet()" class="button primary" type="button" value="Import wallet" data-testid="import-wallet-submit" style="margin-bottom: 15px;">
      </div>
    </div>

    <!-- Step 3: Preferences -->
    <div v-else-if="step === 3" data-testid="step-3">
      <legend>Set up your preferences</legend>
      <p style="margin-top: 15px; margin-bottom: 20px;">Almost done! Configure your preferences below.</p>

      <div style="margin-bottom: 20px;">
        <label for="selectCurrency" style="display: block; margin-bottom: 8px;">Preferred currency:</label>
        <select v-model="selectedCurrency" id="selectCurrency" style="padding: 8px; min-width: 150px;">
          <option value="usd">USD - US Dollar (default)</option>
          <option value="eur">EUR - Euro</option>
          <option value="gbp">GBP - British Pound</option>
          <option value="cad">CAD - Canadian Dollar</option>
          <option value="aud">AUD - Australian Dollar</option>
        </select>
      </div>

      <div style="margin-bottom: 20px;">
        Dark mode <Toggle v-model="selectedDarkMode" @change="applyDarkMode" />
      </div>

      <div style="margin-bottom: 25px;">
        Confirm payments before sending <Toggle v-model="confirmBeforeSending" />
        <div style="font-size: smaller; color: grey;">
          Ask for confirmation after clicking send (recommended)
        </div>
      </div>

      <input
        @click="savePreferencesAndFinish()"
        class="button primary"
        type="button"
        value="Finish Setup"
        style="padding: 12px 24px; margin-bottom: 15px;"
      >
    </div>
  </fieldset>
</template>

<style scoped>
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
