import { ref } from "vue";
import { defineStore } from "pinia";
import { Dialog, Notify } from "quasar";

// Components.
import CCSessionProposalDialogVue from "src/components/cashconnect/CCSessionProposalDialog.vue";
import CCExecuteActionDialogVue from "src/components/cashconnect/CCExecuteActionDialog.vue";
import CCErrorDialogVue from "src/components/cashconnect/CCErrorDialog.vue";

// Import MainnetJs and CashConnect
import { convert } from "mainnet-js";
import type { WalletType } from "src/interfaces/interfaces"
import { useStore } from "./store"
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
import {
  type BchSession,
  type BchSessionProposal,
  type Payloads,
  type SpendableUTXO,
  type WalletProperties,
} from "@cashconnect-js/core";
import {
  CashConnectWallet,
} from "@cashconnect-js/wallet";

// Import Libauth.
import {
  type Output,
  binToHex,
  hexToBin,
  cashAddressToLockingBytecode,
  deriveHdPath,
  deriveSeedFromBip39Mnemonic,
  deriveHdPrivateNodeFromSeed,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBch,
} from "@bitauth/libauth";
import { useSettingsStore } from 'src/stores/settingsStore';
import { type ElectrumRawTransactionVout } from "src/interfaces/interfaces";
import { walletConnectProjectId, walletConnectMetadata } from "./constants";
const settingsStore = useSettingsStore()

export const useCashconnectStore = defineStore("cashconnectStore", () => {
  // Accesses the wallet reactively via cross-store ref (mainStore.wallet) inside defineStore setup,
  // which Pinia resolves lazily — so the circular import with store.ts is safe.
  const mainStore = useStore();
  // List of CashConnect sessions.
  // NOTE: This reactive state is synced with CashConnect via the onSessionsUpdated hook.
  const sessions = ref<Record<string, BchSession>>({});
  // The CashConnect Wallet instance.
  const cashConnectWallet = ref<CashConnectWallet | undefined>();
  async function start() {
    // Make sure we don't start CC more than once.
    // Otherwise, we'll register multiple handlers and end up with multiple dialogs.
    if (cashConnectWallet.value) {
      return;
    }
    // Get the Master Private Key to use for CashConnect.
    const masterPrivateKey = getMasterPrivateKeyForWallet(mainStore.wallet as WalletType);
    // Instantiate CashConnect.
    cashConnectWallet.value = new CashConnectWallet(
      // The master private key for use with CashConnect.
      masterPrivateKey,
      // Project ID.
      walletConnectProjectId,
      // Metadata.
      walletConnectMetadata,
      // Event Callbacks.
      {
        // Session State Callbacks.
        onSessionsUpdated,
        onSessionProposal,
        onSessionDelete,
        onRPCRequest,
        onError,
      },
      // Execution Context Data.
      {
        // Blockchain.
        getSourceOutput,
        // Wallet.
        getSpendableUTXOs,
        getChangeTemplateDirective,
      }
    )
    // Start CashConnect (WC Core) service.
    await cashConnectWallet.value.start();
  }
  async function stop() {
    // If already stopped, do nothing.
    if(!cashConnectWallet.value) {
      return;
    }
    // NOTE: This is a bit of a work-around.
    //       When Cashonize resets wallet state, it does a fire-and-forget.
    //       This causes a race-condition whereby CashConnect hasn't finished closing connections yet.
    //       And the `start()` call thinks that the existing instance still exists.
    const cashConnectPrevInstance = cashConnectWallet.value;
    cashConnectWallet.value = undefined;
    // Stop the previous instance.
    await cashConnectPrevInstance.stop();
    // Disconnect all sessions and stop the previous instance.
    await cashConnectPrevInstance.disconnectAllSessions();
  }
  async function pair(wcUri: string) {
    if(!cashConnectWallet.value) {
      throw new Error(t('cashConnect.notifications.notStarted'));
    }
    try {
      // Pair with the service.
      await cashConnectWallet.value.pair(wcUri);
    } catch (error) {
      console.error(error);
    }
  }
  async function disconnectSession(topicId: string) {
    if(!cashConnectWallet.value) {
      return;
    }
    await cashConnectWallet.value.disconnectSession(topicId);
  }
  //-----------------------------------------------------------------------------
  // Session Hooks
  //-----------------------------------------------------------------------------
  function onSessionsUpdated(
    updatedSessions: Record<string, BchSession>
  ) {
    sessions.value = updatedSessions;
  }
  async function onSessionProposal(sessionProposal: BchSessionProposal) {
    // Check the network and prompt user to switch if incorrect.
    // NOTE: The walletClass.network property appears to return quirky values (e.g. undefined).
    //       So we use the networkPrefix property to determine which chain we are currently on.
    const currentChain = mainStore.wallet.networkPrefix;
    const targetChain =
      sessionProposal.params.optionalNamespaces?.bch?.chains?.[0]?.replace(
        "bch:",
        ""
      );
    // Cashonize expects network to be either mainnet or chipnet.
    const targetChainCashonizeFormat = targetChain === "bitcoincash" ? "mainnet" : "chipnet";
    // Check if the current chain is the target chain.
    if (currentChain !== targetChain) {
      throw new Error(
        t('cashConnect.notifications.networkMismatch', { network: targetChainCashonizeFormat })
      );
    }
    return await new Promise<WalletProperties>((resolve, reject) => {
      Dialog.create({
        component: CCSessionProposalDialogVue,
        componentProps: {
          session: sessionProposal,
        },
      })
        .onOk(() => {
          resolve({
            // TODO: May want to keep something like this.
            //       But, might want to list instruction types instead.
            autoApprove: [],
          });
          Notify.create({
            color: "positive",
            message: t('cashConnect.notifications.sessionApproved'),
          });
        })
        .onCancel(reject)
        .onDismiss(reject);
    });
  }
  function onSessionDelete() {
    console.log("Session deleted");
  }
  async function onRPCRequest(
    session: BchSession,
    request: Payloads["request"],
    response: Payloads["response"]
  ): Promise<void> {
    if(request.method === 'executeAction') {
      // If this is not a request that DOES NOT require approval...
      if (!doesActionRequireApproval(session, request.params.action)) {
        return;
      }
      // Get the BCH exchange rate.
      const exchangeRate = await convert(1, "bch", settingsStore.currency);
      // Show a dialog, prompting the user for approval.
      return await new Promise<void>((resolve, reject) => {
        Dialog.create({
          component: CCExecuteActionDialogVue,
          componentProps: {
            session,
            request: request.params,
            response,
            exchangeRate
          },
        })
          .onOk(() => {
            resolve();
            Notify.create({
              color: "positive",
              message: t('cashConnect.notifications.successfullySignedTransaction'),
            });
          })
        .onCancel(reject)
        .onDismiss(reject);
      });
    }
  }
  async function onError(error: Error): Promise<void> {
    return await new Promise<void>((resolve) => {
      Dialog.create({
        component: CCErrorDialogVue,
        componentProps: {
          error,
        },
      }).onDismiss(resolve);
    });
  }
  function doesActionRequireApproval(session: BchSession, actionName: string) {
    // Get the action being executed from the session:template.
    const action = session.sessionProperties.template.actions[actionName];
    // Check to see if it contains any instructions that should require approval.
    // NOTE: Currently, only actions involving transactions require approval.
    //       In future once we have auditing infrastructure, wallets can define their own policies.
    //       For example, if a given template is unaudited, all actions could be set to require approval.
    return action?.instructions?.some((instruction) => instruction.type === 'transaction');
  }
  //-----------------------------------------------------------------------------
  // Network/Wallet Hooks
  //-----------------------------------------------------------------------------
  async function getSourceOutput(
    outpointTransactionHash: Uint8Array,
    outpointIndex: number
  ): Promise<Output> {
    // Ensure that we are connected to the blockchain.
    await waitForBlockchainConnection();
    // Get the transaction containing this outpoint.
    const transaction = await mainStore.wallet.provider.getRawTransactionObject(
      binToHex(outpointTransactionHash)
    );
    // Get the outpoint.
    const outpoint = transaction.vout[outpointIndex] as ElectrumRawTransactionVout ;
    // Build the output, converting from Mainnet to LibAuth.
    const output: Output = {
      valueSatoshis: BigInt(Math.round(outpoint.value * 100_000_000)),
      lockingBytecode: hexToBin(outpoint.scriptPubKey.hex),
    };
    // If a token is available, add it to the output.
    if ('tokenData' in outpoint) {
      output.token = {
        category: hexToBin(outpoint.tokenData.category),
        amount: BigInt(outpoint.tokenData.amount),
        ...(outpoint.tokenData.nft) ? {
          nft: {
            capability: outpoint.tokenData?.nft.capability || 'none',
            commitment: hexToBin(outpoint.tokenData.nft.commitment || '')
          }
        } : {},
      };
    }
    // Return the output.
    return output;
  }
  async function getSpendableUTXOs(): Promise<Array<SpendableUTXO>> {
    // Wait for electrum to be initialized to avoid race-conditions
    await waitForBlockchainConnection();
    // Create our Libauth P2PKH Compiler for Locking/Unlocking the P2PKH Wallet.
    const compilerP2PKH = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);
    // Get the UTXOs from the wallet.
    // NOTE: For Mainnet, we need to marry them up with their Private Key later using the wallet's "walletCache".
    const utxos = await mainStore.wallet.getUtxos();
    const transformed = utxos.map((utxo) => {
      // Get the Wallet's Internal Information about this address (we need the Private Key for signing).
      const addressKeyPair = mainStore.wallet.walletCache.get(utxo.address);
      // If the Private Key cannot be retrieved, throw an error.
      if(!addressKeyPair || !addressKeyPair.privateKey) {
        throw new Error(
          t('cashConnect.notifications.privateKeyNotFound', { address: utxo.address })
        );
      }
      // Convert the Address of this UTXO to Locking Bytecode.
      const lockingBytecode = cashAddressToLockingBytecode(utxo.address);
      if (typeof lockingBytecode === "string") {
        throw new Error(t('cashConnect.notifications.failedToConvertCashAddr'));
      }
      // If this UTXO has a token, include it.
      let token: Output["token"] | undefined = undefined;
      if (utxo.token) {
        token = {
          amount: BigInt(utxo.token.amount),
          category: hexToBin(utxo.token.category),
        };

        if (utxo.token?.nft?.capability || utxo.token?.nft?.commitment) {
          token.nft = {
            capability: utxo.token.nft?.capability || "none",
            commitment: hexToBin(utxo.token.nft?.commitment || ""),
          };
        }
      }
      // Convert them into LibAuth Template format for use with the Tx Builder.
      return {
        outpointTransactionHash: hexToBin(utxo.txid),
        outpointIndex: utxo.vout,
        sequenceNumber: 0,
        unlockingBytecode: {
          compiler: compilerP2PKH,
          script: "unlock",
          data: {
            keys: {
              privateKeys: {
                key: addressKeyPair.privateKey,
              },
            },
          },
        },
        sourceOutput: {
          lockingBytecode: lockingBytecode.bytecode,
          valueSatoshis: BigInt(utxo.satoshis),
          ...(utxo.token && {
            token,
          }),
        }
      };
    });
    return transformed;
  }
  // NOTE: This is used to:
  //       1. Provide a sandbox for Consolidation TXs/Category Genesis TXs.
  //       2. Generate a <payoutLockingBytecode> placeholder variable.
  function getChangeTemplateDirective() {
    // Get the latest deposit address.
    const changeAddress = mainStore.wallet.getChangeAddress();
    // Get the Private Key for this Change Address.
    const addressKeyPair = mainStore.wallet.walletCache.get(changeAddress);
    // If the Private Key cannot be retrieved, throw an error.
    if(!addressKeyPair || !addressKeyPair.privateKey) {
      throw new Error(
        t('cashConnect.notifications.privateKeyNotFound', { address: changeAddress })
      );
    }
    // Create a P2PKH Template.
    const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);
    // Set the data for this template.
    const data = {
      keys: {
        privateKeys: {
          key: addressKeyPair.privateKey,
        },
      },
    };
    // Return the lock and unlock directives.
    return {
      lock: {
        compiler,
        data,
        script: 'lock',
      },
      unlock: {
        compiler,
        data,
        script: 'unlock',
      },
      fee: 1000n,
    }
  }
  //-----------------------------------------------------------------------------
  // Utils
  //-----------------------------------------------------------------------------
  async function waitForBlockchainConnection() {
    if (document.visibilityState === 'visible') {
      try {
        await mainStore.wallet.provider.connect();
      } catch (error) {
        console.error('Failed to reconnect:', error);
      }
    }
  }
  function derivationPathToCashConnectPath(derivationPath: string, purpose = 5001) {
      // Replace the "purpose" in the derivation path with "5001" (CashConnect).
      const parts = derivationPath.split('/');
      if (parts.length < 4) {
          throw new Error(
            t('cashConnect.notifications.invalidDerivationPath', { length: parts.length })
          )
      }
      parts[1] = `${purpose}'`;
      return parts.join('/');
  }
  function getMasterPrivateKeyForWallet(wallet: WalletType) {
    // If this is a single address (WIF) wallet, we just use the WIF's Private Key.
    if('privateKey' in wallet) {
      return wallet.privateKey;
    }
    // If this is a HD Wallet, we use the Wallet's Derivation Path, but replace the purpose with 5001 (CashConnect).
    if('mnemonic' in wallet) {
      // Derive the seed and HDNode from the Wallet's mnemonic.
      const seed = deriveSeedFromBip39Mnemonic(wallet.mnemonic);
      const hdNode = deriveHdPrivateNodeFromSeed(seed);
      if(!hdNode) {
        throw new Error(
          t('cashConnect.notifications.failedToDeriveHdNode')
        );
      }
      // Take the existing derivation, but set the 'purpose' to 5001 (CashConnectV1).
      // NOTE: We put CashConnect on its own derivation to improve security and keep it detached from other Wallet UTXOs.
      //       I.e. We deliberately keep CashConnect in the dark about the top-level mnemonic to enhance security.
      // NOTE: It is important we don't make assumptions (i.e. hard-code the path) here:
      //       If we do this, we could get conflicting CashConnect instances due to the "account" part of the standard derivation paths.
      const cashConnectPath = derivationPathToCashConnectPath(wallet.derivation);
      // Derive the master key for CashConnect.
      const masterKeyNode = deriveHdPath(hdNode, cashConnectPath);
      // Return the master private key.
      return masterKeyNode.privateKey;
    }
    throw new Error(
      t('cashConnect.notifications.walletTypeNotSupported')
    );
  }
  //-----------------------------------------------------------------------------
  // Expose
  //-----------------------------------------------------------------------------
  return {
    // Methods
    start,
    stop,
    pair,
    disconnectSession,
    // Properties
    cashConnectWallet,
    sessions,
  };
});
