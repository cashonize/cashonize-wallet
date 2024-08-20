import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Web3WalletTypes } from '@walletconnect/web3wallet';
import type { SessionTypes } from '@walletconnect/types';
import { BaseWallet, TestNetWallet, TokenI, Wallet } from 'mainnet-js';

// Import Wallet Connect
import { BchSession, CashConnectWallet, type Unspent } from 'cashconnect';

// Import Libauth.
import {
  type Output,
  stringify,
  authenticationTemplateP2pkhNonHd,
  binToHex,
  hexToBin,
  binToNumberUintLE,
  cashAddressToLockingBytecode,
  decodePrivateKeyWif,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';

export const useCashconnectStore = (wallet: Wallet | TestNetWallet) => {
  return defineStore('cashconnectStore', () => {
    if (!wallet.privateKey) {
      throw new Error('Failed to create store: Private Key is undefined');
    }

    const privateKey = wallet.privateKey;

    // Auto-approve the following RPC methods.
    const autoApprove = [
      'wc_authRequest',
      'bch_getTokens_V0',
      'bch_getBalance_V0',
      'bch_getChangeLockingBytecode_V0',
    ];

    const sessionProposals = ref<Array<Web3WalletTypes.SessionProposal>>([]);
    const sessions = ref<Record<string, BchSession>>({});
    const rpcRequests = ref<Array<any>>([]);
    const cashConnectWallet = ref<CashConnectWallet>(
      new CashConnectWallet(
        // The master private key.
        privateKey,
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

    async function initCashConnect() {
      await cashConnectWallet.value.start();
    }

    //-----------------------------------------------------------------------------
    // Session Hooks
    //-----------------------------------------------------------------------------

    async function onSessionsUpdated(sessions: Record<string, BchSession>) {
      // TODO:
      sessions.value = { ...sessions };
    }

    async function onSessionProposal(
      sessionProposal: Web3WalletTypes.SessionProposal
    ) {
      return {
        autoApprove,
      };
    }

    async function onSessionDelete() {
      console.log('Session deleted');
    }

    /*
    async function onRPCRequest(
      session: BchSession,
      request: {
        method: string;
        params?: unknown;
      },
      response: unknown
    ) {
      // TODO: Use QDialog
    }
    */

    async function onError(error: Error) {
      console.error(error);
      // TODO: Use QDialog
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

      // TODO: Token handling.

      const transformed = utxos.map((utxo) => {
        return {
          outpointTransactionHash: hexToBin(utxo.txid),
          outpointIndex: utxo.vout,
          sequenceNumber: 0,
          lockingBytecode: lockingBytecode.bytecode,
          unlockingBytecode: {
            template: authenticationTemplateP2pkhNonHd,
            valueSatoshis: BigInt(utxo.satoshis),
            script: 'unlock',
            data: {
              keys: {
                privateKeys: {
                  key: privateKey,
                },
              },
            },
            token: undefined,
          },
        } as Unspent;
      });

      return transformed;
    }

    async function getChangeTemplate() {
      return {
        template: authenticationTemplateP2pkhNonHd,
        data: {
          keys: {
            privateKeys: {
              key: privateKey,
            },
          },
        },
      };
    }

    return {
      // Properties
      cashConnectWallet,
      sessionProposals,
      sessions,
      rpcRequests,
      initCashConnect,
    };
  })();
};
