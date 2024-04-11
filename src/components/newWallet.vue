<script setup lang="ts">
  import { ref } from "vue"
  import { Wallet, TestNetWallet, Config } from "mainnet-js"
  import { useQuasar } from 'quasar'
  const $q = useQuasar()

  const seedphrase = ref(undefined as (string | undefined));
  const selectedDerivationPath =  ref("standard" as ("standard" | "bitcoindotcom"));
  const emit = defineEmits(['initWallet']);

  const nameWallet = "mywallet";

  async function createNewWallet() {
    const mainnetWallet = await Wallet.named(nameWallet);
    const walletId = mainnetWallet.toDbString().replace("mainnet", "testnet");
    await TestNetWallet.replaceNamed(nameWallet, walletId);
    emit('initWallet', mainnetWallet);
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
      emit('initWallet', mainnetWallet);
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
    <h4><img class="icon plusIcon" src="images/plus-square.svg"> Create new wallet</h4>
    <input @click="createNewWallet()" class="button primary" type="button" value="Create">
    <br><br>
    <hr>
    <br>
    <h4><img class="icon importIcon" src="images/import.svg"> Import existing wallet</h4>
    <div>Enter mnemonic seed phrase</div>
    <textarea v-model="seedphrase" style="resize: none;" rows="3" cols="50" placeholder="word1 word2 ..."></textarea>
    <span>Derivation path: </span>
    <select v-model="selectedDerivationPath">
      <option value="standard">m/44’/145’/0’ (standard)</option>
      <option value="bitcoindotcom">m/44’/0’/0’ (bitcoin.com wallet)</option>
    </select> <br>
    <input @click="importWallet()" class="button primary" type="button" style="margin-top:15px" value="Import">
    <br><br>
  </fieldset>
</template>