<script setup lang="ts">
  import { ref } from "vue"
  import Toggle from '@vueform/toggle'
  import { Wallet, TestNetWallet, Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import type { Currency } from 'src/interfaces/interfaces'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const isBrowser = (process.env.MODE == "spa");

  // Step: 1 = wallet creation, 2 = preferences
  const step = ref(1);

  // Wallet creation
  const seedphrase = ref('');
  const selectedDerivationPath = ref("standard" as ("standard" | "bitcoindotcom"));

  // Preferences - initialize from settingsStore (which reads from localStorage/system preferences)
  const selectedCurrency = ref<Currency>(settingsStore.currency);
  const selectedDarkMode = ref(settingsStore.darkMode);
  const confirmBeforeSending = ref(settingsStore.confirmBeforeSending);

  const nameWallet = "mywallet";

  async function createNewWallet() {
    try {
      Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      const mainnetWallet = await Wallet.named(nameWallet);
      const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
      await TestNetWallet.replaceNamed(nameWallet, walletId);
      step.value = 2;
    } catch {
      $q.notify({
        message: "Failed to create wallet",
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function importWallet() {
    try {
      const derivationPath = selectedDerivationPath.value == "standard"? "m/44'/145'/0'/0/0" : "m/44'/0'/0'/0/0";
      if(selectedDerivationPath.value == "standard") Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      if(!seedphrase.value) throw("Enter a seed phrase to import wallet")
      const walletId = `seed:mainnet:${seedphrase.value}:${derivationPath}`;
      await Wallet.replaceNamed(nameWallet, walletId);
      const walletIdTestnet = `seed:testnet:${seedphrase.value}:${derivationPath}`;
      await TestNetWallet.replaceNamed(nameWallet, walletIdTestnet);
      step.value = 2;
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

  async function savePreferencesAndFinish() {
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

    // Load and initialize the wallet (already saved to IndexedDB)
    const mainnetWallet = await Wallet.named(nameWallet);
    store.setWallet(mainnetWallet);
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
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
    <!-- Step 1: Wallet Creation -->
    <div v-if="step === 1">
      <div style="margin: 20px 0;">
        <h4><img class="icon plusIcon" :src="settingsStore.darkMode ? 'images/plus-square-lightGrey.svg' : 'images/plus-square.svg'"> Create new wallet</h4>
        <input @click="createNewWallet()" class="button primary" type="button" value="Create">
      </div>
      <hr style="margin: 30px 0;">
      <div style="margin: 20px 0;">
        <h4><img class="icon importIcon" :src="settingsStore.darkMode ? 'images/import-lightGrey.svg' : 'images/import.svg'"> Import existing wallet</h4>
        <div>Enter mnemonic seed phrase</div>
        <textarea v-model="seedphrase" style="resize: none;" rows="3" cols="50" placeholder="word1 word2 ..."></textarea>
        <span>Derivation path: </span>
        <select v-model="selectedDerivationPath">
          <option value="standard">m/44'/145'/0' (standard)</option>
          <option value="bitcoindotcom">m/44'/0'/0' (bitcoin.com wallet)</option>
        </select>
        <div style="margin-top: 5px;">
          <i>Note:</i> Cashonize is a single-address wallet so you can't fully import HD wallets
        </div>
        <input @click="importWallet()" class="button primary" type="button" style="margin-top:15px" value="Import">
      </div>
    </div>

    <!-- Step 2: Preferences -->
    <div v-else-if="step === 2">
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
