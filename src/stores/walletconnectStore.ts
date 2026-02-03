import { defineStore } from "pinia"
import { ref, type Ref } from 'vue'
import { Core } from '@walletconnect/core'
import { WalletKit, type WalletKitTypes, type IWalletKit } from '@reown/walletkit'
import type { SessionTypes } from '@walletconnect/types'
import { convert, NetworkType, type Wallet, type HDWallet, type TestNetHDWallet } from "mainnet-js";
import type { WalletType } from "src/interfaces/interfaces"
import {
  hexToBin,
  binToHex,
  sha256,
  secp256k1,
  encodeLockingBytecodeP2pkh,
  decodeTransaction
} from "@bitauth/libauth"
import { getSdkError } from '@walletconnect/utils';
import { parseExtendedJson } from 'src/utils/utils'
import alertDialog from 'src/components/general/alertDialog.vue'
import { Dialog, Notify } from "quasar";
import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
import type { WcSignMessageRequest, WcSignTransactionRequest } from "@bch-wc2/interfaces"
import { useSettingsStore } from 'src/stores/settingsStore';
import { createSignedWcTransaction } from "src/utils/wcSigning"
import WC2SessionRequestDialog from "src/components/walletconnect/WC2SessionRequestDialog.vue"
import WC2AddressSelectDialog from "src/components/walletconnect/WC2AddressSelectDialog.vue"
import { displayAndLogError } from "src/utils/errorHandling"
import { WcMessageObjSchema, EncodedWcTransactionObjSchema } from "src/utils/zodValidation"
import { walletConnectProjectId, walletConnectMetadata } from "./constants"
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
const settingsStore = useSettingsStore()

// Type for tracking pending request dialogs
type PendingRequest = {
  topic: string;
  event: WalletKitTypes.SessionRequest;
  dialogHandle: ReturnType<typeof Dialog.create>;
}

// NOTE: We use a wrapper so that we can pass in the MainnetJs Wallet as an argument.
//       This keeps the mutable state more managable in the sense that WC cannot exist without a valid wallet.
// Passing in a Ref so it remains reactive (like when changing wallets)
export const useWalletconnectStore = (wallet: Ref<WalletType>) => {
  const store = defineStore("walletconnectStore", () => {
    const activeSessions = ref(undefined as undefined | Record<string, SessionTypes.Struct>);
    const web3wallet = ref(undefined as undefined | IWalletKit);

    // Store a state variable to make sure we don't call "initweb3wallet" more than once.
    const isIninialized = ref(false);

    // Track pending request dialogs so they can be cancelled by dapp
    const pendingRequests = ref(new Map<number, PendingRequest>());
    let cancellationPollingInterval: ReturnType<typeof setInterval> | null = null;

    function removePendingRequest(id: number) {
      pendingRequests.value.delete(id);
      // Stop polling when no more pending requests
      if (pendingRequests.value.size === 0 && cancellationPollingInterval) {
        clearInterval(cancellationPollingInterval);
        cancellationPollingInterval = null;
        console.log("Stopped cancel request polling");
      }
    }

    async function cancelPendingRequestsForTopic(topic: string): Promise<number[]> {
      if (!web3wallet.value) return [];
      const cancelledIds: number[] = [];
      for (const [requestId, pending] of pendingRequests.value) {
        if (pending.topic === topic) {
          console.log("Hiding dialog for request:", requestId);
          pending.dialogHandle.hide();
          const cancelResponse = { id: requestId, jsonrpc: '2.0', error: { code: 4001, message: 'Request cancelled by dapp' } };
          await web3wallet.value.respondSessionRequest({ topic, response: cancelResponse });
          cancelledIds.push(requestId);
        }
      }
      for (const requestId of cancelledIds) {
        removePendingRequest(requestId);
      }
      return cancelledIds;
    }

    async function initweb3wallet() {
      // Make sure we don't ininialize WC more than once.
      // Otherwise, we'll register multiple handlers and end up with multiple dialogs.
      if (isIninialized.value) return;

      const core = new Core({
        projectId: walletConnectProjectId
      });

      const newweb3wallet = await WalletKit.init({
        // @ts-ignore: it complains about not having a 'relayUrl' property but it is not needed
        core,
        metadata: walletConnectMetadata
      })

      // web3wallet listeners expect synchronous callbacks, this means the promise is fire-and-forget
      newweb3wallet.on('session_proposal', (sessionProposal) =>
        void wcSessionProposal(sessionProposal).catch(console.error)
      );
      newweb3wallet.on('session_request', (event) => {
        const sessionAddresses = getSessionAddresses(event.topic);
        const walletAddress = sessionAddresses[0] ?? wallet.value.getDepositAddress();
        void wcRequest(event, walletAddress, sessionAddresses).catch(console.error);
      });
      newweb3wallet.on('session_delete', ({ topic }) => {
        try {
          console.debug("Session deleted by dapp:", topic);
          settingsStore.clearAutoApproveState(topic);
          activeSessions.value = newweb3wallet.getActiveSessions();
        } catch (error) {
          console.error("Error when processing walletConnect session_delete event:", error);
        }
      });

      web3wallet.value = newweb3wallet
      activeSessions.value = web3wallet.value.getActiveSessions();

      // Set our state variable so we don't initialize it again when switching networks.
      isIninialized.value = true;
    }

    async function wcSessionProposal(sessionProposal: WalletKitTypes.SessionProposal) {
      const namespaces = getNamespaces(sessionProposal)

      if (!namespaces.bch) {
        Notify.create({
          message: t('walletConnect.errors.unsupportedBlockchain', { chains: Object.keys(namespaces).join(", ") }),
          icon: 'warning',
          color: "red"
        })
        return;
      }
      const dappNetworkPrefix = namespaces.bch?.chains?.[0]?.split(":")[1];
      const dappTargetNetwork = dappNetworkPrefix == "bitcoincash" ? "mainnet" : "chipnet";

      const currentNetwork = wallet.value.network == NetworkType.Mainnet ? "mainnet" : "chipnet"
      if (currentNetwork != dappTargetNetwork) {
        Dialog.create({
          message: t('cashConnect.notifications.networkMismatch', { network: dappTargetNetwork }),
          ok: { label: 'OK', color: 'primary', unelevated: true },
          class: 'flex justify-center',
        })
        return;
      }

      const activeWalletName = localStorage.getItem('activeWalletName') ?? '';
      const isHD = settingsStore.getWalletType(activeWalletName) === 'hd';

      if (isHD) {
        return await new Promise<void>((resolve, reject) => {
          Dialog.create({
            component: WC2AddressSelectDialog,
            componentProps: {
              sessionProposalWC: sessionProposal,
            },
          })
            .onOk((selectedAddresses: string[]) => {
              void approveSession(sessionProposal, dappTargetNetwork, selectedAddresses)
                .then(resolve)
                .catch((error) => {
                  console.error('Failed to approve session:', error)
                  Notify.create({ type: 'negative', message: t('walletConnect.errors.failedToApproveSession') })
                  reject()
                })
            })
            .onCancel(() => void rejectSession(sessionProposal).then(reject))
        });
      }

      return await new Promise<void>((resolve, reject) => {
        Dialog.create({
          component: WC2SessionRequestDialog,
          componentProps: {
            sessionProposalWC: sessionProposal,
          },
        })
        // Dialog listeners expect synchronous callbacks, this means the promise is fire-and-forget
        // For this we use promise chaining instead of async/await to keep the code more readable
          .onOk(() => {
            void approveSession(sessionProposal, dappTargetNetwork)
              .then(resolve)
              .catch((error) => {
                console.error('Failed to approve session:', error)
                Notify.create({ type: 'negative', message: t('walletConnect.errors.failedToApproveSession') })
                reject()
              })
          })
          .onCancel(() => void rejectSession(sessionProposal).then(reject))
      });
  }

    async function approveSession(
      sessionProposal: WalletKitTypes.SessionProposal,
      dappTargetNetwork: "mainnet" | "chipnet",
      selectedAddresses?: string[]
    ){
      const newWcAddress = wallet.value.getDepositAddress();
      const wcAccounts = selectedAddresses?.length ? selectedAddresses.map(addr => `bch:${addr}`) : [`bch:${newWcAddress}`]
      const namespaces = {
        bch: {
          methods: [
            "bch_getAddresses",
            "bch_signTransaction",
            "bch_signMessage",
            "bch_cancelPendingRequests"
          ],
          chains: dappTargetNetwork === "mainnet" ? ["bch:bitcoincash"] : ["bch:bchtest"],
          events: [ "addressesChanged" ],
          accounts: wcAccounts,
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

    // Read the connected addresses from a session's namespaces
    function getSessionAddresses(topic: string): string[] {
      const sessions = web3wallet.value?.getActiveSessions();
      const accounts = sessions?.[topic]?.namespaces?.bch?.accounts;
      if (!accounts?.length) return [];
      // account format is "bch:bitcoincash:..." or "bch:bchtest:...", strip the first "bch:" prefix
      return accounts.map(account => account.substring(4));
    }

    // Read the first connected address (used for signing)
    function getSessionAddress(topic: string): string | undefined {
      return getSessionAddresses(topic)[0];
    }

    // Get signing key material for the session's connected address
    function getSessionSigningInfo(topic: string) {
      const activeWalletName = localStorage.getItem('activeWalletName') ?? '';
      const isHD = settingsStore.getWalletType(activeWalletName) === 'hd';

      if (isHD) {
        const sessionAddress = getSessionAddress(topic);
        if (!sessionAddress) throw new Error(t('walletConnect.errors.noAddressForSession'));
        const hdWallet = wallet.value as HDWallet | TestNetHDWallet;
        const cacheEntry = hdWallet.walletCache.get(sessionAddress);
        if (!cacheEntry) throw new Error(t('walletConnect.errors.addressNotInHdCache', { address: sessionAddress }));
        if (!cacheEntry.privateKey) throw new Error(t('walletConnect.errors.noPrivateKeyForAddress'));
        const pubkeyCompressed = secp256k1.compressPublicKey(cacheEntry.publicKey);
        if (typeof pubkeyCompressed === 'string') throw new Error(t('walletConnect.errors.failedToCompressPublicKey'));
        return {
          privateKey: cacheEntry.privateKey,
          pubkeyCompressed,
          publicKeyHash: cacheEntry.publicKeyHash,
        };
      }

      const singleAddrWallet = wallet.value as Wallet;
      return {
        privateKey: singleAddrWallet.privateKey,
        pubkeyCompressed: singleAddrWallet.publicKeyCompressed!,
        publicKeyHash: singleAddrWallet.publicKeyHash,
      };
    }

    // Poll for queued cancel requests that bypass the normal event queue
    function startCancelPolling() {
      if (cancellationPollingInterval) return; // Already polling
      console.log("Started cancel request polling");
      cancellationPollingInterval = setInterval(() => {
        void checkForCancelRequests();
      }, 500); // Poll every 500ms
    }

    async function checkForCancelRequests() {
      if (!web3wallet.value || pendingRequests.value.size === 0) return;
      try {
        const queuedRequests = web3wallet.value.getPendingSessionRequests();

        for (const request of queuedRequests) {
          if (request.params.request.method === 'bch_cancelPendingRequests') {
            console.log("Found queued cancel request via polling, processing...");
            const { topic, id } = request;
            const cancelledIds = await cancelPendingRequestsForTopic(topic);
            const response = { id, jsonrpc: '2.0', result: { cancelledCount: cancelledIds.length } };
            await web3wallet.value.respondSessionRequest({ topic, response });
            console.log("Polling: cancel request processed, cancelled:", cancelledIds);
          }
        }
      } catch (e) {
        console.error("Error polling for cancel requests:", e);
      }
    }

    // Wallet connect dialog functionality
    async function wcRequest(event: WalletKitTypes.SessionRequest, walletAddress: string, sessionAddresses?: string[]) {
      if(!web3wallet.value) throw new Error("No web3wallet initialized")
      const { topic, params, id } = event;
      const { request } = params;
      const method = request.method;

      switch (method) {
        case "bch_getAddresses":
        case "bch_getAccounts": {
          const result = sessionAddresses?.length ? sessionAddresses : [walletAddress];
          const response = { id, jsonrpc: '2.0', result };
          await web3wallet.value.respondSessionRequest({ topic, response });
        }
          break;
        case "bch_signMessage":
        case "personal_sign": {
          const sessions = web3wallet.value.getActiveSessions();
          const session = sessions[topic];
          if (!session) return;
          const dappMetadata = session.peer.metadata;
          const validOrErrorMessage = isValidSignMessageRequest(event);
          if (typeof validOrErrorMessage === "string") {
            const errorMessage = validOrErrorMessage
            // respond with error to dapp
            const wcErrorMessage = 'Message signing request aborted with error: ' + errorMessage;
            const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
            await web3wallet.value?.respondSessionRequest({ topic, response });
            return
          }
          return await new Promise<void>((resolve, reject) => {
            const dialogHandle = Dialog.create({
              component: WC2SignMessageRequest,
              componentProps: {
                dappMetadata,
                signMessageRequestWC: event
              },
            })
            // Dialog listeners expect synchronous callbacks, this means the promise is fire-and-forget
              .onOk(() => {
                removePendingRequest(id);
                void signMessage(event).then(() => {
                  Notify.create({
                    color: "positive",
                    message: t('walletConnect.notifications.successfullySignedMessage'),
                  });
                  resolve();
                }).catch((error) => {
                  console.error('Failed to sign message:', error);
                  Notify.create({
                    color: "negative",
                    message: error instanceof Error ? error.message : t('walletConnect.notifications.failedToSignMessage'),
                  });
                  void rejectRequest(event);
                  reject(error);
                });
              })
              .onCancel(() => {
                removePendingRequest(id);
                void rejectRequest(event).then(reject);
              })
              .onDismiss(() => {
                removePendingRequest(id);
                reject();
              });
            pendingRequests.value.set(id, { topic, event, dialogHandle });
            console.log("Added signMessage to pendingRequests, id:", id, "size:", pendingRequests.value.size);
            startCancelPolling();
          });
        }
        case "bch_signTransaction": {
          const sessions = web3wallet.value.getActiveSessions();
          const session = sessions[topic];
          if (!session) return;

          const validOrErrorMessage = isValidSignTransactionRequest(event);
          if(typeof validOrErrorMessage === "string"){
            const errorMessage = validOrErrorMessage
            // respond with error to dapp
            const wcErrorMessage = 'Transaction signing request aborted with error: ' + errorMessage;
            const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
            await web3wallet.value?.respondSessionRequest({ topic, response });
          }

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
            const dialogHandle = Dialog.create({
              component: WC2TransactionRequest,
              componentProps: {
                dappMetadata,
                transactionRequestWC: event,
                exchangeRate
              },
            })
            // Dialog listeners expect synchronous callbacks, this means the promise is fire-and-forget
              .onOk(() => {
                removePendingRequest(id);
                void signTransactionWC(event).then(resolve);
              })
              .onCancel(() => {
                removePendingRequest(id);
                void rejectRequest(event).then(reject);
              })
              .onDismiss(() => {
                removePendingRequest(id);
                reject();
              });
            pendingRequests.value.set(id, { topic, event, dialogHandle });
            console.log("Added signTransaction to pendingRequests, id:", id, "size:", pendingRequests.value.size);
            startCancelPolling();
          });
        }
        case "bch_cancelPendingRequests": {
          console.log("bch_cancelPendingRequests received, pendingRequests:", pendingRequests.value.size);
          const cancelledIds = await cancelPendingRequestsForTopic(topic);
          const response = { id, jsonrpc: '2.0', result: { cancelledCount: cancelledIds.length } };
          console.log("bch_cancelPendingRequests done, cancelled:", cancelledIds);
          await web3wallet.value.respondSessionRequest({ topic, response });
          break;
        }
        default:{
          const response = { id, jsonrpc: '2.0', error: {code: 1001, message: `Unsupported method ${method}`} };
          await web3wallet.value.respondSessionRequest({ topic, response });
        }
      }
    }

    function isValidSignTransactionRequest(transactionRequestWC: WalletKitTypes.SessionRequest) {
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
        const userFacingError = t('walletConnect.errors.invalidTransactionSchema')
        displayAndLogError(userFacingError);
        if(error instanceof Error) console.error(error.message)
        const returnError = error instanceof Error ? error.message : userFacingError
        return returnError
      }
    }

    async function signTransactionWC(transactionRequestWC: WalletKitTypes.SessionRequest) {
      // isValidSignTransactionRequest has checked the params already when this function is called
      const wcSignTransactionParams = transactionRequestWC.params.request.params
      // parse as extended JSON to handle Uint8Array and BigInt
      const wcTransactionObj = parseExtendedJson(JSON.stringify(wcSignTransactionParams)) as WcSignTransactionRequest;

      const { id, topic } = transactionRequestWC;
      const { privateKey, pubkeyCompressed, publicKeyHash } = getSessionSigningInfo(topic);
      const walletLockingBytecode = encodeLockingBytecodeP2pkh(publicKeyHash);
      const walletLockingBytecodeHex = binToHex(walletLockingBytecode);
      const encodedTransaction = createSignedWcTransaction(
        wcTransactionObj, { privateKey, pubkeyCompressed }, walletLockingBytecodeHex
      );

      const hash = binToHex(sha256.hash(sha256.hash(encodedTransaction)).reverse());
      const signedTxObject = { signedTransaction: binToHex(encodedTransaction), signedTransactionHash: hash };

      // send transaction
      if (wcTransactionObj.broadcast) {
        try{
          Notify.create({
            spinner: true,
            message: t('walletConnect.notifications.sendingTransaction'),
            color: 'grey-5',
            timeout: 750
          })
          const txId = await wallet.value.submitTransaction(hexToBin(signedTxObject.signedTransaction));
          const alertMessage = t('walletConnect.notifications.sentTransaction', { userPrompt: wcTransactionObj.userPrompt })
          Dialog.create({
            component: alertDialog,
            componentProps: {
              alertInfo: { message: alertMessage, txid: txId }
            }
          })
        } catch(error){
          displayAndLogError(error);
          const errorMessage = typeof error == 'string' ? error :((error instanceof Error)? error.message : t('walletConnect.errors.errorSendingTransaction'))
          // respond with error to dapp
          const wcErrorMessage = t('walletConnect.errors.transactionFailedToSend', { error: errorMessage });
          const response = { id, jsonrpc: '2.0', result: undefined , error: { message : wcErrorMessage } };
          await web3wallet.value?.respondSessionRequest({ topic, response });
          return
        }
      }
      const response = { id, jsonrpc: '2.0', result: signedTxObject };
      await web3wallet.value?.respondSessionRequest({ topic, response });

      const message = wcTransactionObj.broadcast
        ? t('walletConnect.notifications.transactionSent')
        : t('walletConnect.notifications.transactionSigned')
      Notify.create({
        type: 'positive',
        message
      })
    }

    function isValidSignMessageRequest(signMessageRequestWC: WalletKitTypes.SessionRequest) {
      try{
        // payload sent by the dapp over walletconnect
        const wcSignMessageParams = signMessageRequestWC.params.request.params

        // the wcSignMessageParams is from an untrusted source, so perform basic validation
        WcMessageObjSchema.parse(wcSignMessageParams);
        return true
      } catch (error) {
        const userFacingError = t('walletConnect.errors.invalidSignMessageSchema')
        displayAndLogError(userFacingError);
        if(error instanceof Error) console.error(error.message)
        const returnError = error instanceof Error ? error.message : userFacingError
        return returnError
      }
    }

    async function signMessage(signMessageRequestWC: WalletKitTypes.SessionRequest){
      // isValidSignMessageRequest has checked the params already when this function is called
      const wcSignMessageParams = signMessageRequestWC.params.request.params as WcSignMessageRequest
      const message = wcSignMessageParams.message;
      const { id, topic } = signMessageRequestWC;

      // Get the address connected to this session and resolve the correct private key
      const activeWalletName = localStorage.getItem('activeWalletName') ?? '';
      const isHD = settingsStore.getWalletType(activeWalletName) === 'hd';

      let signingKey: Uint8Array | undefined;
      if (isHD) {
        const sessionAddress = getSessionAddress(topic);
        if (!sessionAddress) throw new Error(t('walletConnect.errors.noAddressForSession'));
        const hdWallet = wallet.value as HDWallet | TestNetHDWallet;
        const cacheEntry = hdWallet.walletCache.get(sessionAddress);
        if (!cacheEntry) throw new Error(t('walletConnect.errors.addressNotInHdCache', { address: sessionAddress }));
        if (!cacheEntry.privateKey) throw new Error(t('walletConnect.errors.noPrivateKeyForAddress'));
        signingKey = cacheEntry.privateKey;
      }

      const signedMessage = wallet.value.sign(message, signingKey);

      const response = { id, jsonrpc: '2.0', result: signedMessage.signature };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    async function rejectSession(wcSessionProposal: WalletKitTypes.SessionProposal){
      await web3wallet.value?.rejectSession({
        id: wcSessionProposal.id,
        reason: getSdkError('USER_REJECTED'),
      });
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

function getNamespaces(sessionProposal: WalletKitTypes.SessionProposal) {
  const { requiredNamespaces, optionalNamespaces } = sessionProposal.params;
  // merge requiredNamespaces & optionalNamespaces into a single object
  const namespaces = Object.assign({}, requiredNamespaces, optionalNamespaces);
  return namespaces
}
