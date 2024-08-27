import { ref } from 'vue';
import { defineStore } from 'pinia';
import { type QDialogOptions, Dialog } from 'quasar';
import { Web3WalletTypes } from '@walletconnect/web3wallet';

// Components.
import CCSessionRequestDialogVue from 'src/components/cashconnect/CCSessionRequestDialog.vue';
import CCSignTransactionDialogVue from 'src/components/cashconnect/CCSignTransactionDialog.vue';
import CCErrorDialogVue from 'src/components/cashconnect/CCErrorDialog.vue';

// Import Mainnet and Wallet Connect
import { NFTCapability, TestNetWallet, Wallet } from 'mainnet-js';
import {
  type BchSession,
  type RpcRequestResponse,
  type WalletProperties,
  type Unspent,
  CashConnectWallet,
} from 'cashconnect';

// Import Libauth.
import {
  type Output,
  binToHex,
  hexToBin,
  cashAddressToLockingBytecode,
  walletTemplateP2pkhNonHd,
} from '@bitauth/libauth';

// NOTE: We use a wrapper so that we can pass in the Mainnet Wallet as an argument.
//       This keeps the mutable state more managable in the sense that CC cannot exist with a valid wallet.
export const useCashconnectStore = async (wallet: Wallet | TestNetWallet) => {
  const store = defineStore('cashconnectStore', () => {
    // Ensure that the Mainnet Wallet has a Private Key.
    if (!wallet.privateKey) {
      throw new Error(
        'Failed to create store: Mainnet wallet.privateKey is undefined'
      );
    }

    // Auto-approve the following RPC methods.
    // NOTE: We hard-code these for Cashonize, but they could be customized on a per-Dapp basis too.
    const autoApprove = [
      'wc_authRequest',
      'bch_getTokens_V0',
      'bch_getBalance_V0',
      'bch_getChangeLockingBytecode_V0',
    ];

    // List of CashConnect sessions.
    // NOTE: This reactive state is synced with CashConnect via the onSessionsUpdated hook.
    const sessions = ref<Record<string, BchSession>>({});

    // The CashConnect Wallet instance.
    const cashConnectWallet = ref<CashConnectWallet>(
      new CashConnectWallet(
        // The master private key.
        wallet.privateKey,
        // Project ID.
        '3fd234b8e2cd0e1da4bc08a0011bbf64',
        // Metadata.
        {
          name: 'Cashonize',
          description: 'Cashonize BitcoinCash Web Wallet',
          url: 'cashonize.com/',
          icons: ['https://cashonize.com/images/favicon.ico'],
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

    async function pair(wcUri: string) {
      // Pair with the service.
      await cashConnectWallet.value.core.pairing.pair({ uri: wcUri });
    }

    //-----------------------------------------------------------------------------
    // Session Hooks
    //-----------------------------------------------------------------------------

    async function onSessionsUpdated(
      updatedSessions: Record<string, BchSession>
    ) {
      sessions.value = updatedSessions;
    }

    async function onSessionProposal(
      sessionProposal: Web3WalletTypes.SessionProposal
    ) {
      return await new Promise<WalletProperties>((resolve, reject) => {
        Dialog.create({
          component: CCSessionRequestDialogVue,
          componentProps: {
            session: sessionProposal,
          },
        })
          .onOk(() => {
            resolve({
              autoApprove,
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
      console.log('Session deleted');
    }

    async function onRPCRequest(
      session: BchSession,
      request: RpcRequestResponse['request'],
      response: RpcRequestResponse['response']
    ): Promise<void> {
      // If this is not a request that should be auto-approved...
      if (!autoApprove.includes(request.method)) {
        // Handle bch_signTransaction_V0.
        if (request.method === 'bch_signTransaction_V0') {
          return await new Promise<void>((resolve, reject) => {
            Dialog.create({
              component: CCSignTransactionDialogVue,
              componentProps: {
                session,
                params: request.params,
                response,
              },
            })
              .onOk(() => {
                resolve();
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
      console.error(error);

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
      if (!wallet.provider) {
        throw new Error('Wallet Provider is undefined');
      }

      const transaction = await wallet.provider.getRawTransactionObject(
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
      if (!wallet.cashaddr) {
        throw new Error('Wallet "cashaddr" is not available.');
      }

      const utxos = await wallet.getUtxos();

      const lockingBytecode = cashAddressToLockingBytecode(wallet.cashaddr);

      if (typeof lockingBytecode === 'string') {
        throw new Error('Failed to convert CashAddr to Locking Bytecode');
      }

      const transformed = utxos.map((utxo) => {
        let token:
          | {
              amount: bigint;
              category: Uint8Array;
              nft?: {
                capability: NFTCapability;
                commitment: Uint8Array;
              };
            }
          | undefined = undefined;

        if (utxo.token) {
          token = {
            amount: BigInt(utxo.token.amount),
            category: hexToBin(utxo.token.tokenId),
          };

          if (utxo.token?.capability || utxo.token?.commitment) {
            token.nft = {
              capability: utxo.token.capability || 'none',
              commitment: hexToBin(utxo.token.commitment || ''),
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
            script: 'unlock',
            data: {
              keys: {
                privateKeys: {
                  key: wallet.privateKey,
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
      if (!wallet.privateKey) {
        throw new Error(
          'Failed to getChangeTemplate: Mainnet wallet.privateKey is undefined'
        );
      }

      return {
        template: walletTemplateP2pkhNonHd,
        data: {
          keys: {
            privateKeys: {
              key: wallet.privateKey,
            },
          },
        },
      };
    }

    //-----------------------------------------------------------------------------
    // Helpers
    //-----------------------------------------------------------------------------

    // Expose the following...
    return {
      // Methods
      pair,

      // Properties
      cashConnectWallet,
      sessions,
    };
  })();

  return store;
};
