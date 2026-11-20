// Shared between the extension page (the wallet) and the service worker (which answers read-only
// requests without opening the popup, and sends the sites their provider events).
//
// A site's permission lives under its own key in chrome.storage.local, so a write for one site
// never overwrites another's, whichever context makes it. It names the wallet its accounts belong
// to: while another wallet is open in the page the site sees no accounts, and asks again.

import type { DappMetadata } from 'src/interfaces/interfaces'

export const BEX_PERMISSION_PREFIX = 'bexPermission:'
export const BEX_PROVIDER_STATE_KEY = 'bexProviderState'

export interface BexPermission {
  accounts: string[]
  // the wallet the accounts belong to, as the wallet page names it (bexStore's walletIdOf)
  walletId: string
  connectedAt: number
  metadata?: DappMetadata
}

export type BexPermissions = Record<string, BexPermission>

// Written by the wallet page once it has opened a wallet; the worker answers from it while no
// wallet page is open. walletId is wallet-private: it never goes to a site.
export interface BexProviderState {
  chainId: string
  network: string
  walletId: string
}

// The CAIP-2 chain of a network, as WalletConnect names it; chipnet and testnet4 share bch:bchtest
export function chainIdOf(network: string): string {
  return network === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest'
}

export function permissionKey(origin: string): string {
  return BEX_PERMISSION_PREFIX + origin
}

// A site's entry in the auto-approve settings it shares with WalletConnect, whose entries are keyed
// by session topic (hex), so the two never collide. It holds only while the site's permission does.
export function autoApproveKey(origin: string): string {
  return 'bex:' + origin
}

// The browser-attested origin of a page the provider serves. A sandboxed document has the opaque
// origin "null", which every such page shares, so it is no site.
export function isWebOrigin(origin: unknown): origin is string {
  return typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)
}

export function permissionOrigin(key: string): string | undefined {
  if (!key.startsWith(BEX_PERMISSION_PREFIX)) return undefined
  const origin = key.slice(BEX_PERMISSION_PREFIX.length)
  return isWebOrigin(origin) ? origin : undefined
}

export function normalizePermission(raw: unknown): BexPermission | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as Partial<Record<keyof BexPermission, unknown>>
  if (!Array.isArray(entry.accounts) || typeof entry.walletId !== 'string' || !entry.walletId) return undefined
  const accounts = entry.accounts.filter((account): account is string => typeof account === 'string')
  if (!accounts.length) return undefined
  const metadata = normalizeMetadata(entry.metadata)
  return {
    accounts,
    walletId: entry.walletId,
    connectedAt: typeof entry.connectedAt === 'number' ? entry.connectedAt : 0,
    ...(metadata ? { metadata } : {}),
  }
}

export function permissionsFrom(items: Record<string, unknown>): BexPermissions {
  const permissions: BexPermissions = {}
  for (const [key, value] of Object.entries(items)) {
    const origin = permissionOrigin(key)
    const permission = origin ? normalizePermission(value) : undefined
    if (origin && permission) permissions[origin] = permission
  }
  return permissions
}

export function normalizeProviderState(raw: unknown): BexProviderState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const state = raw as Partial<Record<keyof BexProviderState, unknown>>
  if (typeof state.chainId !== 'string' || typeof state.network !== 'string' || typeof state.walletId !== 'string') {
    return undefined
  }
  return { chainId: state.chainId, network: state.network, walletId: state.walletId }
}

// What a site sees: its accounts while the wallet they belong to is the open one
export function visibleAccounts(permission: BexPermission | undefined, state: BexProviderState | undefined): string[] {
  if (!permission || !state || permission.walletId !== state.walletId) return []
  return permission.accounts
}

export interface BexStorageView {
  permissions: BexPermissions
  state: BexProviderState | undefined
}

export function storageView(items: Record<string, unknown>): BexStorageView {
  return { permissions: permissionsFrom(items), state: normalizeProviderState(items[BEX_PROVIDER_STATE_KEY]) }
}

// The storage as it was before a change, rebuilt from the items after it
export function itemsBefore(
  itemsAfter: Record<string, unknown>,
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
): Record<string, unknown> {
  const before = { ...itemsAfter }
  for (const [key, change] of Object.entries(changes)) {
    if (change.oldValue === undefined) delete before[key]
    else before[key] = change.oldValue
  }
  return before
}

// The sites whose accounts differ between two views of the storage, with what each sees now
export function changedAccounts(before: BexStorageView, after: BexStorageView): Array<{ origin: string; accounts: string[] }> {
  const origins = new Set([...Object.keys(before.permissions), ...Object.keys(after.permissions)])
  const changes: Array<{ origin: string; accounts: string[] }> = []
  for (const origin of origins) {
    const previous = visibleAccounts(before.permissions[origin], before.state)
    const next = visibleAccounts(after.permissions[origin], after.state)
    if (!sameAccounts(previous, next)) changes.push({ origin, accounts: next })
  }
  return changes
}

function sameAccounts(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((account, index) => account === b[index])
}

function normalizeMetadata(value: unknown): DappMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const metadata = value as Partial<DappMetadata>
  if (typeof metadata.name !== 'string' || !metadata.name) return undefined

  return {
    name: metadata.name.slice(0, 64),
    description: typeof metadata.description === 'string' ? metadata.description.slice(0, 256) : '',
    url: typeof metadata.url === 'string' ? metadata.url.slice(0, 2048) : '',
    icons: Array.isArray(metadata.icons)
      ? metadata.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 1)
      : [],
  }
}
