<script setup lang="ts">
  import { ref } from "vue"
  import Toggle from '@vueform/toggle'
  import { Wallet, TestNetWallet, Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import seedPhraseInput from './seedPhraseInput.vue'
  import type { Currency } from 'src/interfaces/interfaces'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const isBrowser = (process.env.MODE == "spa");

  // Step: 1 = choose create/import, 2 = enter details & create, 3 = preferences
  const step = ref(1);
  const mode = ref<"create" | "import">("create");

  // Wallet creation
  const walletName = ref("mywallet");
  const seedPhrase = ref('');
  const seedPhraseValid = ref(false);
  const selectedDerivationPath = ref("standard" as ("standard" | "bitcoindotcom"));

  // Preferences - initialize from settingsStore (which reads from localStorage/system preferences)
  const selectedCurrency = ref<Currency>(settingsStore.currency);
  const selectedDarkMode = ref(settingsStore.darkMode);
  const confirmBeforeSending = ref(settingsStore.confirmBeforeSending);

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
    const name = walletName.value.trim();
    if (!name) {
      $q.notify({
        message: "Please enter a wallet name",
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    try {
      Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      const mainnetWallet = await Wallet.named(name);
      const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
      await TestNetWallet.replaceNamed(name, walletId);

      // Set active wallet and start initialization in background
      store.activeWalletName = name;
      localStorage.setItem("activeWalletName", name);
      store.setWallet(mainnetWallet);
      void store.initializeWallet();

      // Store wallet creation date
      settingsStore.setWalletCreatedAt(name);

      step.value = 3;
    } catch {
      $q.notify({
        message: "Failed to create wallet",
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function importWallet() {
    const name = walletName.value.trim();
    if (!name) {
      $q.notify({
        message: "Please enter a wallet name",
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    if (!seedPhrase.value) {
      $q.notify({
        message: "Enter a seed phrase to import wallet",
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    if (!seedPhraseValid.value) {
      $q.notify({
        message: "Please fix invalid words in your seed phrase",
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    try {
      const derivationPath = selectedDerivationPath.value == "standard"? "m/44'/145'/0'/0/0" : "m/44'/0'/0'/0/0";
      if(selectedDerivationPath.value == "standard") Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      const walletId = `seed:mainnet:${seedPhrase.value}:${derivationPath}`;
      await Wallet.replaceNamed(name, walletId);
      const walletIdTestnet = `seed:testnet:${seedPhrase.value}:${derivationPath}`;
      await TestNetWallet.replaceNamed(name, walletIdTestnet);

      // Set active wallet and start initialization in background
      const mainnetWallet = await Wallet.named(name);
      store.activeWalletName = name;
      localStorage.setItem("activeWalletName", name);
      store.setWallet(mainnetWallet);
      void store.initializeWallet();

      // Mark as 'imported' - user already demonstrated having the seed phrase
      settingsStore.setBackupStatus(name, 'imported');

      // Store wallet creation date (import date)
      settingsStore.setWalletCreatedAt(name);

      step.value = 3;
    } catch (error) {
      const errorMessage = typeof error == 'string' ? error : "Not a valid seed phrase"
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof error == 'string' ? "grey-7" : "red"
      })
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
  <div v-if="isBrowser && step === 1" style="display:block; margin-top: -25px;">
    <a style="color: var(--font-color); padding: 5px;" href="https://about.cashonize.com">
      <span style="font-size: 24px; vertical-align: sub;">⬅</span>
      <span> About page</span>
    </a>
  </div>

  <fieldset style="margin-top: 15px;">
    <!-- Step 1: Welcome & Choose Create or Import -->
    <div v-if="step === 1">
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
        <input @click="selectCreate()" class="button primary" type="button" value="Create new wallet">
      </div>
      <hr style="margin: 25px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon importIcon" :src="settingsStore.darkMode ? 'images/import-lightGrey.svg' : 'images/import.svg'"> Import existing wallet</h4>
        <p style="color: grey; font-size: 14px; margin: 5px 0 10px 0;">Restore using your seed phrase</p>
        <input @click="selectImport()" class="button primary" type="button" value="Import wallet">
      </div>
    </div>

    <!-- Step 2: Enter details and create/import -->
    <div v-else-if="step === 2">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="goBack()">
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
        <input @click="createNewWallet()" class="button primary" type="button" value="Create wallet" style="margin-top: 10px; margin-bottom: 15px;">
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
          <div style="margin-top: 5px;">
            <i>Note:</i> Cashonize is a single-address wallet so you can't fully import HD wallets
          </div>
        </div>
        <input @click="importWallet()" class="button primary" type="button" value="Import wallet" style="margin-bottom: 15px;">
      </div>
    </div>

    <!-- Step 3: Preferences -->
    <div v-else-if="step === 3">
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
        <label style="display: flex; align-items: center; gap: 12px;">
          <span>Dark mode</span>
          <Toggle v-model="selectedDarkMode" @change="applyDarkMode" style="display: inline-block;" />
        </label>
      </div>

      <div style="margin-bottom: 25px;">
        <label style="display: flex; align-items: center; gap: 12px;">
          <span>Confirm payments before sending</span>
          <Toggle v-model="confirmBeforeSending" style="display: inline-block;" />
        </label>
        <div style="font-size: smaller; color: grey; margin-top: 4px;">
          Shows a confirmation dialog before sending transactions
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

<style src="@vueform/toggle/themes/default.css"></style>

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
