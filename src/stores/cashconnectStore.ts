import { ref, type Ref } from "vue";
import { defineStore } from "pinia";
import { Dialog, Notify } from "quasar";

// Components.
import CCSessionProposalDialogVue from "src/components/cashconnect/CCSessionProposalDialog.vue";
import CCSignTransactionDialogVue from "src/components/cashconnect/CCSignTransactionDialog.vue";
import CCErrorDialogVue from "src/components/cashconnect/CCErrorDialog.vue";

// Import MainnetJs and CashConnect
import { convert } from "mainnet-js";
import type { WalletType } from "src/interfaces/interfaces"
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global
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
  deriveHdPath,
  deriveSeedFromBip39Mnemonic,
  deriveHdPrivateNodeFromSeed,
  walletTemplateP2pkhNonHd,
} from "@bitauth/libauth";
import { useSettingsStore } from 'src/stores/settingsStore';
import { type ElectrumRawTransactionVout } from "src/interfaces/interfaces";
import { walletConnectProjectId, walletConnectMetadata } from "./constants";
const settingsStore = useSettingsStore()

// NOTE: We use a wrapper so that we can pass in the MainnetJs Wallet as an argument.
//       This keeps the mutable state more managable in the sense that CC cannot exist without a valid wallet.
// Passing in a Ref so it remains reactive (like when changing wallets)
export const useCashconnectStore = (wallet: Ref<WalletType>) => {
  const store = defineStore("cashconnectStore", () => {
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
    const cashConnectWallet = ref<CashConnectWallet | undefined>();

    async function start() {
      // Make sure we don't start CC more than once.
      // Otherwise, we'll register multiple handlers and end up with multiple dialogs.
      if (cashConnectWallet.value) {
        return;
      }

      // Get the Master Private Key to use for CashConnect.
      const masterPrivateKey = getMasterPrivateKeyForWallet(wallet.value);

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
      const currentChain = wallet.value.networkPrefix;
      const targetChain =
        sessionProposal.params.requiredNamespaces?.bch.chains?.[0]?.replace(
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
              // NOTE: We return the methods that are auto-approved to the Dapp
              // this way the dapp knows it doesn't have to display a user prompt for them.
              autoApprove: autoApprovedMethods,
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
                  message: t('cashConnect.notifications.successfullySignedTransaction'),
                });
              })
            .onCancel(reject)
            .onDismiss(reject);
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
        }).onDismiss(resolve);
      });
    }

    //-----------------------------------------------------------------------------
    // Network/Wallet Hooks
    //-----------------------------------------------------------------------------

    async function getSourceOutput(
      outpointTransactionHash: Uint8Array,
      outpointIndex: number
    ): Promise<Output> {
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

      const outpoint = transaction.vout[outpointIndex] as ElectrumRawTransactionVout ;

      let token;

      if ('tokenData' in outpoint) {
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

      // TODO: investigate this type error
      // @ts-ignore
      return formatted;
    }

    async function getUnspents(): Promise<Array<Unspent>> {
      // wait for electrum to be initialized to avoid race-conditions
      if (document.visibilityState === 'visible') {
        try {
          await wallet.value.provider.connect();
        } catch (error) {
          console.error('Failed to reconnect:', error);
        }
      }

      // Get the UTXOs from the wallet.
      // NOTE: For Mainnet, we need to marry them up with their Private Key later using the wallet's "walletCache".
      const utxos = await wallet.value.getUtxos();

      const transformed = utxos.map((utxo) => {
        // Get the Wallet's Internal Information about this address (we need the Private Key for signing).
        const walletUTXO = wallet.value.walletCache.get(utxo.address);

        // If the Private Key cannot be retrieved, throw an error.
        if(!walletUTXO || !('privateKey' in walletUTXO)) {
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

        // Return the LibAuth Template.
        return {
          outpointTransactionHash: hexToBin(utxo.txid),
          outpointIndex: utxo.vout,
          sequenceNumber: 0,
          lockingBytecode: lockingBytecode.bytecode,
          unlockingBytecode: {
            template: walletTemplateP2pkhNonHd,
            valueSatoshis: utxo.satoshis,
            script: "unlock",
            data: {
              keys: {
                privateKeys: {
                  key: walletUTXO.privateKey,
                },
              },
            },
            token,
          },
        } as Unspent;
      });

      return transformed;
    }

    function getChangeTemplate() {
      // Get the latest deposit address.
      const changeAddress = wallet.value.getChangeAddress();

      // Get the Private Key for this Change Address.
      const walletUTXO = wallet.value.walletCache.get(changeAddress);

      // If the Private Key cannot be retrieved, throw an error.
      if(!walletUTXO || !walletUTXO.privateKey) {
        throw new Error(
          t('cashConnect.notifications.privateKeyNotFound', { address: changeAddress })
        );
      }

      // Return the Libauth Change Template.
      return {
        template: walletTemplateP2pkhNonHd,
        data: {
          keys: {
            privateKeys: {
              key: walletUTXO.privateKey,
            },
          },
        },
      };
    }

    //-----------------------------------------------------------------------------
    // Utils
    //-----------------------------------------------------------------------------

    function derivationPathToCashConnectPath(derivationPath: string, purpose = 5001) {
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

      // If this is a HD Wallet, we use
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
  })();

  return store;
};
