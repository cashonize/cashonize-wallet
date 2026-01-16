<script setup lang="ts">
  import { ref, computed } from "vue"
  import { Wallet, TestNetWallet, Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { namedWalletExistsInDb } from 'src/utils/dbUtils'
  const store = useStore()
  const $q = useQuasar()

  // Step: 1 = name, 2 = choose type, 3 = import details
  const step = ref(1);
  const walletName = ref('');
  const seedphrase = ref('');
  const selectedDerivationPath = ref("standard" as ("standard" | "bitcoindotcom"));

  const effectiveWalletName = computed(() => walletName.value.trim());

  async function proceedToStep2() {
    const name = walletName.value.trim();
    if (!name) {
      $q.notify({
        message: "Please enter a wallet name",
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
        message: `Wallet "${name}" already exists`,
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    step.value = 2;
  }

  async function createNewWallet() {
    try {
      const name = effectiveWalletName.value;
      // Check if wallet already exists
      const exists = await namedWalletExistsInDb(name, "bitcoincash");
      if (exists) {
        throw `Wallet "${name}" already exists`;
      }
      Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      const mainnetWallet = await Wallet.named(name);
      const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
      await TestNetWallet.replaceNamed(name, walletId);
      // Update active wallet name in store
      store.activeWalletName = name;
      localStorage.setItem('activeWalletName', name);
      store.setWallet(mainnetWallet);
      store.changeView(1);
      // Refresh available wallets list
      await store.refreshAvailableWallets();
      // fire-and-forget promise does not wait on full wallet initialization
      void store.initializeWallet();
    } catch (err) {
      const errorMessage = typeof err == 'string' ? err : "Failed to create wallet";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof err == 'string' ? "grey-7" : "red"
      })
    }
  }

  async function importWallet() {
    try {
      const name = effectiveWalletName.value;
      // Check if wallet already exists
      const exists = await namedWalletExistsInDb(name, "bitcoincash");
      if (exists) {
        throw `Wallet "${name}" already exists`;
      }
      const derivationPath = selectedDerivationPath.value == "standard"? "m/44'/145'/0'/0/0" : "m/44'/0'/0'/0/0";
      if(selectedDerivationPath.value == "standard") Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      if(!seedphrase.value) throw("Enter a seed phrase to import wallet")
      const walletId = `seed:mainnet:${seedphrase.value}:${derivationPath}`;
      await Wallet.replaceNamed(name, walletId);
      const walletIdTestnet = `seed:testnet:${seedphrase.value}:${derivationPath}`;
      await TestNetWallet.replaceNamed(name, walletIdTestnet);
      const mainnetWallet = await Wallet.named(name);
      // Update active wallet name in store
      store.activeWalletName = name;
      localStorage.setItem('activeWalletName', name);
      store.setWallet(mainnetWallet);
      store.changeView(1);
      // Refresh available wallets list
      await store.refreshAvailableWallets();
      // fire-and-forget promise does not wait on full wallet initialization
      void store.initializeWallet();
    } catch (error) {
      const errorMessage = typeof error == 'string' ? error : "Not a valid seed phrase"
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof error == 'string' ? "grey-7" : "red"
      })
    }
  }
</script>

<template>
  <fieldset style="margin-top: 15px;">
    <legend>Add Wallet</legend>

    <!-- Step 1: Enter wallet name -->
    <div v-if="step === 1">
      <div style="margin-bottom: 20px;">
        <label for="walletName" style="display: block; margin-bottom: 8px;">Wallet name:</label>
        <input
          v-model="walletName"
          type="text"
          id="walletName"
          placeholder="Enter wallet name"
          style="width: 100%; max-width: 300px; padding: 8px;"
        >
      </div>
      <input
        @click="proceedToStep2()"
        class="button primary"
        type="button"
        value="Continue"
        style="margin-bottom: 15px;"
      >
    </div>

    <!-- Step 2: Choose wallet type -->
    <div v-else-if="step === 2">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="step = 1">
        ← Back
      </div>
      <div style="margin-bottom: 20px;">
        Creating wallet: <span class="wallet-name-styled">{{ effectiveWalletName }}</span>
      </div>
      <div style="margin-bottom: 15px;">
        <input
          @click="createNewWallet()"
          class="button primary"
          type="button"
          value="Create new wallet"
          style="margin-bottom: 10px;"
        ><br>
        <input
          @click="step = 3"
          class="button"
          type="button"
          value="Import existing wallet"
        >
      </div>
    </div>

    <!-- Step 3: Import wallet details -->
    <div v-else-if="step === 3">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="step = 2">
        ← Back
      </div>
      <div style="margin-bottom: 20px;">
        Importing wallet: <span class="wallet-name-styled">{{ effectiveWalletName }}</span>
      </div>
      <div style="margin-bottom: 15px;">
        <div style="margin-bottom: 8px;">Enter mnemonic seed phrase:</div>
        <textarea
          v-model="seedphrase"
          style="resize: none; width: 100%; max-width: 400px; padding: 8px;"
          rows="3"
          placeholder="word1 word2 word3 ..."
        ></textarea>
        <div style="margin-top: 15px;">
          <label>Derivation path: </label>
          <select v-model="selectedDerivationPath">
            <option value="standard">m/44'/145'/0' (standard)</option>
            <option value="bitcoindotcom">m/44'/0'/0' (bitcoin.com wallet)</option>
          </select>
        </div>
        <div style="margin-top: 10px; font-size: smaller; color: grey;">
          Note: Cashonize is a single-address wallet so you can't fully import HD wallets
        </div>
        <input
          @click="importWallet()"
          class="button primary"
          type="button"
          style="margin-top: 15px; margin-bottom: 15px;"
          value="Import"
        >
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.wallet-name-styled {
  font-family: monospace;
  background-color: #f0f0f0;
  padding: 2px 8px;
  border-radius: 4px;
}
body.dark .wallet-name-styled {
  background-color: #2a2a3e;
}
</style>
