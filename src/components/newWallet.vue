<script setup lang="ts">
  import { ref } from "vue"
  import { Wallet, TestNetWallet, Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  import { useStore } from 'src/stores/store'
  const store = useStore()
  const $q = useQuasar()
  const isBrowser = (process.env.MODE == "spa");

  const seedphrase = ref('');
  const selectedDerivationPath =  ref("standard" as ("standard" | "bitcoindotcom"));

  const nameWallet = "mywallet";

  async function createNewWallet() {
    Config.DefaultParentDerivationPath = "m/44'/145'/0'";
    const mainnetWallet = await Wallet.named(nameWallet);
    const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
    await TestNetWallet.replaceNamed(nameWallet, walletId);
    store.setWallet(mainnetWallet)
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
  }

  async function importWallet() {
    try{
      const derivationPath = selectedDerivationPath.value == "standard"? "m/44'/145'/0'/0/0" : "m/44'/0'/0'/0/0";
      if(selectedDerivationPath.value == "standard") Config.DefaultParentDerivationPath = "m/44'/145'/0'";
      if(!seedphrase.value) throw("Enter a seed phrase to import wallet")
      const walletId = `seed:mainnet:${seedphrase.value}:${derivationPath}`;
      await Wallet.replaceNamed(nameWallet, walletId);
      const walletIdTestnet = `seed:testnet:${seedphrase.value}:${derivationPath}`;
      await TestNetWallet.replaceNamed(nameWallet, walletIdTestnet);
      const mainnetWallet = await Wallet.named(nameWallet);
      store.setWallet(mainnetWallet)
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
  <div v-if="isBrowser" style="display:block; margin-top: -25px;">
    <a style="color: black; padding: 5px;" href="https://about.cashonize.com">
      <span style="font-size: 24px; vertical-align: sub;">⬅</span>
      <span> About page</span>
    </a>
  </div>
  
  <fieldset style="margin-top: 15px;">
    <div style="margin: 20px 0;">
      <h4><img class="icon plusIcon" src="images/plus-square.svg"> Create new wallet</h4>
      <input @click="createNewWallet()" class="button primary" type="button" value="Create">
    </div>
    <hr style="margin: 30px 0;">
    <div style="margin: 20px 0;">
      <h4><img class="icon importIcon" src="images/import.svg"> Import existing wallet</h4>
      <div>Enter mnemonic seed phrase</div>
      <textarea v-model="seedphrase" style="resize: none;" rows="3" cols="50" placeholder="word1 word2 ..."></textarea>
      <span>Derivation path: </span>
      <select v-model="selectedDerivationPath">
        <option value="standard">m/44’/145’/0’ (standard)</option>
        <option value="bitcoindotcom">m/44’/0’/0’ (bitcoin.com wallet)</option>
      </select>
      <div style="margin-top: 5px;">
        <i>Note:</i> Cashonize is a single-address wallet so you can't fully import HD wallets
      </div>
      <input @click="importWallet()" class="button primary" type="button" style="margin-top:15px" value="Import">
    </div>
  </fieldset>
</template>