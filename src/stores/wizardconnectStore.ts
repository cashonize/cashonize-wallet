import { ref } from "vue";
import { defineStore } from "pinia";
import { Dialog, Notify } from "quasar";
import { convert, NetworkType, HDWallet } from "mainnet-js";
import {
  WalletConnectionManager,
  DerivationPath,
  type WalletAdapter,
  type PendingSignRequest,
  type RelayConnectionState,
} from "@wizardconnect/wallet";
import { decodeKeyExchangeURI } from "@wizardconnect/core";
import {
  hexToBin,
  binToHex,
  sha256,
  secp256k1,
  hmacSha256,
  utf8ToBin,
  decodeTransaction,
  deriveSeedFromBip39Mnemonic,
  deriveHdPrivateNodeFromSeed,
  deriveHdPrivateNodeChild,
  deriveHdPublicNode,
  deriveHdPath,
  encodeHdPublicKey,
  type HdPrivateNodeValid,
} from "@bitauth/libauth";
import type { WcSignTransactionRequest } from "@bch-wc2/interfaces";
import type { WalletType, DappMetadata } from "src/interfaces/interfaces";
import { useStore } from "./store";
import { useSettingsStore } from "./settingsStore";
import { walletConnectMetadata } from "./constants";
import { createSignedWizTransaction, type WizInputSigningKey } from "src/utils/wizSigning";
import { WizSignTransactionRequestSchema, type WizSignTransactionRequest } from "src/utils/zodValidation";
import { displayAndLogError } from "src/utils/errorHandling";
import WC2TransactionRequest from "src/components/walletconnect/WC2TransactionRequest.vue";
import alertDialog from "src/components/general/alertDialog.vue";
import { i18n } from "src/boot/i18n";
const { t } = i18n.global;
const settingsStore = useSettingsStore();

// hdwalletv1 chain indices for the well-known path names shared in wallet_ready
const PATH_NAME_TO_CHILD: Record<string, DerivationPath> = {
  receive: DerivationPath.Receive,
  change: DerivationPath.Change,
  defi: DerivationPath.Cauldron,
};

// Bound the approval queue so a misbehaving dapp can't stack unlimited dialogs
const MAX_QUEUED_SIGN_REQUESTS = 10;

// localStorage key holding a Record<`${network}:${walletName}`, wizUri[]> so sessions
// can be restored after an app reload (the relay key is re-derived from seed + URI)
const WIZ_URIS_STORAGE_KEY = "wizardConnectUris";

interface WizHdNodes {
  // chain-level private nodes (receive/change/defi) under the wallet's parent derivation path
  privateChains: Map<DerivationPath, HdPrivateNodeValid>;
  // secret used to derive per-URI Nostr relay identity keys
  relayHmacKey: Uint8Array;
  xpubNetwork: "mainnet" | "testnet";
}

export const useWizardconnectStore = defineStore("wizardconnectStore", () => {
  // Accesses the wallet reactively via cross-store ref (mainStore.wallet) inside defineStore setup,
  // which Pinia resolves lazily — so the circular import with store.ts is safe.
  const mainStore = useStore();
  // Reactive projection of the manager's connection states, synced on manager events.
  const connections = ref<Record<string, RelayConnectionState>>({});
  // The manager and derived key material live outside Vue reactivity on purpose:
  // wrapping the manager's internal Maps/EventEmitter in a reactive proxy is unnecessary
  // and holding key material in reactive state would spread it through devtools/watchers.
  let manager: WalletConnectionManager | undefined;
  let hdNodes: WizHdNodes | undefined;
  // Track the approval dialog so it can be closed when the dapp cancels the request
  let pendingDialog: { connectionId: string; sequence: number; handle: ReturnType<typeof Dialog.create> } | null = null;
  let requestQueue: { connectionId: string; request: WizSignTransactionRequest }[] = [];
  // Sign requests cancelled by the dapp; also guards against a sign_cancel arriving
  // before its sign_transaction_request (relay delivery order is not guaranteed)
  const cancelledRequests = new Set<string>();

  function start() {
    // Make sure we don't start more than once, otherwise we'd register multiple
    // handlers and end up with multiple dialogs.
    if (manager) return;
    // cast undoes Pinia's ref-unwrapping of the class union; instanceof below does the real check
    const wallet = mainStore.wallet as WalletType;
    // WizardConnect shares chain-level xpubs so dapps can derive addresses, which requires
    // an HD wallet. For single-address wallets the manager stays undefined and pairing
    // attempts get a clear error in pair().
    if (!(wallet instanceof HDWallet)) return;
    hdNodes = deriveWizHdNodes(wallet);
    const newManager = new WalletConnectionManager(createWizAdapter(hdNodes));
    newManager.on("connectionsChanged", refreshConnections);
    newManager.on("connectionStatusChanged", refreshConnections);
    newManager.on("pendingSignRequest", (pendingRequest) => {
      try {
        handleSignRequest(pendingRequest);
      } catch (error) {
        console.error("Error when processing WizardConnect sign request:", error);
      }
    });
    newManager.on("signCancelled", handleSignCancelled);
    newManager.on("remoteDisconnect", handleRemoteDisconnect);
    manager = newManager;
    // Restore persisted sessions: reconnecting with the same URI re-derives the same
    // relay identity, so the dapp recognizes the wallet after an app reload
    for (const wizUri of getSavedUris()) {
      try {
        newManager.connect(wizUri);
      } catch (error) {
        console.error("Failed to restore WizardConnect session:", error);
      }
    }
    refreshConnections();
  }

  function stop() {
    if (!manager) return;
    // Clear our reference first (mirrors the CashConnect stop() work-around): resetWalletState
    // fires callbacks without awaiting each other, so start() must see a clean slate.
    const prevManager = manager;
    manager = undefined;
    hdNodes = undefined;
    requestQueue = [];
    cancelledRequests.clear();
    pendingDialog?.handle.hide();
    pendingDialog = null;
    // Sessions don't survive a wallet/network switch (same behavior as WC/CC), so
    // also drop the persisted URIs — otherwise the next app start would silently
    // reconnect sessions the dapp was just told are disconnected.
    for (const conn of Object.values(prevManager.getConnections())) {
      removeSavedUri(conn.uri);
    }
    // Remove listeners before disconnecting so the deferred cleanup events
    // (sent after the courtesy disconnect message settles) don't mutate fresh state
    prevManager.removeAllListeners();
    prevManager.disconnectAll();
    connections.value = {};
  }

  function pair(wizUri: string) {
    if (!manager) {
      const wallet = mainStore.wallet as WalletType;
      if (!(wallet instanceof HDWallet)) throw new Error(t('wizardConnect.errors.hdWalletRequired'));
      throw new Error(t('wizardConnect.errors.notInitialized'));
    }
    const trimmedUri = wizUri.trim();
    try {
      // validate the URI shape (accepts both the standard and QR-alphanumeric forms)
      decodeKeyExchangeURI(trimmedUri);
    } catch (error) {
      throw new Error(t('wizardConnect.errors.invalidUri'), { cause: error });
    }
    manager.connect(trimmedUri);
    addSavedUri(trimmedUri);
    refreshConnections();
  }

  function disconnectSession(connectionId: string) {
    if (!manager) return;
    const connection = manager.getConnections()[connectionId];
    if (!connection) return;
    removeSavedUri(connection.uri);
    manager.disconnect(connectionId);
    // Cleanup inside the manager waits for the courtesy disconnect message to settle,
    // so remove the session from the UI optimistically
    const remaining = { ...connections.value };
    delete remaining[connectionId];
    connections.value = remaining;
  }

  function refreshConnections() {
    connections.value = manager ? manager.getConnections() : {};
  }

  //-----------------------------------------------------------------------------
  // Sign request handling
  //-----------------------------------------------------------------------------
  function handleSignRequest(pendingRequest: PendingSignRequest) {
    const { connectionId, request } = pendingRequest;
    const rawSequence = (request as { sequence?: unknown }).sequence;
    // drop requests the dapp already cancelled (a sign_cancel can arrive first)
    if (typeof rawSequence === "number" && cancelledRequests.has(`${connectionId}:${rawSequence}`)) return;
    const respondWithError = (errorMessage: string) => {
      if (typeof rawSequence !== "number") return;
      manager?.sendSignError(connectionId, rawSequence, errorMessage).catch(console.error);
    };
    // the request arrives over the relay from an untrusted source, so validate the schema with zod
    const parseResult = WizSignTransactionRequestSchema.safeParse(request);
    if (!parseResult.success) {
      displayAndLogError(t('wizardConnect.errors.invalidTransactionSchema'));
      console.error(parseResult.error.message);
      respondWithError('Transaction signing request aborted with error: invalid request schema');
      return;
    }
    const validatedRequest = parseResult.data;
    // structural validation that needs the decoded transaction
    const validationError = validateWizTransaction(validatedRequest);
    if (validationError) {
      displayAndLogError(t('wizardConnect.errors.invalidTransactionSchema'));
      console.error(validationError);
      respondWithError('Transaction signing request aborted with error: ' + validationError);
      return;
    }
    if (requestQueue.length >= MAX_QUEUED_SIGN_REQUESTS) {
      respondWithError('Transaction signing request aborted with error: too many pending requests');
      return;
    }
    requestQueue.push({ connectionId, request: validatedRequest });
    void showNextSignRequest();
  }

  // Cross-checks between the transaction, sourceOutputs and inputPaths
  function validateWizTransaction(request: WizSignTransactionRequest): string | undefined {
    const { transaction, sourceOutputs } = request.transaction;
    const decodedTransaction = typeof transaction === "string" ? decodeTransaction(hexToBin(transaction)) : transaction;
    if (typeof decodedTransaction === "string") {
      return "Invalid transaction hex string in sign request: " + decodedTransaction;
    }
    if (decodedTransaction.inputs.length !== sourceOutputs.length) {
      return "Transaction inputs and sourceOutputs length mismatch";
    }
    const invalidInputPath = request.inputPaths.find(([inputIndex]) => inputIndex >= decodedTransaction.inputs.length);
    if (invalidInputPath) {
      return `inputPaths entry references non-existent input ${invalidInputPath[0]}`;
    }
    return undefined;
  }

  async function showNextSignRequest() {
    if (pendingDialog) return;
    const queuedRequest = requestQueue.shift();
    if (!queuedRequest) return;
    const { connectionId, request } = queuedRequest;
    // the connection (or the whole manager) may be gone by the time the queue advances
    const connection = manager?.getConnections()[connectionId];
    if (!manager || !connection) {
      void showNextSignRequest();
      return;
    }
    // Fetch the exchange rate before showing the dialog, falling back to the last known rate.
    // Without any rate we can't display the fiat impact, so reject instead of showing the dialog.
    let exchangeRate: number | undefined;
    try {
      exchangeRate = await convert(1, "bch", settingsStore.currency);
    } catch {
      exchangeRate = mainStore.exchangeRate;
    }
    if (exchangeRate === undefined) {
      Notify.create({ color: "negative", message: t('common.errors.exchangeRateUnavailable') });
      manager.sendSignError(connectionId, request.sequence, 'Transaction signing request aborted with error: exchange rate unavailable').catch(console.error);
      void showNextSignRequest();
      return;
    }
    // the dapp may have cancelled the request while the exchange rate was being fetched
    if (cancelledRequests.has(`${connectionId}:${request.sequence}`)) {
      void showNextSignRequest();
      return;
    }
    const dappMetadata: DappMetadata = {
      name: connection.dappName ?? connection.label,
      description: '',
      url: '',
      icons: connection.dappIcon ? [connection.dappIcon] : [],
    };
    const handle = Dialog.create({
      component: WC2TransactionRequest,
      componentProps: {
        dappMetadata,
        transactionRequest: request.transaction as WcSignTransactionRequest,
        exchangeRate,
      },
    })
      // Dialog listeners expect synchronous callbacks, this means the promise is fire-and-forget
      .onOk(() => {
        signWizTransaction(connectionId, request)
          .catch((error) => {
            console.error('Failed to sign transaction:', error);
            Notify.create({
              color: "negative",
              message: error instanceof Error ? error.message : t('wizardConnect.errors.failedToSignTransaction'),
            });
            manager?.sendSignError(connectionId, request.sequence, 'Transaction signing failed').catch(console.error);
          });
      })
      .onCancel(() => {
        manager?.sendSignError(connectionId, request.sequence, 'User rejected the transaction').catch(console.error);
      })
      .onDismiss(() => {
        pendingDialog = null;
        void showNextSignRequest();
      });
    pendingDialog = { connectionId, sequence: request.sequence, handle };
  }

  async function signWizTransaction(connectionId: string, request: WizSignTransactionRequest) {
    if (!manager || !hdNodes) throw new Error(t('wizardConnect.errors.notInitialized'));
    const inputKeys = deriveInputKeys(hdNodes, request.inputPaths);
    // the zod schema already validated and transformed this shape (see WizSignTransactionRequestSchema)
    const wizTransactionObj = request.transaction as WcSignTransactionRequest;
    const encodedTransaction = createSignedWizTransaction(wizTransactionObj, inputKeys);
    const signedTransactionHex = binToHex(encodedTransaction);
    const hash = binToHex(sha256.hash(sha256.hash(encodedTransaction)).reverse());
    if (request.transaction.broadcast) {
      try {
        Notify.create({
          spinner: true,
          message: t('wizardConnect.notifications.sendingTransaction'),
          color: 'grey-5',
          timeout: 750
        });
        const txId = await mainStore.wallet.submitTransaction(hexToBin(signedTransactionHex));
        const alertMessage = t('wizardConnect.notifications.sentTransaction', { dappName: dappNameForConnection(connectionId) });
        Dialog.create({
          component: alertDialog,
          componentProps: {
            alertInfo: { message: alertMessage, txid: txId }
          }
        });
      } catch (error) {
        displayAndLogError(error);
        const errorMessage = typeof error == 'string' ? error : ((error instanceof Error) ? error.message : t('wizardConnect.errors.errorSendingTransaction'));
        await manager.sendSignError(connectionId, request.sequence, 'Transaction failed to send: ' + errorMessage);
        return;
      }
    }
    if (!request.transaction.broadcast) {
      const alertMessage = t('wizardConnect.notifications.signedTransaction', { dappName: dappNameForConnection(connectionId) });
      Dialog.create({
        component: alertDialog,
        componentProps: {
          alertInfo: {
            message: alertMessage,
            txid: hash,
            title: t('wizardConnect.notifications.transactionSignedTitle'),
            hideExplorerLink: true,
          }
        }
      });
    }
    await manager.sendSignResponse(connectionId, request.sequence, signedTransactionHex);
    const message = request.transaction.broadcast
      ? t('wizardConnect.notifications.transactionSent')
      : t('wizardConnect.notifications.transactionSigned');
    Notify.create({
      type: 'positive',
      message
    });
  }

  function dappNameForConnection(connectionId: string): string {
    const connection = manager?.getConnections()[connectionId];
    return connection?.dappName ?? connection?.label ?? 'dapp';
  }

  function handleSignCancelled(connectionId: string, sequence: number) {
    cancelledRequests.add(`${connectionId}:${sequence}`);
    requestQueue = requestQueue.filter(
      (queued) => !(queued.connectionId === connectionId && queued.request.sequence === sequence)
    );
    if (pendingDialog && pendingDialog.connectionId === connectionId && pendingDialog.sequence === sequence) {
      // programmatic hide fires only onDismiss, which advances the queue
      pendingDialog.handle.hide();
      Notify.create({
        color: "negative",
        message: t('wizardConnect.notifications.requestCancelled', { dappName: dappNameForConnection(connectionId) }),
      });
    }
  }

  function handleRemoteDisconnect(connectionId: string) {
    // this handler runs synchronously during the emit, before the manager removes the connection
    const connection = manager?.getConnections()[connectionId];
    if (connection) removeSavedUri(connection.uri);
    Notify.create({
      color: "grey-7",
      message: t('wizardConnect.notifications.dappDisconnected', { dappName: dappNameForConnection(connectionId) }),
    });
    requestQueue = requestQueue.filter((queued) => queued.connectionId !== connectionId);
    if (pendingDialog?.connectionId === connectionId) {
      pendingDialog.handle.hide();
    }
  }

  //-----------------------------------------------------------------------------
  // Key derivation
  //-----------------------------------------------------------------------------
  function deriveWizHdNodes(wallet: HDWallet): WizHdNodes {
    const seed = deriveSeedFromBip39Mnemonic(wallet.mnemonic);
    const hdNode = deriveHdPrivateNodeFromSeed(seed);
    // the wallet's parent derivation path, e.g. "m/44'/145'/0'"
    const parentDerivation = wallet.derivation;
    const privateChains = new Map<DerivationPath, HdPrivateNodeValid>();
    for (const childIndex of [DerivationPath.Receive, DerivationPath.Change, DerivationPath.Cauldron]) {
      privateChains.set(childIndex, deriveHdPath(hdNode, `${parentDerivation}/${childIndex}`));
    }
    // Relay identity keys are HMAC(dedicated chain key, pairing URI): deterministic per URI so
    // reconnects restore the same Nostr identity, distinct per URI so dapps can't correlate
    // sessions. Chain index 8 keeps the relay secret off the xpub chains shared with dapps.
    const relaySecretNode = deriveHdPrivateNodeChild(deriveHdPath(hdNode, `${parentDerivation}/8`), 0);
    return {
      privateChains,
      relayHmacKey: relaySecretNode.privateKey,
      xpubNetwork: wallet.network === NetworkType.Mainnet ? "mainnet" : "testnet",
    };
  }

  function createWizAdapter(nodes: WizHdNodes): WalletAdapter {
    return {
      walletName: walletConnectMetadata.name,
      walletIcon: walletConnectMetadata.icons[0] ?? '',
      getRelayPrivateKey: (uri: string) => hmacSha256(nodes.relayHmacKey, utf8ToBin(uri)),
      getPublicKey: (path: DerivationPath, index: bigint) => {
        const chain = nodes.privateChains.get(path);
        if (!chain) throw new Error(`Unsupported derivation path: ${path}`);
        const childNode = deriveHdPrivateNodeChild(chain, Number(index));
        const pubkeyCompressed = secp256k1.derivePublicKeyCompressed(childNode.privateKey);
        if (typeof pubkeyCompressed === "string") throw new Error("Failed to derive public key: " + pubkeyCompressed);
        return pubkeyCompressed;
      },
      getXpub: (path: DerivationPath) => {
        const chain = nodes.privateChains.get(path);
        if (!chain) throw new Error(`Unsupported derivation path: ${path}`);
        return encodeHdPublicKey({ node: deriveHdPublicNode(chain), network: nodes.xpubNetwork }).hdPublicKey;
      },
      // never called by the library; signing runs through the pendingSignRequest flow
      signTransaction: () => Promise.reject(new Error("signTransaction is handled via the pendingSignRequest flow")),
    };
  }

  function deriveInputKeys(nodes: WizHdNodes, inputPaths: WizSignTransactionRequest['inputPaths']) {
    const inputKeys = new Map<number, WizInputSigningKey>();
    for (const [inputIndex, pathName, addressIndex] of inputPaths) {
      const chain = nodes.privateChains.get(PATH_NAME_TO_CHILD[pathName] as DerivationPath);
      if (!chain) throw new Error(`Unknown path name: ${pathName}`);
      const childNode = deriveHdPrivateNodeChild(chain, addressIndex);
      const pubkeyCompressed = secp256k1.derivePublicKeyCompressed(childNode.privateKey);
      if (typeof pubkeyCompressed === "string") throw new Error("Failed to derive public key: " + pubkeyCompressed);
      inputKeys.set(inputIndex, { privateKey: childNode.privateKey, pubkeyCompressed });
    }
    return inputKeys;
  }

  //-----------------------------------------------------------------------------
  // Session persistence
  //-----------------------------------------------------------------------------
  function storageSubKey() {
    return `${mainStore.network}:${mainStore.activeWalletName}`;
  }

  function readAllSavedUris(): Record<string, string[]> {
    try {
      const rawJson = localStorage.getItem(WIZ_URIS_STORAGE_KEY);
      if (!rawJson) return {};
      const parsed: unknown = JSON.parse(rawJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const validated: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) validated[key] = value.filter((uri): uri is string => typeof uri === "string");
      }
      return validated;
    } catch (error) {
      console.error("Failed to read persisted WizardConnect sessions:", error);
      return {};
    }
  }

  function getSavedUris(): string[] {
    return readAllSavedUris()[storageSubKey()] ?? [];
  }

  function addSavedUri(wizUri: string) {
    const allUris = readAllSavedUris();
    const walletUris = allUris[storageSubKey()] ?? [];
    if (!walletUris.includes(wizUri)) walletUris.push(wizUri);
    allUris[storageSubKey()] = walletUris;
    localStorage.setItem(WIZ_URIS_STORAGE_KEY, JSON.stringify(allUris));
  }

  function removeSavedUri(wizUri: string) {
    const allUris = readAllSavedUris();
    const walletUris = (allUris[storageSubKey()] ?? []).filter((savedUri) => savedUri !== wizUri);
    if (walletUris.length) {
      allUris[storageSubKey()] = walletUris;
    } else {
      delete allUris[storageSubKey()];
    }
    localStorage.setItem(WIZ_URIS_STORAGE_KEY, JSON.stringify(allUris));
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
    connections,
  };
});
