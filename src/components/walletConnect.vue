
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import WC2SessionRequestDialog from 'src/components/walletconnect/WC2SessionRequestDialog.vue';
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useQuasar } from 'quasar'
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';
  const $q = useQuasar()
  const store = useStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet

  const props = defineProps<{
    dappUriUrlParam?: string
  }>()

  const dappUriInput = ref("");
  const sessionProposalWC = ref(undefined as any);
  const activeSessions = computed(() => walletconnectStore.activeSessions)
  const showQrCodeDialog = ref(false);

  async function connectDappUriInput(){
    try {
      if(!dappUriInput.value) throw("Enter a BCH WalletConnect URI");
      await web3wallet?.core.pairing.pair({ uri: dappUriInput.value });
      dappUriInput.value = "";
    } catch(error) {
      const errorMessage = typeof error == 'string' ? error : "Not a valid BCH WalletConnect URI"
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: typeof error == 'string' ? "grey-7" : "red"
      })
    }
  }

  if(props.dappUriUrlParam){
    await web3wallet?.core.pairing.pair({ uri: props.dappUriUrlParam })
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

  const qrDecode = async (content: string) => {
    await web3wallet?.core.pairing.pair({ uri: content});
  }
  const qrFilter = (content: string) => {
    const matchV2 = String(content).match(/^wc:([0-9a-fA-F]{64})@(\d+)\?([a-zA-Z0-9\-._~%!$&'()*+,;=:@/?=&]*)$/i);
    console.log(matchV2);
    if (matchV2) {
      return true;
    }

    return false;
}
</script>

<template>
  <fieldset class="item">
    <legend>WalletConnect</legend>

    Connect New dApp:

    <div style="display: flex; gap: 0.5rem; ">
      <input v-model="dappUriInput" placeholder="Wallet Connect URI" style="margin-bottom: 10px;">
      <button @click="() => showQrCodeDialog = true" style="padding: 12px; height: 43px;">
        <img src="images/qrscan.svg" />
      </button>
    </div>

    <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem;">
      <input @click="connectDappUriInput" type="button" class="primaryButton" id="connect" value="Connect New dApp">
      <!--<input @click="() => {}" type="button" class="primaryButton" id="send" value="Scan QR Code">-->
    </div>

    <div v-if="sessionProposalWC">
      <WC2SessionRequestDialog :sessionProposalWC="sessionProposalWC" @approve-session="(arg) => approveSession(arg)" @reject-session="rejectSession()"/>
    </div>

    <br/>

    <div v-if="activeSessions">
      Active Sessions:
      <div v-for="sessionInfo in Object.values(activeSessions).reverse()" :key="sessionInfo.topic" class="wc2sessions" >
        <WC2ActiveSession :dappMetadata="sessionInfo.peer.metadata" :sessionId="sessionInfo.topic" @delete-session="(arg) => deleteSession(arg)"/>
      </div>
    </div>
    <div v-else>
      No Active Sessions
    </div>
    
  </fieldset>

  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>