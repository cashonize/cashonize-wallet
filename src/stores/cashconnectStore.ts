import { type Ref, ref } from "vue";
import { defineStore } from "pinia";
import { Dialog, Notify } from "quasar";

// Components.
import CCSessionProposalDialogVue from "src/components/cashconnect/CCSessionProposalDialog.vue";
import CCSignTransactionDialogVue from "src/components/cashconnect/CCSignTransactionDialog.vue";
import CCErrorDialogVue from "src/components/cashconnect/CCErrorDialog.vue";

// Import MainnetJs and CashConnect
import { convert, type Wallet, type TestNetWallet } from "mainnet-js";
import {
  type BchSession,
  type BchSessionProposal,
  type ChangeTemplateDirective,
  type Payloads,
  type SpendableUTXO,
  type WalletProperties,
  CashConnectWallet,
} from "cashconnect";

// Import Libauth.
import {
  type Output,
  binToHex,
  hexToBin,
  cashAddressToLockingBytecode,
  walletTemplateP2pkhNonHd,
  walletTemplateToCompilerBch,
} from "@bitauth/libauth";
import { useSettingsStore } from 'src/stores/settingsStore';
import { type ElectrumRawTransactionVout } from "src/interfaces/interfaces";
const settingsStore = useSettingsStore()

// NOTE: We use a wrapper so that we can pass in the MainnetJs Wallet as an argument.
//       This keeps the mutable state more managable in the sense that CC cannot exist without a valid wallet.
// Passing in a Ref so it remains reactive (like when changing networks)
export const useCashconnectStore = (wallet: Ref<Wallet | TestNetWallet>) => {
  const store = defineStore("cashconnectStore", () => {

    // Store a state variable to make sure we don't call "start" more than once.
    const isStarted = ref(false);

    // Auto-approve the following RPC methods.
    // NOTE: We hard-code these for now, but they could be customized on a per-Dapp basis in the future.
    const autoApprovedMethods = [
      "wc_authRequest",
      "bch_getTokens_V0",
      "bch_getBalance_V0",
      "bch_getChangeLockingBytecode_V0",
    ];

    // List of CashConnect sessions.
    // NOTE: This reactive state is synced with CashConnect via the onSessionsUpdated hook.
    const sessions = ref<Record<string, BchSession>>({});

    // The CashConnect Wallet instance.
    const cashConnectWallet = ref<CashConnectWallet>(
      new CashConnectWallet(
        // The master private key.
        wallet.value.privateKey,
        // Project ID.
        "3fd234b8e2cd0e1da4bc08a0011bbf64",
        // Metadata.
        {
          name: "Cashonize",
          description: "Cashonize BitcoinCash Web Wallet",
          url: "https://cashonize.com",
          icons: ["https://cashonize.com/icons/favicon-128x128.png"],
        },
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
    );

    async function start() {
      // Make sure we don't start CC more than once.
      // Otherwise, we'll register multiple handlers and end up with multiple dialogs.
      if (isStarted.value) return;

      // Start CashConnect (WC Core) service.
      await cashConnectWallet.value.start();

      // Set our state variable so we don't start it again when switching wallets.
      isStarted.value = true;
    }

    async function pair(wcUri: string) {
      try {
        // Pair with the service.
        await cashConnectWallet.value.pair(wcUri);
      } catch (error) {
        console.error(error);
      }
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
      // Check the network and manually prompt user to switch if incorrect.
      // TODO: we can automatically invoke changeNetwork here instead of just instructing the user with an action.

      // NOTE: The walletClass.network property appears to return quirky values (e.g. undefined).
      //       So we use the networkPrefix property to determine which chain we are currently on.
      const currentChain = wallet.value.networkPrefix;
      const targetChain =
        sessionProposal.params.optionalNamespaces?.bch?.chains?.[0]?.replace(
          "bch:",
          ""
        );

      // Cashonize expects network to be either mainnet or chipnet.
      const targetChainCashonizeFormat =
        targetChain === "bitcoincash" ? "mainnet" : "chipnet";

      // Check if the current chain is the target chain.
      if (currentChain !== targetChain) {
        throw new Error(
          `This Dapp requires wallet to be on ${targetChainCashonizeFormat}. Please navigate to settings and change network to use this Dapp.`
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
              // NOTE: We return the methods that are auto-approved to the Dapp
              // this way the dapp knows it doesn't have to display a user prompt for them.
              autoApprove: autoApprovedMethods,
            });
            Notify.create({
              color: "positive",
              message: "Session approved",
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
      debugger;

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
            component: CCSignTransactionDialogVue,
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
                message: "Successfully signed transaction",
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
      const transaction = await wallet.value.provider.getRawTransactionObject(
        binToHex(outpointTransactionHash)
      );

      // Get the outpoint.
      const outpoint = transaction.vout[outpointIndex] as ElectrumRawTransactionVout ;

      // Build the output, converting from Mainnet to LibCash.
      const output: Output = {
        valueSatoshis: BigInt(Math.round(outpoint.value * 100_000_000)),
        lockingBytecode: hexToBin(outpoint.scriptPubKey.hex),
      };

      // If a token is available, add it to the output.
      if ('tokenData' in outpoint) {
        output.token = {
          category: hexToBin(outpoint.tokenData.category),
          amount: BigInt(outpoint.tokenData.amount),
          nft: {
            capability: outpoint.tokenData?.nft?.capability || 'none',
            commitment: outpoint.tokenData?.nft?.commitment
              ? hexToBin(outpoint.tokenData.nft.commitment)
              : new Uint8Array(),
          }
        };
      }

      // Return the output.
      return output;
    }

    async function getSpendableUTXOs(): Promise<Array<SpendableUTXO>> {
      // Ensure that we are connected to the blockchain.
      await waitForBlockchainConnection();

      // Get the UTXOs belonging to this wallet.
      const walletUTXOs = await wallet.value.getUtxos();

      // Create our Libauth P2PKH Compiler for Locking/Unlocking the P2PKH Wallet.
      const compilerP2PKH = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);

      // Convert them into LibAuth Template format for use with the Tx Builder.
      const walletUTXOsTemplated = walletUTXOs.map((utxo) => ({
        outpointTransactionHash: hexToBin(utxo.txid),
        outpointIndex: utxo.vout,
        sequenceNumber: 0,
        unlockingBytecode: {
          compiler: compilerP2PKH,
          script: "unlock",
          data: {
            keys: {
              privateKeys: {
                key: wallet.value.privateKey,
              },
            },
          },
        },
        sourceOutput: {
          lockingBytecode: getWalletLockingBytecode(),
          valueSatoshis: BigInt(utxo.satoshis),
          ...(utxo.token && {
            token: {
              amount: BigInt(utxo.token.amount),
              category: hexToBin(utxo.token.tokenId),
              ...(utxo.token.capability || utxo.token.commitment) && {
                nft: {
                  capability: utxo.token.capability || "none",
                  commitment: hexToBin(utxo.token.commitment || ""),
                },
              },
            },
          }),
        }
      }));

      return walletUTXOsTemplated;
    }

    // NOTE: This is used to:
    //       1. Provide a sandbox for Consolidation TXs/Category Genesis TXs.
    //       2. Generate a <payoutLockingBytecode> placeholder variable.
    function getChangeTemplateDirective(): ChangeTemplateDirective {
      // Create a P2PKH Template.
      const compiler = walletTemplateToCompilerBch(walletTemplateP2pkhNonHd);

      // Set the data for this template.
      const data = {
        keys: {
          privateKeys: {
            key: wallet.value.privateKey,
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
    // Helpers
    //-----------------------------------------------------------------------------

    async function waitForBlockchainConnection() {
      if (document.visibilityState === 'visible') {
        try {
          await wallet.value.provider.connect();
        } catch (error) {
          console.error('Failed to reconnect:', error);
        }
      }
    }

    function getWalletLockingBytecode() {
      // Convert the Address of the Wallet to Locking Bytecode.
      const payoutLockingBytecode = cashAddressToLockingBytecode(wallet.value.cashaddr);

      // If the Change/Payout Address could not be decoded, throw an error.
      if(typeof payoutLockingBytecode === 'string') {
        throw new Error(`Could not decode Wallet Change Address: ${payoutLockingBytecode}`);
      }

      // Return the raw locking bytecode.
      return payoutLockingBytecode.bytecode;
    }

    //-----------------------------------------------------------------------------
    // Expose
    //-----------------------------------------------------------------------------

    return {
      // Methods
      start,
      pair,

      // Properties
      cashConnectWallet,
      sessions,
    };
  })();

  return store;
};
