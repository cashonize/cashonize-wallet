import { defineStore } from "pinia"
import { ref } from 'vue'
import { Core } from '@walletconnect/core'
import { Web3Wallet, type Web3WalletTypes } from '@walletconnect/web3wallet'
import type Client from '@walletconnect/web3wallet'
import type {SessionTypes} from '@walletconnect/types'

export const useWalletconnectStore = defineStore('walletconnectStore', () => {

  const activeSessions = ref(undefined as undefined | Record<string, SessionTypes.Struct>);
  const web3wallet = ref(undefined as undefined | Client);

  async function initweb3wallet() {
    const core = new Core({
      projectId: "3fd234b8e2cd0e1da4bc08a0011bbf64"
    });

    const newweb3wallet = await Web3Wallet.init({
      core,
      metadata: {
        name: 'Cashonize',
        description: 'Cashonize BitcoinCash Web Wallet',
        url: 'cashonize.com/',
        icons: ['https://cashonize.com/images/favicon.ico'],
      }
    })

    web3wallet.value = newweb3wallet
    activeSessions.value = web3wallet.value.getActiveSessions();
  }
  
  // Wallet connect dialog functionality
  async function wcRequest(event: Web3WalletTypes.SessionRequest, walletAddress: string) {
    if(!web3wallet.value) throw new Error("No web3wallet initialized")
    const { topic, params, id } = event;
    const { request } = params;
    const method = request.method;

    switch (method) {
      case "bch_getAddresses":
      case "bch_getAccounts": {
        const result = [walletAddress];
        const response = { id, jsonrpc: '2.0', result };
        web3wallet.value.respondSessionRequest({ topic, response });
      }
        break;
      case "bch_signMessage":
      case "personal_sign": {
        const sessions = web3wallet.value.getActiveSessions();
        const session = sessions[topic];
        if (!session) return;
        const metadataDapp = session.peer.metadata;
        // TODO: rework
        //dappMetadata.value = metadataDapp
        //signMessageRequestWC.value = event;
      }
        break;
      case "bch_signTransaction": {
        const sessions = web3wallet.value.getActiveSessions();
        const session = sessions[topic];
        if (!session) return;
        const metadataDapp = session.peer.metadata;
        // TODO: rework
        //dappMetadata.value = metadataDapp
        //transactionRequestWC.value = event;
      }
        break;
      default:{
        const response = { id, jsonrpc: '2.0', error: {code: 1001, message: `Unsupported method ${method}`} };
        await web3wallet.value.respondSessionRequest({ topic, response });
      }
    }
  }

  return { web3wallet, activeSessions, initweb3wallet, wcRequest }
})