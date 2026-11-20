// The WC2-BCH wire form of a request's params: libauth's stringify format, with a Uint8Array as
// "<Uint8Array: 0x…>" and a bigint as "<bigint: …n>", which the wallet's schemas parse back. The
// provider applies it, so a dApp passes its libauth objects as it does to a WalletConnect
// connector, and params already in that form pass through unchanged.
export function toWireJson(value: unknown): unknown {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return `<bigint: ${item}n>`
    if (item instanceof Uint8Array) {
      return `<Uint8Array: 0x${Array.from(item, byte => byte.toString(16).padStart(2, '0')).join('')}>`
    }
    return item
  }))
}
