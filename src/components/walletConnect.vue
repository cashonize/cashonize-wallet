
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import WC2SessionRequestDialog from 'src/components/walletconnect/WC2SessionRequestDialog.vue';
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet

  const dappUriInput = ref("");
  const sessionProposalWC = ref(undefined as any);
  const activeSessions = computed(() => walletconnectStore.activeSessions)

  async function connectDappWithUri(){
    if (!dappUriInput.value) {
      throw new Error("Please paste valid Wallet Connect V2 connection URI");
    }
    await web3wallet?.core.pairing.pair({ uri: dappUriInput.value });
    dappUriInput.value = "";
  }

  web3wallet?.on('session_proposal', renderSessionProposal);

  async function renderSessionProposal(sessionProposal: any) {
    const { requiredNamespaces } = sessionProposal.params;

    if (!requiredNamespaces.bch) {
      alert(`You are trying to connect an app from unsupported blockchain(s): ${Object.keys(requiredNamespaces).join(", ")}`);
      return;
    }

    sessionProposalWC.value = sessionProposal;
  }

  async function approveSession(sessionProposal: any){
    const namespaces = {
      bch: {
        methods: [
          "bch_getAddresses",
          "bch_signTransaction",
          "bch_signMessage"
        ],
        chains: store.network === "mainnet" ? ["bch:bitcoincash"] : ["bch:bchtest"],
        events: [ "addressesChanged" ],
        accounts: [`bch:${store.wallet?.getDepositAddress()}`],
      }
    }

    await web3wallet?.approveSession({
      id: sessionProposal.id,
      namespaces: namespaces,
    });

    const updatedSessions = web3wallet?.getActiveSessions();
    walletconnectStore.activeSessions = updatedSessions;
    sessionProposalWC.value = undefined;
  }

  async function deleteSession(sessionId :string){
    await web3wallet?.disconnectSession({
      topic: sessionId,
      reason: getSdkError("USER_DISCONNECTED")
    });

    const updatedSessions = web3wallet?.getActiveSessions();
    walletconnectStore.activeSessions = updatedSessions;
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

    <div v-if="sessionProposalWC">
      <WC2SessionRequestDialog :sessionProposalWC="sessionProposalWC" @approve-session="(arg) => approveSession(arg)"/>
    </div>

    <br/>

    <div v-if="Object.values(activeSessions).length">
      Active Sessions:
      <div v-for="(sessionInfo, index) in Object.values(activeSessions).reverse()" :key="activeSessions[index]" class="wc2sessions" >
        <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" @delete-session="(arg) => deleteSession(arg)"/>
      </div>
    </div>
    <div v-else>
      No Active Sessions
    </div>
    
  </fieldset>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>