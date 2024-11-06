import { ref, Ref } from "vue";
import { defineStore } from "pinia";
import { Dialog, Notify } from "quasar";

// Components.
import CCSessionProposalDialogVue from "src/components/cashconnect/CCSessionProposalDialog.vue";
import CCSignTransactionDialogVue from "src/components/cashconnect/CCSignTransactionDialog.vue";
import CCErrorDialogVue from "src/components/cashconnect/CCErrorDialog.vue";

// Import Mainnet and Wallet Connect
import { convert, TestNetWallet, Wallet } from "mainnet-js";
import {
  type BchSession,
  type BchSessionProposal,
  type RpcRequestResponse,
  type WalletProperties,
  type Unspent,
  CashConnectWallet,
} from "cashconnect";

// Import Libauth.
import {
  type Output,
  binToHex,
  hexToBin,
  cashAddressToLockingBytecode,
  walletTemplateP2pkhNonHd,
} from "@bitauth/libauth";
import { useSettingsStore } from 'src/stores/settingsStore';
const settingsStore = useSettingsStore()

// NOTE: We use a wrapper so that we can pass in the Mainnet Wallet as an argument.
//       This keeps the mutable state more managable in the sense that CC cannot exist without a valid wallet.
// Passing in a Ref so it remains reactive (like when changing networks)
export const useCashconnectStore = async (wallet: Ref<Wallet | TestNetWallet>) => {
  const store = defineStore("cashconnectStore", () => {
    
    // Store a state variable to make sure we don't call "start" more than once.
    const isStarted = ref(false);

    // Ensure that the Mainnet Wallet has a Private Key.
    if (!wallet.value.privateKey) {
      throw new Error(
        "Failed to create store: Mainnet wallet.privateKey is undefined"
      );
    }

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
          url: "cashonize.com/",
          icons: ["https://cashonize.com/images/favicon.ico"],
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
        // CashRPC Callbacks.
        {
          // Network-related callbacks.
          network: {
            getSourceOutput,
          },
          wallet: {
            getUnspents,
            getChangeTemplate,
          },
        }
      )
    );

    async function start() {
      // Make sure we don't start CC more than once.
      // Otherwise, we'll register multiple handlers and end up with multiple dialgos.
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

    async function onSessionsUpdated(
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
        sessionProposal.params.requiredNamespaces.bch.chains?.[0].replace(
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
              // NOTE: We return the methods that are auto-approved to the Dapp so that it knows it doesn't have to display a user prompt for them.
              autoApprove: autoApprovedMethods,
            });
            Notify.create({
              color: "positive",
              message: "Session approved",
            });
          })
          .onCancel(() => {
            reject();
          })
          .onDismiss(() => {
            reject();
          });
      });
    }

    async function onSessionDelete() {
      console.log("Session deleted");
    }

    async function onRPCRequest(
      session: BchSession,
      request: RpcRequestResponse["request"],
      response: RpcRequestResponse["response"]
    ): Promise<void> {
      // If this is not a request that should be auto-approved...
      if (!autoApprovedMethods.includes(request.method)) {
        // Handle bch_signTransaction_V0.
        if (request.method === "bch_signTransaction_V0") {
          const exchangeRate = await convert(1, "bch", settingsStore.currency);
          return await new Promise<void>((resolve, reject) => {
            Dialog.create({
              component: CCSignTransactionDialogVue,
              componentProps: {
                session,
                params: request.params,
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
              .onCancel(() => {
                reject();
              })
              .onDismiss(() => {
                reject();
              });
          });
        }
      }
    }

    async function onError(error: Error): Promise<void> {
      return await new Promise<void>((resolve) => {
        Dialog.create({
          component: CCErrorDialogVue,
          componentProps: {
            error,
          },
        }).onDismiss(() => {
          resolve();
        });
      });
    }

    //-----------------------------------------------------------------------------
    // Network/Wallet Hooks
    //-----------------------------------------------------------------------------

    async function getSourceOutput(
      outpointTransactionHash: Uint8Array,
      outpointIndex: number
    ): Promise<Output> {
      if (!wallet.value.provider) throw new Error("Wallet Provider is undefined");

      // wait for electrum to be initialized to avoid race-conditions
      if (document.visibilityState === 'visible') {
        try {
          await wallet.value.provider.connect();
        } catch (error) {
          console.error('Failed to reconnect:', error);
        }
      }
      const transaction = await wallet.value.provider.getRawTransactionObject(
        binToHex(outpointTransactionHash)
      );

      const outpoint = transaction.vout[outpointIndex];

      let token;

      if (outpoint.tokenData) {
        token = {
          amount: BigInt(outpoint.tokenData.amount),
          category: hexToBin(outpoint.tokenData.category),
          capability: outpoint.tokenData?.nft?.capability,
          commitment: outpoint.tokenData?.nft?.commitment
            ? hexToBin(outpoint.tokenData.nft.commitment)
            : undefined,
        };
      }

      const formatted = {
        valueSatoshis: BigInt(Math.round(outpoint.value * 100_000_000)),
        lockingBytecode: hexToBin(outpoint.scriptPubKey.hex),
        token,
      };

      return formatted;
    }

    async function getUnspents(): Promise<Array<Unspent>> {
      if (!wallet.value.cashaddr) throw new Error('Wallet "cashaddr" is not available.');
      if (!wallet.value.provider) throw new Error("Wallet Provider is undefined");

      // wait for electrum to be initialized to avoid race-conditions
      if (document.visibilityState === 'visible') {
        try {
          await wallet.value.provider.connect();
        } catch (error) {
          console.error('Failed to reconnect:', error);
        }
      }
      
      const utxos = await wallet.value.getUtxos();

      const lockingBytecode = cashAddressToLockingBytecode(wallet.value.cashaddr);

      if (typeof lockingBytecode === "string") {
        throw new Error("Failed to convert CashAddr to Locking Bytecode");
      }

      const transformed = utxos.map((utxo) => {
        let token: Output["token"] | undefined = undefined;

        if (utxo.token) {
          token = {
            amount: BigInt(utxo.token.amount),
            category: hexToBin(utxo.token.tokenId),
          };

          if (utxo.token?.capability || utxo.token?.commitment) {
            token.nft = {
              capability: utxo.token.capability || "none",
              commitment: hexToBin(utxo.token.commitment || ""),
            };
          }
        }

        return {
          outpointTransactionHash: hexToBin(utxo.txid),
          outpointIndex: utxo.vout,
          sequenceNumber: 0,
          lockingBytecode: lockingBytecode.bytecode,
          unlockingBytecode: {
            template: walletTemplateP2pkhNonHd,
            valueSatoshis: BigInt(utxo.satoshis),
            script: "unlock",
            data: {
              keys: {
                privateKeys: {
                  key: wallet.value.privateKey,
                },
              },
            },
            token,
          },
        } as Unspent;
      });

      return transformed;
    }

    async function getChangeTemplate() {
      if (!wallet.value.privateKey) {
        throw new Error(
          "Failed to getChangeTemplate: Mainnet wallet.value.value.privateKey is undefined"
        );
      }

      return {
        template: walletTemplateP2pkhNonHd,
        data: {
          keys: {
            privateKeys: {
              key: wallet.value.privateKey,
            },
          },
        },
      };
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
