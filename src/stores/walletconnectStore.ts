import { defineStore } from "pinia"
import { ref, type Ref } from 'vue'
import { Core } from '@walletconnect/core'
import { WalletKit, type WalletKitTypes, type IWalletKit } from '@reown/walletkit'
import type { SessionTypes } from '@walletconnect/types'
import { convert, type TestNetWallet, type Wallet } from "mainnet-js";
import {
  hexToBin,
  binToHex,
  sha256,
  encodeLockingBytecodeP2pkh,
  decodeTransaction
} from "@bitauth/libauth"
import { getSdkError } from '@walletconnect/utils';
import { parseExtendedJson } from 'src/utils/utils'
import alertDialog from 'src/components/alertDialog.vue'
import { Dialog, Notify } from "quasar";
import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
import type { WcSignMessageObj, WcTransactionObj } from "src/interfaces/wcInterfaces"
import { useSettingsStore } from 'src/stores/settingsStore';
import { createSignedWcTransaction } from "src/utils/wcSigning"
import WC2SessionRequestDialog from "src/components/walletconnect/WC2SessionRequestDialog.vue"
import { displayAndLogError } from "src/utils/errorHandling"
import { WcMessageObjSchema, EncodedWcTransactionObjSchema } from "src/utils/zodValidation"
const settingsStore = useSettingsStore()

type ChangeNetwork = (network: "mainnet" | "chipnet") => Promise<void>;

// NOTE: We use a wrapper so that we can pass in the MainnetJs Wallet as an argument.
//       This keeps the mutable state more managable in the sense that WC cannot exist without a valid wallet.
// Passing in a Ref so it remains reactive (like when changing networks)
export const useWalletconnectStore = async (wallet: Ref<Wallet | TestNetWallet>, changeNetwork: ChangeNetwork) => {
  const store = defineStore("walletconnectStore", () => {
    const activeSessions = ref(undefined as undefined | Record<string, SessionTypes.Struct>);
    const web3wallet = ref(undefined as undefined | IWalletKit);
    
    // Store a state variable to make sure we don't call "initweb3wallet" more than once.
    const isIninialized = ref(false);

    async function initweb3wallet() {
      // Make sure we don't ininialize WC more than once.
      // Otherwise, we'll register multiple handlers and end up with multiple dialgos.
      if (isIninialized.value) return;

      const core = new Core({
        projectId: "3fd234b8e2cd0e1da4bc08a0011bbf64"
      });

      const newweb3wallet = await WalletKit.init({
        // @ts-ignore: it complains about not having a 'relayUrl' property but it is not needed
        core,
        metadata: {
          name: 'Cashonize',
          description: 'Cashonize, a Bitcoin Cash Wallet',
          url: 'https://cashonize.com',
          icons: ['https://cashonize.com/images/favicon.ico'],
        }
      })

      newweb3wallet?.on('session_proposal', wcSessionProposal);
      newweb3wallet?.on('session_request', async (event) => wcRequest(event, wallet.value.getDepositAddress()));
      web3wallet.value = newweb3wallet
      activeSessions.value = web3wallet.value.getActiveSessions();

      // Set our state variable so we don't initialize it again when switching networks.
      isIninialized.value = true;
    }

    async function wcSessionProposal(sessionProposal: WalletKitTypes.SessionProposal) {
      const { requiredNamespaces } = sessionProposal.params;
  
      if (!requiredNamespaces.bch) {
        const errorMessage = `Trying to connect an app from unsupported blockchain(s): ${Object.keys(requiredNamespaces).join(", ")}`;
        Notify.create({
          message: errorMessage,
          icon: 'warning',
          color: "red"
        })
        return;
      }
      return await new Promise<void>((resolve, reject) => {
        const { requiredNamespaces } = sessionProposal.params;
        const dappNetworkPrefix = requiredNamespaces.bch?.chains?.[0]?.split(":")[1];
        const dappTargetNetwork = dappNetworkPrefix == "bitcoincash" ? "mainnet" : "chipnet";
        Dialog.create({
          component: WC2SessionRequestDialog,
          componentProps: {
            sessionProposalWC: sessionProposal,
            dappTargetNetwork
          },
        })
          .onOk(async() => {
            try {
              await approveSession(sessionProposal, dappTargetNetwork);
              resolve();
            } catch (error) {
              console.error("Failed to approve session:", error);
              Notify.create({
                type: 'negative',
                message: 'Failed to approve session',
              });
              reject();
            }
          })
          .onCancel(async() => {
            await web3wallet.value?.rejectSession({
              id: sessionProposal.id,
              reason: getSdkError('USER_REJECTED'),
            });
            reject();
          })
      });
  }

    async function approveSession(sessionProposal: WalletKitTypes.SessionProposal, dappTargetNetwork: "mainnet" | "chipnet"){
      
      const currentNetwork = wallet.value?.network == "mainnet" ? "mainnet" : "chipnet"
      if(currentNetwork != dappTargetNetwork){
        await changeNetwork(dappTargetNetwork)
      }
      
      const namespaces = {
        bch: {
          methods: [
            "bch_getAddresses",
            "bch_signTransaction",
            "bch_signMessage"
          ],
          chains: dappTargetNetwork === "mainnet" ? ["bch:bitcoincash"] : ["bch:bchtest"],
          events: [ "addressesChanged" ],
          accounts: [`bch:${wallet.value?.getDepositAddress()}`],
        }
      }
      
      try {
        await web3wallet.value?.approveSession({
          id: sessionProposal.id,
          namespaces: namespaces,
        });
        activeSessions.value = web3wallet.value?.getActiveSessions();
      } catch (error) {
        console.log("Error in approveSession", error)
      }
    }

    
    async function deleteSession(sessionId :string){
      await web3wallet.value?.disconnectSession({
        topic: sessionId,
        reason: getSdkError("USER_DISCONNECTED")
      });
      settingsStore.clearAutoApproveState(sessionId);

      activeSessions.value = web3wallet.value?.getActiveSessions();
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
          if(!isValidSignMessageRequest(event)) return
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
                  message: "Successfully signed message",
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

          if(!isValidSignTransactionRequest(event)) return

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

    async function isValidSignTransactionRequest(transactionRequestWC: WalletKitTypes.SessionRequest) {
      const { id, topic } = transactionRequestWC;

      // payload sent by the dapp over walletconnect
      const wcSignTransactionParams = transactionRequestWC.params.request.params

      // the wcSignTransactionParams is from an untrusted source, so we validate the schema with zod
      try {
        const encodedWcTransactionObj = EncodedWcTransactionObjSchema.parse(wcSignTransactionParams);
        // Further validation whether the 
        if(typeof encodedWcTransactionObj.transaction === "string") {
          const decodedResult = decodeTransaction(hexToBin(encodedWcTransactionObj.transaction));
          if(typeof decodedResult == "string") throw new Error("Invalid transaction hex string in encodedWcTransactionObj: " + decodedResult);
        }
        // TODO: do we also want to encode the decoded TransactionBCH as a way of validation?
      } catch (error) {
        const errorMessage = typeof error == 'string' ? error :((error instanceof Error)? error.message : "Error in validating schema of WalletConnect transaction request")
        Notify.create({
          type: 'negative',
          message: errorMessage
        })
        // respond with error to dapp
        const wcErrorMessage = 'Transaction signing request aborted with error: ' + errorMessage;
        const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
        await web3wallet.value?.respondSessionRequest({ topic, response });
        return false
      }
    }

    async function signTransactionWC(transactionRequestWC: WalletKitTypes.SessionRequest) {
      // isValidSignTransactionRequest has checked the params already when this function is called
      const wcSignTransactionParams = transactionRequestWC.params.request.params
      // parse as extended JSON to handle Uint8Array and BigInt
      const wcTransactionObj = parseExtendedJson(JSON.stringify(wcSignTransactionParams)) as WcTransactionObj;

      const { privateKey, publicKeyCompressed: pubkeyCompressed } = wallet.value;
      const walletLockingBytecode = encodeLockingBytecodeP2pkh(wallet.value.publicKeyHash);
      const walletLockingBytecodeHex = binToHex(walletLockingBytecode);
      const encodedTransaction = createSignedWcTransaction(
        wcTransactionObj, { privateKey, pubkeyCompressed }, walletLockingBytecodeHex
      );

      const hash = binToHex(sha256.hash(sha256.hash(encodedTransaction)).reverse());
      const signedTxObject = { signedTransaction: binToHex(encodedTransaction), signedTransactionHash: hash };

      // send transaction
      const { id, topic } = transactionRequestWC;
      if (wcTransactionObj.broadcast) {
        try{
          Notify.create({
            spinner: true,
            message: 'Sending transaction...',
            color: 'grey-5',
            timeout: 750
          })
          const txId = await wallet.value?.submitTransaction(hexToBin(signedTxObject.signedTransaction));
          const alertMessage = `Sent WalletConnect transaction '${wcTransactionObj.userPrompt}'`
          Dialog.create({
            component: alertDialog,
            componentProps: {
              alertInfo: { message: alertMessage, txid: txId } 
            }
          })
        } catch(error){
          const errorMessage = typeof error == 'string' ? error :((error instanceof Error)? error.message : "Error in sending transaction")
          Notify.create({
            type: 'negative',
            message: errorMessage
          })
          // respond with error to dapp
          const wcErrorMessage = 'Transaction failed to send with error: ' + errorMessage;
          const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
          await web3wallet.value?.respondSessionRequest({ topic, response });
          return
        }   
      }
      const response = { id, jsonrpc: '2.0', result: signedTxObject };
      await web3wallet.value?.respondSessionRequest({ topic, response });

      const message = wcTransactionObj.broadcast ? 'Transaction succesfully sent!' : 'Transaction succesfully signed!'
      Notify.create({
        type: 'positive',
        message
      })
    }

    async function isValidSignMessageRequest(signMessageRequestWC: WalletKitTypes.SessionRequest) {
      const { id, topic } = signMessageRequestWC;
      try{
        // payload sent by the dapp over walletconnect
        const wcSignMessageParams = signMessageRequestWC.params.request.params

        // the wcSignMessageParams is from an untrusted source, so perform basic validation
        WcMessageObjSchema.parse(wcSignMessageParams);
        return true
      } catch (error) {
        const errorMessage = typeof error == 'string' ? error :((error instanceof Error)? error.message : "Error in validating schema of WalletConnect sign message request")
        Notify.create({
          type: 'negative',
          message: errorMessage
        })
        displayAndLogError(error);
        // respond with error to dapp
        const wcErrorMessage = 'Message signing request aborted with error: ' + errorMessage;
        const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
        await web3wallet.value?.respondSessionRequest({ topic, response });
        return false
      }
    }

    async function signMessage(signMessageRequestWC: WalletKitTypes.SessionRequest){
      // isValidSignMessageRequest has checked the params already when this function is called
      const wcSignMessageParams = signMessageRequestWC.params.request.params as WcSignMessageObj
      const message = wcSignMessageParams.message;
      const signedMessage = await wallet.value?.sign(message);

      const { id, topic } = signMessageRequestWC;
      const response = { id, jsonrpc: '2.0', result: signedMessage?.signature };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    async function rejectRequest(wcRequest: WalletKitTypes.SessionRequest){
      const { id, topic } = wcRequest;
      const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    return { web3wallet, activeSessions, initweb3wallet, wcRequest, deleteSession }
  
  })();

  return store;
}