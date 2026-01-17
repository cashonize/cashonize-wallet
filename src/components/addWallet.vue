<script setup lang="ts">
  import { ref, computed } from "vue"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  import { namedWalletExistsInDb } from 'src/utils/dbUtils'
  import { createNewWallet as createWallet, importWallet as importWalletUtil } from 'src/utils/walletUtils'
  import type { DerivationPathType } from 'src/utils/walletUtils'
  import seedPhraseInput from './seedPhraseInput.vue'
  const store = useStore()
  const $q = useQuasar()

  // Step: 1 = name, 2 = choose type (create exits here), 3 = import details (import only)
  const step = ref<1 | 2 | 3>(1);
  const walletName = ref('');
  const seedPhrase = ref('');
  const seedPhraseValid = ref(false);
  const selectedDerivationPath = ref<DerivationPathType>("standard");

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
    const result = await createWallet(walletName.value);
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
    const result = await importWalletUtil({
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
        <div style="font-size: smaller; color: grey; margin-bottom: 10px;">
          A new seed phrase will be generated. Back it up to secure your wallet.
        </div>
        <input
          @click="createNewWallet()"
          class="button primary"
          type="button"
          value="Create new wallet"
          style="margin-bottom: 15px;"
        >
        <div style="font-size: smaller; color: grey; margin-bottom: 10px;">
          Or restore a wallet using your existing seed phrase.
        </div>
        <input
          @click="step = 3"
          class="button"
          type="button"
          value="Import existing wallet"
        >
      </div>
    </div>

    <!-- Step 3: Import wallet details (only reached when importing) -->
    <div v-else-if="step === 3">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="step = 2">
        ← Back
      </div>
      <div style="margin-bottom: 20px;">
        Importing wallet: <span class="wallet-name-styled">{{ effectiveWalletName }}</span>
      </div>
      <div style="margin-bottom: 15px;">
        <seedPhraseInput v-model="seedPhrase" v-model:isValid="seedPhraseValid" />
        <div style="margin-top: 15px;">
          <label>Derivation path: </label>
          <select v-model="selectedDerivationPath">
            <option value="standard">m/44'/145'/0' (standard)</option>
            <option value="bitcoindotcom">m/44'/0'/0' (bitcoin.com wallet)</option>
          </select>
        </div>
        <div style="margin-top: 10px; font-size: smaller; color: grey;">
          Note: Only the first address from your seed phrase will be used.
          If you've used this seed with other wallets, funds on other addresses won't appear.
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
