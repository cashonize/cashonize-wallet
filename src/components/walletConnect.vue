
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import WC2SessionRequestDialog from 'src/components/walletconnect/WC2SessionRequestDialog.vue';
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useQuasar } from 'quasar'
  import { type Wallet } from 'mainnet-js';
  defineExpose({
    connectDappUriInput
  });
  
  const $q = useQuasar()
  const store = useStore()

  // TODO: investigate moving to main store
  const walletconnectStore = await useWalletconnectStore(store.wallet as Wallet )
  const web3wallet = walletconnectStore.web3wallet

  const sessionProposalWC = ref(undefined as any);
  const activeSessions = computed(() => walletconnectStore.activeSessions)

  async function connectDappUriInput(url: string){
    try {
      if(!url) throw("Enter a BCH WalletConnect URI");
      await web3wallet?.core.pairing.pair({ uri: url });
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : "Not a valid BCH WalletConnect URI"
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof error == 'string' ? "grey-7" : "red"
      })
    }
  }

  web3wallet?.on('session_proposal', wcSessionProposal);

  async function wcSessionProposal(sessionProposal: any) {
    const { requiredNamespaces } = sessionProposal.params;

    if (!requiredNamespaces.bch) {
      const errorMessage = `Trying to connect an app from unsupported blockchain(s): ${Object.keys(requiredNamespaces).join(", ")}`;
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
      return;
    }

    sessionProposalWC.value = sessionProposal;
  }

  async function approveSession(sessionProposal: any, dappTargetNetwork: "mainnet" | "chipnet"){
    // Handle network switching when needed
    const currentNetwork = store.wallet?.network == "mainnet" ? "mainnet" : "chipnet"
    if(currentNetwork != dappTargetNetwork){
      await store.changeNetwork(dappTargetNetwork)
    }
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

  function rejectSession(){
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
    <legend>WalletConnect Sessions</legend>

    <div v-if="sessionProposalWC">
      <WC2SessionRequestDialog :sessionProposalWC="sessionProposalWC" @approve-session="(arg1, arg2) => approveSession(arg1, arg2)" @reject-session="rejectSession()"/>
    </div>

    <div v-for="sessionInfo in Object.values(activeSessions || {}).reverse()" :key="sessionInfo.topic" class="wc2sessions" >
      <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" @delete-session="(arg) => deleteSession(arg)"/>
    </div>
    <!-- Show Empty Message if no Sessions are active -->
    <template v-if="!Object.keys(activeSessions || {}).length">
      <div class="q-pa-md">No sessions currently active.</div>
    </template>
    
  </fieldset>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>
