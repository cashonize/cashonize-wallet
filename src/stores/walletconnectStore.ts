import { defineStore } from "pinia"
import { ref } from 'vue'
import { Core } from '@walletconnect/core'
import { Web3Wallet, type Web3WalletTypes } from '@walletconnect/web3wallet'
import type Client from '@walletconnect/web3wallet'
import type { SessionTypes } from '@walletconnect/types'
import { convert, type TestNetWallet, type Wallet } from "mainnet-js";
import {
  hexToBin,
  binToHex,
  lockingBytecodeToCashAddress,
  importWalletTemplate,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBCH,
  secp256k1,
  generateTransaction,
  encodeTransaction,
  sha256,
  hash256,
  SigningSerializationFlag,
  generateSigningSerializationBCH,
  type TransactionTemplateFixed,
  type CompilationContextBCH,
  type TransactionCommon,
  type Input,
  type Output
} from "@bitauth/libauth"
import { getSdkError } from '@walletconnect/utils';
import { parseExtendedJson } from 'src/utils/utils'
import alertDialog from 'src/components/alertDialog.vue'
import { Dialog, Notify } from "quasar";
import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue';
import WC2SignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
import { ContractInfo } from "src/interfaces/wcInterfaces"
import { useSettingsStore } from 'src/stores/settingsStore';
const settingsStore = useSettingsStore()

// NOTE: We use a wrapper so that we can pass in the Mainnet Wallet as an argument.
export const useWalletconnectStore = async (wallet: Wallet | TestNetWallet) => {
  const store = defineStore("walletconnectStore", () => {
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

    const toCashaddr = (lockingBytecode:Uint8Array) => {
      const prefix = wallet.network == "mainnet" ? "bitcoincash" : "bchtest";
      // check for opreturn
      if(binToHex(lockingBytecode).startsWith("6a")) return "opreturn:" +  binToHex(lockingBytecode)
      const result = lockingBytecodeToCashAddress(lockingBytecode,prefix);
      if (typeof result !== "string") throw result;
      return result;
    }

    async function signTransactionWC(transactionRequestWC: any) {
      // parse params from transactionRequestWC
      const requestParams = parseExtendedJson(JSON.stringify(transactionRequestWC.params.request.params));
      const txDetails:TransactionCommon = requestParams.transaction;
      const sourceOutputs = requestParams.sourceOutputs as (Input & Output & ContractInfo)[]

      const privateKey = wallet?.privateKey;
      const pubkeyCompressed = wallet?.publicKeyCompressed
      if(!privateKey || !pubkeyCompressed) return

      // prepare libauth template for input signing
      const template = importWalletTemplate(walletTemplateP2pkhNonHd);
      if (typeof template === "string") throw new Error("Transaction template error");

      // configure compiler
      const compiler = walletTemplateToCompilerBCH(template);

      const txTemplate = {...txDetails} as TransactionTemplateFixed<typeof compiler>;

      for (const [index, input] of txTemplate.inputs.entries()) {
        const sourceOutputsUnpacked = sourceOutputs;
        if (sourceOutputsUnpacked[index].contract?.artifact.contractName) {
          // instruct compiler to produce signatures for relevant contract inputs

          // replace pubkey and sig placeholders
          let unlockingBytecodeHex = binToHex(sourceOutputsUnpacked[index].unlockingBytecode);
          const sigPlaceholder = "41" + binToHex(Uint8Array.from(Array(65)));
          const pubkeyPlaceholder = "21" + binToHex(Uint8Array.from(Array(33)));
          if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
            // compute the signature argument
            const hashType = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
            const context: CompilationContextBCH = { inputIndex: index, sourceOutputs: sourceOutputsUnpacked, transaction: txDetails };
            const signingSerializationType = new Uint8Array([hashType]);

            const coveredBytecode = sourceOutputsUnpacked[index].contract?.redeemScript;
            if (!coveredBytecode) {
              alert("Not enough information provided, please include contract redeemScript");
              return;
            }
            const sighashPreimage = generateSigningSerializationBCH(context, { coveredBytecode, signingSerializationType });
            const sighash = hash256(sighashPreimage);
            const signature = secp256k1.signMessageHashSchnorr(privateKey, sighash);
            if (typeof signature === "string") {
              alert(signature);
              return;
            }
            const sig = Uint8Array.from([...signature, hashType]);

            unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, "41" + binToHex(sig));
          }
          if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
            unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, "21" + binToHex(pubkeyCompressed));
          }

          input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
        } else {
          // replace unlocking bytecode for non-contract inputs having placeholder unlocking bytecode
          const sourceOutput = sourceOutputsUnpacked[index];
          if (!sourceOutput.unlockingBytecode?.length && toCashaddr(sourceOutput.lockingBytecode) === wallet?.getDepositAddress()) {
            input.unlockingBytecode = {
              compiler,
              data: {
                keys: { privateKeys: { key: privateKey } },
              },
              valueSatoshis: sourceOutput.valueSatoshis,
              script: "unlock",
              token: sourceOutput.token,
            }
          }
        }
      };

      // generate and encode transaction
      const generated = generateTransaction(txTemplate);
      if (!generated.success) throw Error(JSON.stringify(generated.errors, null, 2));

      const encoded = encodeTransaction(generated.transaction);
      const hash = binToHex(sha256.hash(sha256.hash(encoded)).reverse());
      const signedTxObject = { signedTransaction: binToHex(encoded), signedTransactionHash: hash };

      // send transaction
      const { id, topic } = transactionRequestWC;
      const response = { id, jsonrpc: '2.0', result: signedTxObject };
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
              alertInfo: { message: alertMessage, txid: txId as string } 
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
      await web3wallet.value?.respondSessionRequest({ topic, response });

      const message = requestParams.broadcast ? 'Transaction succesfully sent!' : 'Transaction succesfully signed!'
      Notify.create({
        type: 'positive',
        message
      })
    }

    async function signMessage(signMessageRequestWC: any){
      const requestParams = signMessageRequestWC.params.request.params
      const message = requestParams?.message;
      const signedMessage = await wallet?.sign(message);

      const { id, topic } = signMessageRequestWC;
      const response = { id, jsonrpc: '2.0', result: signedMessage?.signature };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    async function rejectRequest(wcRequest: any){
      const { id, topic } = wcRequest;
      const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
      await web3wallet.value?.respondSessionRequest({ topic, response });
    }

    return { web3wallet, activeSessions, initweb3wallet, wcRequest }
  
  })();

  return store;
}