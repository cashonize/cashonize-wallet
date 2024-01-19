<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import { ref } from 'vue'
  import { useStore } from '../stores/store'
  const store = useStore()

  const displayeSeedphrase = ref(false);
  const selectedNetwork = ref(store.network);
  const selectedUnit  = ref(store.bchUnit);
  const selectedDarkMode  = ref(store.darkMode);
  const emit = defineEmits(['changeView','changeNetwork']);

  function changeUnit(){
    store.bchUnit = selectedUnit.value;
    localStorage.setItem("unit", selectedUnit.value);
    emit('changeView', 1);
  }
  function changeNetwork(){
    emit('changeNetwork', selectedNetwork.value);
  }
  function changeDarkMode(){
    store.darkMode = selectedDarkMode.value;
    localStorage.setItem("darkMode", selectedDarkMode.value? "true" : "false");
    selectedDarkMode.value ? document.body.classList.add("dark") : document.body.classList.remove("dark")
  }
  function toggleShowSeedphrase(){
    displayeSeedphrase.value = !displayeSeedphrase.value;
  }
  function confirmDeleteWallet(){
    let text = "You are about to delete your Cashonize wallet info from this browser.\nAre you sure you want to delete?";
    if (confirm(text)){
      indexedDB.deleteDatabase("bitcoincash");
      indexedDB.deleteDatabase("bchtest");
      location.reload(); 
    }
  }
</script>

<template>
  <fieldset class="item">
    <legend>Settings</legend>
    <span style="margin-top: 15px;">Dark mode
      <Toggle v-model="selectedDarkMode" @change="changeDarkMode()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
    </span>
    <div style="margin-top:15px">
      <label for="selectUnit">Select default unit:</label>
      <select v-model="selectedUnit" @change="changeUnit()">
        <option value="bch">BCH</option>
        <option value="sat">satoshis</option>
      </select>
    </div>
    <div style="margin-top:15px">
      <label for="selectNetwork">Change network:</label>
      <select v-model="selectedNetwork" @change="changeNetwork()">
        <option value="mainnet">mainnet</option>
        <option value="chipnet">chipnet</option>
      </select>
    </div>
    <div style="margin-top:15px">Make backup of seed phrase (mnemonic)</div>
    <input @click="toggleShowSeedphrase()" class="button primary" type="button" style="padding: 1rem 1.5rem; display: block;" 
      :value="displayeSeedphrase? 'Hide seed phrase' : 'Show seed phrase'"
    >
    <div v-if="displayeSeedphrase" id="seedphrase"> {{store.wallet?.mnemonic }}</div>
    <br>
    <span style="margin-top:15px">Derivation path of this wallet is {{store.wallet?.derivationPath }}</span>
    <div style="margin-top:15px">Remove wallet data from browser</div>
    <input @click="confirmDeleteWallet()" type="button" id="burnNFT" value="Delete wallet" class="button error" style="display: block;">
  </fieldset>
</template>

<style src="@vueform/toggle/themes/default.css"></style>../stores/store