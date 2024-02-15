
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import WC2SessionRequestDialog from 'src/components/walletconnect/WC2SessionRequestDialog.vue';
  import WC2ActiveSession from 'src/components/walletconnect/WC2ActiveSession.vue'
  import WC2TransactionRequest from './walletconnect/WC2TransactionRequest.vue';
  import { getSdkError } from '@walletconnect/utils';
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  const store = useStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet

  const dappUriInput = ref("");
  const sessionProposalWC = ref(undefined as any);
  const transactionRequestWC = ref(undefined as any);
  const dappMetadata = ref(undefined as any);
  const activeSessions = computed(() => walletconnectStore.activeSessions)

  async function connectDappWithUri(){
    if (!dappUriInput.value) {
      throw new Error("Please paste valid Wallet Connect V2 connection URI");
    }
    await web3wallet?.core.pairing.pair({ uri: dappUriInput.value });
    dappUriInput.value = "";
  }

  web3wallet?.on('session_proposal', wcSessionProposal);

  web3wallet?.on('session_request', async (event: any) => {
    wcRequest(event);
  });

  async function wcSessionProposal(sessionProposal: any) {
    const { requiredNamespaces } = sessionProposal.params;

    if (!requiredNamespaces.bch) {
      alert(`You are trying to connect an app from unsupported blockchain(s): ${Object.keys(requiredNamespaces).join(", ")}`);
      return;
    }

    sessionProposalWC.value = sessionProposal;
  }


  async function wcRequest(event: any) {
    const { topic, params, id } = event
    const { request } = params
    const method = request.method;

    let result;
    let error;

    const walletAddress = store.wallet?.getDepositAddress();

    switch (method) {
      case "bch_getAddresses":
      case "bch_getAccounts": {
        result = [walletAddress];
        const response = { id, jsonrpc: '2.0', result };
        web3wallet?.respondSessionRequest({ topic, response });
      }
        break;
      case "bch_signMessage":
      case "personal_sign": {
        alert("bch_signMessage")
      }
        break;
      case "bch_signTransaction": {
        if(!web3wallet) return
        const sessions = web3wallet.getActiveSessions();
        const session = sessions[topic];
        if (!session) return;
        const metadataDapp = session.peer.metadata;
        dappMetadata.value = metadataDapp
        transactionRequestWC.value = event;
      }
        break;
      default:{
        const response = { id, jsonrpc: '2.0', error: {code: 1001, message: `Unsupported method ${method}`} };
        await web3wallet?.respondSessionRequest({ topic, response });
      }
    }
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

  function signedTransaction(txId:string){
    alert("Transaction succesfully sent! Txid:" + txId)
    transactionRequestWC.value = undefined;
  }
  function rejectTransaction(){
    transactionRequestWC.value = undefined;
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
      <WC2SessionRequestDialog :sessionProposalWC="sessionProposalWC" @approve-session="(arg) => approveSession(arg)" @reject-session="rejectSession()"/>
    </div>

    <div v-if="transactionRequestWC">
      <WC2TransactionRequest :transactionRequestWC="transactionRequestWC" :dappMetadata="dappMetadata" @signed-transaction="(arg) => signedTransaction(arg)" @reject-transaction="rejectTransaction()"/>
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
</template>

<style>
  .wc2sessions:nth-child(odd) {
    background-color: azure;
  }
</style>