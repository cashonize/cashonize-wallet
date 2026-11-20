import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { Dialog, Notify } from 'quasar'
import { BroadcastTimeoutError, HDWallet, SignedMessage } from '@cashonize/bch-wallet-lib'
import type { DappMetadata, WalletType } from 'src/interfaces/interfaces'
import {
  binToHex,
  decodeTransaction,
  decodeTransactionUnsafe,
  encodeLockingBytecodeP2pkh,
  hexToBin,
  secp256k1,
  sha256,
} from '@bitauth/libauth'
import type { WcSignMessageRequest, WcSignTransactionRequest } from '@bch-wc2/interfaces'
import { currentExchangeRate } from 'src/utils/utils'
import { dappsAvailableOn, type AppNetwork } from 'src/utils/wallet/networks'
import { tiedChipnetCopy } from 'src/utils/wallet/tiedWallets'
import {
  autoApproveKey,
  chainIdOf,
  normalizePermission,
  permissionKey,
  permissionOrigin,
  permissionsFrom,
  type BexPermission,
  type BexPermissions,
} from 'src/utils/bex/permissions'
import { createSignedWcTransaction } from 'src/utils/dapp/wcSigning'
import { notifyDappActivity } from 'src/utils/dapp/notifyDappActivity'
import type { DappActivityEntry } from 'src/utils/dapp/dappActivity'
import { displayBroadcastError } from 'src/utils/wallet/broadcastErrors'
import { reportDappRefusal } from 'src/utils/txHelpers'
import {
  LooseEncodedWcTransactionObjSchema,
  StrictEncodedWcTransactionObjSchema,
  BexRequestAccountsParamsSchema,
  WcMessageObjSchema,
  describeSchemaError,
} from 'src/utils/zodValidation'
import { i18n } from 'src/boot/i18n'
import WCSignMessageRequest from 'src/components/walletconnect/WCSignMessageRequest.vue'
import WC2TransactionRequest from 'src/components/walletconnect/WC2TransactionRequest.vue'
import BexConnectDialog from 'src/components/general/bexConnectDialog.vue'
import WC2AddressSelectDialog from 'src/components/walletconnect/WC2AddressSelectDialog.vue'
import { useStore } from './store'
import { useSettingsStore } from './settingsStore'
import { useIdentitiesStore } from './identitiesStore'

const { t } = i18n.global

// The error a dApp receives. WalletConnect's codes where it has one, so a dApp moving over handles
// the same: 5000 for a request the user or the dApp withdrew, 7 for one the wallet aborts, 5100 on
// a network without dApps, 1001 for an unknown method. EIP-1193's for the rest: 4100 for a site
// that is not connected, 4900 with no wallet open, 4901 for a dApp on another network.
export class BexRpcError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'BexRpcError'
    this.code = code
  }
}

interface SigningInfo {
  privateKey: Uint8Array
  pubkeyCompressed: Uint8Array
  publicKeyHash: Uint8Array
}

interface BexMethodRequest {
  origin: string
  method: string
  params?: unknown
}

type TransactionActivity = Omit<DappActivityEntry, 'time' | 'outcome'>
type SiteMetadata = { name?: string | undefined; description?: string | undefined; icons?: string[] | undefined }

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// The wallet a site's accounts belong to: its first receive address names the keys, and the
// network tells chipnet from testnet4, which share the bchtest prefix. Never sent to a site.
function walletIdOf(wallet: WalletType, network: AppNetwork): string {
  const firstAddress = wallet instanceof HDWallet ? wallet.getDepositAddress(0) : wallet.getDepositAddress()
  return `${network}:${firstAddress}`
}

export const useBexStore = defineStore('bexStore', () => {
  const mainStore = useStore()
  const settingsStore = useSettingsStore()
  const identitiesStore = useIdentitiesStore()

  // Every site's permission, for any wallet. chrome.storage.local is the source of truth, shared
  // with the service worker, which answers read-only requests and revokes on bch_disconnect.
  const permissions = ref<BexPermissions>({})

  const activeWalletId = computed(() =>
    mainStore._wallet ? walletIdOf(mainStore._wallet, mainStore.network) : undefined)

  // The sites connected to the open wallet: the ones listed, and the only ones that may sign
  const activePermissions = computed(() => {
    const active: BexPermissions = {}
    for (const [origin, permission] of Object.entries(permissions.value)) {
      if (permission.walletId === activeWalletId.value) active[origin] = permission
    }
    return active
  })

  async function loadPermissions() {
    const stored = await chrome.storage.local.get(null)
    permissions.value = permissionsFrom(stored)
  }

  const permissionsReady = loadPermissions()

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    // applied after the first read, so that read cannot overwrite a newer change
    void permissionsReady.then(() => {
      let next: BexPermissions | undefined
      for (const [key, change] of Object.entries(changes)) {
        const origin = permissionOrigin(key)
        if (!origin) continue
        next ??= { ...permissions.value }
        const permission = normalizePermission(change.newValue)
        if (permission) {
          next[origin] = permission
        } else {
          delete next[origin]
          // revoked elsewhere, by the worker on the dApp's bch_disconnect or by another page
          settingsStore.clearAutoApproveState(autoApproveKey(origin))
        }
      }
      if (next) permissions.value = next
    })
  })

  function approvedPermission(origin: string, walletId: string): BexPermission | undefined {
    const permission = Object.hasOwn(permissions.value, origin) ? permissions.value[origin] : undefined
    return permission?.walletId === walletId ? permission : undefined
  }

  // One key per site, so this write never replaces another site's permission, nor the worker's
  // revocation of one
  async function approveOrigin(origin: string, walletId: string, accounts: string[], metadata: DappMetadata) {
    const permission: BexPermission = {
      accounts: [...accounts],
      walletId,
      connectedAt: Date.now(),
      metadata: { ...metadata, icons: [...metadata.icons] },
    }
    await chrome.storage.local.set({ [permissionKey(origin)]: permission })
    permissions.value = { ...permissions.value, [origin]: permission }
  }

  async function revokeOrigin(origin: string) {
    await chrome.storage.local.remove(permissionKey(origin))
    settingsStore.clearAutoApproveState(autoApproveKey(origin))
    const next = { ...permissions.value }
    delete next[origin]
    permissions.value = next
  }

  const cancelled = () => new BexRpcError(5000, 'Request cancelled by the dApp')

  // Polls for a state the wallet page reaches on its own; a cancel or the timeout ends the wait
  async function waitUntil(ready: () => boolean, signal: AbortSignal, timeoutMs: number, timedOut: string) {
    const started = Date.now()
    while (!ready()) {
      if (signal.aborted) throw cancelled()
      if (Date.now() - started > timeoutMs) throw new BexRpcError(4900, timedOut)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  // The app page is the wallet host, so a request can arrive while WalletPage is still loading
  // the wallet from IndexedDB
  async function waitForWallet(signal: AbortSignal): Promise<WalletType> {
    await waitUntil(() => !!mainStore._wallet, signal, 30_000, 'No wallet is open in Cashonize')
    return mainStore.wallet
  }

  // A signature waits for the wallet's coins and the identity checks on open: until those, a coin
  // they reserve passes for an ordinary one. Reservations another page made since are read too.
  async function waitForWalletReady(signal: AbortSignal): Promise<WalletType> {
    const wallet = await waitForWallet(signal)
    await waitUntil(
      () => mainStore.walletInitFailed || (mainStore.walletUtxos !== undefined && identitiesStore.openChecksSettled),
      signal, 60_000, 'Cashonize is still loading the wallet')
    if (mainStore.walletInitFailed) throw new BexRpcError(4900, 'Cashonize could not load the wallet')
    mainStore.reloadReservations()
    return wallet
  }

  // A refusal the user should understand too: they read why, then the dApp gets its error
  async function explainRefusal(message: string, signal: AbortSignal) {
    await new Promise<void>((resolve) => {
      const dialog = Dialog.create({
        message,
        ok: { label: 'OK', color: 'primary', unelevated: true },
        class: 'flex justify-center',
      }).onDismiss(resolve)
      signal.addEventListener('abort', () => dialog.hide())
    })
  }

  // dApps cannot tell testnet4 from chipnet (see dappsAvailableOn), as on WalletConnect. And an
  // older wallet's chipnet copy has its mainnet keys: a transaction is valid on any network, so a
  // dApp signature there could spend mainnet coins.
  async function assertDappsAvailable(signal: AbortSignal) {
    if (!dappsAvailableOn(mainStore.network)) {
      throw new BexRpcError(5100, t('dapp.unavailableOnNetwork', { network: mainStore.network }))
    }
    if (mainStore.network === 'chipnet' && await tiedChipnetCopy(mainStore.activeWalletName)) {
      await explainRefusal(t('dapp.tiedChipnetCopy'), signal)
      throw new BexRpcError(5100, 'This chipnet wallet shares its keys with a mainnet wallet')
    }
  }

  // As on WalletConnect, a dApp that names the network it needs is refused by a wallet on another
  // one, and the user is told which wallet to open
  async function assertDappNetwork(chainId: string | undefined, signal: AbortSignal) {
    if (chainId === undefined || chainId === chainIdOf(mainStore.network)) return
    const dappNetwork = chainId === 'bch:bitcoincash' ? 'mainnet' : 'chipnet'
    const message = dappNetwork === 'chipnet'
      ? 'cashConnect.notifications.networkMismatchChipnet'
      : 'cashConnect.notifications.networkMismatch'
    await explainRefusal(t(message, { network: dappNetwork }), signal)
    throw new BexRpcError(4901, `This dApp needs a wallet on ${dappNetwork}`)
  }

  // The permission names its wallet; the address is checked against the keys as well, so a
  // signature is only ever made with the key of the address the dialog shows
  function signingInfo(wallet: WalletType, address: string): SigningInfo {
    if (!wallet.hasAddress(address)) {
      throw new BexRpcError(4100, 'The connected account is not in the open wallet')
    }
    if (wallet instanceof HDWallet) {
      const cacheEntry = wallet.walletCache.get(address)
      if (!cacheEntry?.privateKey) {
        throw new BexRpcError(5000, 'The wallet has no private key for the connected account')
      }
      const pubkeyCompressed = secp256k1.compressPublicKey(cacheEntry.publicKey)
      if (typeof pubkeyCompressed === 'string') {
        throw new BexRpcError(5000, 'Could not derive the public key for the connected account')
      }
      return {
        privateKey: cacheEntry.privateKey,
        pubkeyCompressed,
        publicKeyHash: cacheEntry.publicKeyHash,
      }
    }
    if (!wallet.privateKey || !wallet.publicKeyCompressed) {
      throw new BexRpcError(5000, 'The wallet has no private key')
    }
    return {
      privateKey: wallet.privateKey,
      pubkeyCompressed: wallet.publicKeyCompressed,
      publicKeyHash: wallet.publicKeyHash,
    }
  }

  // The permission of a site for the open wallet; a site connected to another wallet asks again
  function connectedPermission(origin: string, wallet: WalletType): BexPermission {
    const permission = approvedPermission(origin, walletIdOf(wallet, mainStore.network))
    if (!permission) throw new BexRpcError(4100, 'Unauthorized: call bch_requestAccounts first')
    return permission
  }

  function metadataFor(origin: string, supplied?: SiteMetadata): DappMetadata {
    return {
      name: supplied?.name?.trim() || origin,
      description: supplied?.description ?? '',
      url: origin, // the browser-attested origin is the only URL shown/used
      icons: supplied?.icons?.slice(0, 1) ?? [],
    }
  }

  // Shows one approval dialog and resolves with the result of the approved action. The dialog
  // hides as soon as OK is pressed, so a dismissal after approval is not treated as a rejection.
  // A request the dApp withdrew never shows, and closes if it is up.
  function showApproval<T>(
    component: object,
    componentProps: Record<string, unknown>,
    onApprove: (payload?: unknown) => T | Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(cancelled())
    return new Promise((resolve, reject) => {
      let settled = false
      let approved = false

      const settleError = (error: BexRpcError) => {
        if (settled) return
        settled = true
        reject(error)
      }

      const handle = Dialog.create({ component, componentProps })
      signal.addEventListener('abort', () => {
        if (approved) return
        handle.hide()
        settleError(cancelled())
      })

      handle.onOk((payload?: unknown) => {
        if (signal.aborted) return
        approved = true
        void Promise.resolve(onApprove(payload)).then(
          (value) => {
            if (settled) return
            settled = true
            resolve(value)
          },
          (error: unknown) => settleError(error instanceof BexRpcError ? error : new BexRpcError(5000, errorMessage(error))),
        )
      })
      handle.onCancel(() => settleError(new BexRpcError(5000, 'User rejected.')))
      handle.onDismiss(() => {
        if (approved) return
        settleError(new BexRpcError(5000, 'User rejected.'))
      })
    })
  }

  async function requestAccounts(origin: string, params: unknown, signal: AbortSignal): Promise<string[]> {
    // EIP-1193-style callers may pass no params or an array
    const input = params && typeof params === 'object' && !Array.isArray(params) ? params : {}
    const parsed = BexRequestAccountsParamsSchema.safeParse(input)
    if (!parsed.success) {
      throw new BexRpcError(7, 'Account request aborted with error: ' + describeSchemaError(parsed.error))
    }
    const wallet = await waitForWallet(signal)
    await assertDappsAvailable(signal)
    await assertDappNetwork(parsed.data.chainId, signal)
    const walletId = walletIdOf(wallet, mainStore.network)

    // A connected site gets its accounts again without a prompt, and keeps its auto-approval and
    // the metadata it was approved with, as a WalletConnect session does; to change them, the site
    // or the user disconnects first
    const connected = approvedPermission(origin, walletId)
    if (connected) return connected.accounts

    const metadata = metadataFor(origin, parsed.data.dappMetadata)
    // a new connection starts without the auto-approval an earlier one of the site had
    const connect = async (accounts: string[]) => {
      settingsStore.clearAutoApproveState(autoApproveKey(origin))
      await approveOrigin(origin, walletId, accounts, metadata)
      return accounts
    }
    if (wallet instanceof HDWallet) {
      return showApproval(
        WC2AddressSelectDialog,
        { dappMetadata: metadata, allowChangeAddresses: false },
        async (payload?: unknown) => {
          const accounts = Array.isArray(payload)
            ? payload.filter((account): account is string => typeof account === 'string')
            : []
          if (!accounts.length) throw new BexRpcError(5000, 'No account selected')
          return connect(accounts)
        },
        signal,
      )
    }
    const address = wallet.getDepositAddress()
    return showApproval(
      BexConnectDialog,
      { origin, address, network: mainStore.network, dappMetadata: metadata },
      () => connect([address]),
      signal,
    )
  }

  async function signMessage(origin: string, params: unknown, signal: AbortSignal): Promise<string> {
    let messageRequest: WcSignMessageRequest
    try {
      messageRequest = WcMessageObjSchema.parse(params) as WcSignMessageRequest
    } catch (error) {
      throw new BexRpcError(7, 'Message signing request aborted with error: ' + describeSchemaError(error))
    }

    const wallet = await waitForWallet(signal)
    await assertDappsAvailable(signal)
    const permission = connectedPermission(origin, wallet)
    const signerAddress = permission.accounts[0]!
    const signing = signingInfo(wallet, signerAddress)
    const dappMetadata = metadataFor(origin, permission.metadata)
    return showApproval(
      WCSignMessageRequest,
      {
        dappMetadata,
        messageRequest,
        signerAddress,
      },
      () => {
        const signature = SignedMessage.sign(messageRequest.message, signing.privateKey).signature
        // the log names a site by its attested origin, never by the name it gave itself
        notifyDappActivity({
          protocol: 'extension',
          dappName: origin,
          dappIcon: dappMetadata.icons[0],
          outcome: 'messageSigned',
        })
        return signature
      },
      signal,
    )
  }

  function validateTransaction(params: unknown): WcSignTransactionRequest {
    const schema = settingsStore.strictWcSchema
      ? StrictEncodedWcTransactionObjSchema
      : LooseEncodedWcTransactionObjSchema
    try {
      // The WC2-BCH wire form is extended JSON: the schema itself turns the stringified
      // Uint8Array and bigint fields into the values libauth signs.
      const parsed = schema.parse(params ?? {})
      let transactionInputs: number
      if (typeof parsed.transaction === 'string') {
        const decoded = decodeTransaction(hexToBin(parsed.transaction))
        if (typeof decoded === 'string') throw new Error(`Invalid transaction hex: ${decoded}`)
        transactionInputs = decoded.inputs.length
      } else {
        transactionInputs = parsed.transaction.inputs.length
      }
      if (transactionInputs !== parsed.sourceOutputs.length) {
        throw new Error('Transaction inputs and sourceOutputs length mismatch')
      }
      return parsed as WcSignTransactionRequest
    } catch (error) {
      throw new BexRpcError(7, 'Transaction signing request aborted with error: ' + describeSchemaError(error))
    }
  }

  function reservedInputsCheck(transactionRequest: WcSignTransactionRequest) {
    const decoded = typeof transactionRequest.transaction === 'string'
      ? decodeTransactionUnsafe(hexToBin(transactionRequest.transaction))
      : transactionRequest.transaction
    return identitiesStore.checkDappReservedInputs(
      decoded.inputs,
      decoded.outputs,
      transactionRequest.sourceOutputs,
    )
  }

  // As on WalletConnect: the user sees the failure classified, the dApp the node's own words
  async function broadcastTransaction(wallet: WalletType, encoded: Uint8Array, activity: TransactionActivity) {
    try {
      Notify.create({
        spinner: true,
        message: t('walletConnect.notifications.sendingTransaction'),
        color: 'grey-5',
        timeout: 750,
      })
      await wallet.submitTransaction(encoded)
    } catch (error) {
      const started = mainStore.currentInitializationToken()
      displayBroadcastError(error, (transaction) => mainStore.broadcastAgain(transaction, started, () => {
        notifyDappActivity({ ...activity, outcome: 'sent' })
      }))
      notifyDappActivity({ ...activity, outcome: 'broadcastFailed' })
      // one whose outcome is unknown may have gone out, and its message names the txid to look up
      if (error instanceof BroadcastTimeoutError) {
        throw new BexRpcError(7, 'Transaction outcome unknown, it may have been sent: ' + errorMessage(error))
      }
      throw new BexRpcError(7, 'Transaction failed to send with error: ' + errorMessage(error))
    }
  }

  async function signTransaction(origin: string, params: unknown, signal: AbortSignal) {
    const transactionRequest = validateTransaction(params)
    const wallet = await waitForWalletReady(signal)
    await assertDappsAvailable(signal)
    const permission = connectedPermission(origin, wallet)
    const signing = signingInfo(wallet, permission.accounts[0]!)

    const arrivalCheck = reservedInputsCheck(transactionRequest)
    if (arrivalCheck.refusals.length) {
      reportDappRefusal(arrivalCheck)
      throw new BexRpcError(5000, 'Transaction signing aborted: a wallet-reserved coin is an input')
    }

    const dappMetadata = metadataFor(origin, permission.metadata)
    const signAndSend = async () => {
      // a withdrawn request is never signed, whether it got this far through the dialog or not
      if (signal.aborted) throw cancelled()
      // Checked again rather than only on arrival: a coin can become reserved while the dialog is up.
      const signingCheck = reservedInputsCheck(transactionRequest)
      if (signingCheck.refusals.length) {
        reportDappRefusal(signingCheck)
        throw new BexRpcError(7, 'Transaction signing request aborted with error: input reserved by the wallet')
      }
      const walletLockingBytecode = binToHex(encodeLockingBytecodeP2pkh(signing.publicKeyHash))
      const encoded = createSignedWcTransaction(
        transactionRequest,
        { privateKey: signing.privateKey, pubkeyCompressed: signing.pubkeyCompressed },
        walletLockingBytecode,
      )
      const signedTransactionHash = binToHex(sha256.hash(sha256.hash(encoded)).reverse())
      const activity: TransactionActivity = {
        protocol: 'extension',
        dappName: origin,
        dappIcon: dappMetadata.icons[0],
        userPrompt: transactionRequest.userPrompt,
        txid: signedTransactionHash,
      }
      if (transactionRequest.broadcast) await broadcastTransaction(wallet, encoded, activity)
      notifyDappActivity({ ...activity, outcome: transactionRequest.broadcast ? 'sent' : 'signed' })
      return {
        signedTransaction: binToHex(encoded),
        signedTransactionHash,
      }
    }

    // As on WalletConnect: the user's auto-approval of a site covers its ordinary spends, never an
    // identity operation, which is signed only in front of the user
    const autoApproval = autoApproveKey(origin)
    const touchesIdentity = arrivalCheck.returning.length > 0
    if (!touchesIdentity && settingsStore.isAutoApproveValid(autoApproval)) {
      if (signal.aborted) throw cancelled()
      const signed = await signAndSend()
      if (settingsStore.getAutoApproveState(autoApproval)?.mode === 'count') {
        settingsStore.decrementAutoApproveRequest(autoApproval)
      }
      return signed
    }

    // the dialog's fiat values would read zero without a rate, so the request is refused instead
    const exchangeRate = await currentExchangeRate(settingsStore.currency, () => mainStore.exchangeRate)
    if (exchangeRate === undefined) {
      Notify.create({ color: 'negative', message: t('common.errors.exchangeRateUnavailable') })
      throw new BexRpcError(5000, 'Transaction signing aborted: the wallet could not fetch an exchange rate')
    }
    return showApproval(
      WC2TransactionRequest,
      {
        dappMetadata,
        transactionRequest,
        exchangeRate,
      },
      signAndSend,
      signal,
    )
  }

  // signal: the worker's cancel of a request the dApp withdrew, that timed out or lost its page
  async function handleRequest(request: BexMethodRequest, signal: AbortSignal): Promise<unknown> {
    await permissionsReady
    switch (request.method) {
      case 'bch_requestAccounts':
      case 'bch_connect':
        return requestAccounts(request.origin, request.params, signal)
      case 'bch_signMessage':
      case 'personal_sign':
        return signMessage(request.origin, request.params, signal)
      case 'bch_signTransaction':
        return signTransaction(request.origin, request.params, signal)
      default:
        // the worker answers the read-only methods itself
        throw new BexRpcError(1001, `Unsupported method ${request.method}`)
    }
  }

  function siteMetadata(origin: string, permission: BexPermission): DappMetadata {
    return metadataFor(origin, permission.metadata)
  }

  return {
    handleRequest,
    activePermissions,
    activeWalletId,
    revokeOrigin,
    siteMetadata,
  }
})
