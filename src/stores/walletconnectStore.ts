import { defineStore } from "pinia"
import { ref } from 'vue'
import { Core } from '@walletconnect/core'
import { WalletKit, type WalletKitTypes, type IWalletKit } from '@reown/walletkit'
import type { SessionTypes } from '@walletconnect/types'
import { convert, type TestNetWallet, type Wallet } from "mainnet-js";
import {
  hexToBin,
  binToHex,
  sha256,
  encodeLockingBytecodeP2pkh
} from "@bitauth/libauth"
import { getSdkError } from '@walletconnect/utils';
import { parseExtendedJson } from 'src/utils/utils'
import alertDialog from 'src/components/alertDialog.vue'
import { Dialog, Notify } from "quasar";
import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
import type { WcTransactionObj } from "src/interfaces/wcInterfaces"
import { useSettingsStore } from 'src/stores/settingsStore';
import { createSignedWcTransaction } from "src/utils/wcSigning"
const settingsStore = useSettingsStore()

// NOTE: We use a wrapper so that we can pass in the Mainnet Wallet as an argument.
export const useWalletconnectStore = async (wallet: Wallet | TestNetWallet) => {
  const store = defineStore("walletconnectStore", () => {
    const activeSessions = ref(undefined as undefined | Record<string, SessionTypes.Struct>);
    const web3wallet = ref(undefined as undefined | IWalletKit);

    async function initweb3wallet() {
      const core = new Core({
        projectId: "3fd234b8e2cd0e1da4bc08a0011bbf64"
      });

      const newweb3wallet = await WalletKit.init({
        // @ts-ignore: it complais about not having a 'relayUrl' property but it is not needed
        core,
        metadata: {
          name: 'Cashonize',
          description: 'Cashonize BitcoinCash Web Wallet',
          url: 'https://cashonize.com',
          icons: ['https://cashonize.com/images/favicon.ico'],
        }
      })

      web3wallet.value = newweb3wallet
      activeSessions.value = web3wallet.value.getActiveSessions();
    }
    
    // Wallet connect dialog functionality
    async function wcRequest(event: WalletKitTypes.SessionRequest, walletAddress: string) {
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
          const dappMetadata = session.peer.metadata;
          return await new Promise<void>((resolve, reject) => {
            Dialog.create({
              component: WC2SignMessageRequest,
              componentProps: {
                dappMetadata,
                signMessageRequestWC: event
              },
            })
              .onOk(async() => {
                await signMessage(event)
                resolve();
                Notify.create({
                  color: "positive",
                  message: "Successfully signed transaction",
                });
              })
              .onCancel(async() => {
                await rejectRequest(event)
                reject();
              })
              .onDismiss(() => {
                reject();
              });
          });
        }
        case "bch_signTransaction": {
          const sessions = web3wallet.value.getActiveSessions();
          const session = sessions[topic];
          if (!session) return;

          // Auto-approve early return
          if (settingsStore.isAutoApproveValid(topic)) {
            await signTransactionWC(event)
            // Decrement request count if applicable
            if (settingsStore.getAutoApproveState(topic)?.mode === "count") {
              settingsStore.decrementAutoApproveRequest(topic);
            }
            return;
          }

          // Manually approve
          const dappMetadata = session.peer.metadata;
          const exchangeRate = await convert(1, "bch", settingsStore.currency);
          return await new Promise<void>((resolve, reject) => {
            Dialog.create({
              component: WC2TransactionRequest,
              componentProps: {
                dappMetadata,
                transactionRequestWC: event,
                exchangeRate
              },
            })
              .onOk(async() => {
                await signTransactionWC(event)
                resolve();
              })
              .onCancel(async() => {
                await rejectRequest(event)
                reject();
              })
              .onDismiss(() => {
                reject();
              });
          });
        }
        default:{
          const response = { id, jsonrpc: '2.0', error: {code: 1001, message: `Unsupported method ${method}`} };
          await web3wallet.value.respondSessionRequest({ topic, response });
        }
      }
    }

    async function signTransactionWC(transactionRequestWC: WalletKitTypes.SessionRequest) {
      // parse params from transactionRequestWC
      const requestParams = parseExtendedJson(JSON.stringify(transactionRequestWC.params.request.params)) as WcTransactionObj;
      const { transaction, sourceOutputs } = requestParams;

      const {privateKey, publicKeyCompressed:pubkeyCompressed } = wallet;
      if(!privateKey || !pubkeyCompressed) throw new Error("should never happen")

      const walletLockingBytecode = encodeLockingBytecodeP2pkh(wallet?.publicKeyHash as Uint8Array);
      const walletLockingBytecodeHex = binToHex(walletLockingBytecode);
      const encodedTransaction = createSignedWcTransaction(
        transaction, sourceOutputs, { privateKey, pubkeyCompressed }, walletLockingBytecodeHex
      );

      const hash = binToHex(sha256.hash(sha256.hash(encodedTransaction)).reverse());
      const signedTxObject = { signedTransaction: binToHex(encodedTransaction), signedTransactionHash: hash };

      // send transaction
      if (requestParams.broadcast) {
        try{
          Notify.create({
            spinner: true,
            message: 'Sending transaction...',
            color: 'grey-5',
            timeout: 750
          })
          const txId = await wallet?.submitTransaction(hexToBin(signedTxObject.signedTransaction));
          const alertMessage = `Sent WalletConnect transaction '${requestParams.userPrompt}'`
          Dialog.create({
            component: alertDialog,
            componentProps: {
              alertInfo: { message: alertMessage, txid: txId } 
            }
          })
        } catch(error){
          console.log(error)
          Notify.create({
            type: 'negative',
            message: typeof error == 'string' ? error :  "Error in sending transaction"
          })
          return
        }   
      }
      const { id, topic } = transactionRequestWC;
      const response = { id, jsonrpc: '2.0', result: signedTxObject };
      await web3wallet.value?.respondSessionRequest({ topic, response });

      const message = requestParams.broadcast ? 'Transaction succesfully sent!' : 'Transaction succesfully signed!'
      Notify.create({
        type: 'positive',
        message
      })
    }

    async function signMessage(signMessageRequestWC: WalletKitTypes.SessionRequest){
      const requestParams = signMessageRequestWC.params.request.params
      const message = requestParams?.message;
      const signedMessage = await wallet?.sign(message);

      const { id, topic } = signMessageRequestWC;
      const response = { id, jsonrpc: '2.0', result: signedMessage?.signature };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    async function rejectRequest(wcRequest: WalletKitTypes.SessionRequest){
      const { id, topic } = wcRequest;
      const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    return { web3wallet, activeSessions, initweb3wallet, wcRequest }
  
  })();

  return store;
}