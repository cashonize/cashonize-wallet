
<script setup lang="ts">
  import { ref } from 'vue'
  import { Core } from '@walletconnect/core'
  import { Web3Wallet } from '@walletconnect/web3wallet'
  import { useStore } from '../stores/store'
  const store = useStore()

  const dappUriInput = ref("");

  const core = new Core({
    projectId: "3fd234b8e2cd0e1da4bc08a0011bbf64"
  });

  const web3wallet = await Web3Wallet.init({
    core,
    metadata: {
      name: 'Cashonize',
      description: 'Cashonize BitcoinCash Web Wallet',
      url: 'cashonize.com/',
      icons: ['https://cashonize.com/images/favicon.ico'],
    }
  })

  async function connectDappWithUri(){
    if (!dappUriInput.value) {
      throw new Error("Please paste valid Wallet Connect V2 connection URI");
    }
    await web3wallet.core.pairing.pair({ uri: dappUriInput.value });
    dappUriInput.value = "";
  }

  web3wallet.on('session_proposal', renderSessionProposal);

  async function renderSessionProposal(sessionProposal: any) {
    const { requiredNamespaces } = sessionProposal.params;

    if (!requiredNamespaces.bch) {
      alert(`You are trying to connect an app from unsupported blockchain(s): ${Object.keys(requiredNamespaces).join(", ")}`);
      return;
    }

    const requiredNetworkPrefix = requiredNamespaces.bch.chains[0]?.split(":")[1];
    let needsNetworkSwitch = false;
    const networkPrefixWallet = store.network == "mainnet" ? "bitcoincash" : "bchtest";
    if(requiredNetworkPrefix !== networkPrefixWallet) needsNetworkSwitch = true

    alert("needsNetworkSwitch: " + needsNetworkSwitch)
  }
</script>

<template>
  <fieldset class="item">
    <legend>WalletConnect</legend>

    Connect New dApp:

    <input v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
    <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem;">
      <input @click="connectDappWithUri" type="button" class="primaryButton" id="connect" value="Connect New dApp">
      <input @click="() => {}" type="button" class="primaryButton" id="send" value="Scan QR Code">
    </div>
    

    <br/><br/>

    Active Sessions:
  </fieldset>
</template>