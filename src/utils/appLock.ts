// The app lock's PIN: how it is stored and how wrong tries are slowed down. The lock is a gate in
// the interface, not encryption: the stored seed phrase is as readable with it as without.
import { binToHex, hexToBin } from '@bitauth/libauth'

// What is kept of a PIN: never the PIN, though so few digits can be found from this by trying them all
export interface PinRecord {
  salt: string
  hash: string
  iterations: number
}

export const pinMinLength = 4
export const pinMaxLength = 8
// slow enough to cost a guesser time, fast enough for a phone to check a PIN without a wait
const pinIterations = 200_000

export function isValidPin(pin: string) {
  return new RegExp(`^\\d{${pinMinLength},${pinMaxLength}}$`).test(pin)
}

async function hashPin(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return binToHex(new Uint8Array(bits))
}

export async function makePinRecord(pin: string): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('Invalid PIN')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await hashPin(pin, salt, pinIterations)
  return { salt: binToHex(salt), hash, iterations: pinIterations }
}

export async function pinMatches(pin: string, record: PinRecord) {
  if (!isValidPin(pin)) return false
  const hash = await hashPin(pin, hexToBin(record.salt), record.iterations)
  return hash === record.hash
}

const freeAttempts = 5
const firstDelayMs = 30_000
const maxDelayMs = 15 * 60_000

// The wait after a wrong PIN: none for the first few, then doubling from half a minute
export function retryDelayMs(failedAttempts: number) {
  if (failedAttempts < freeAttempts) return 0
  return Math.min(firstDelayMs * 2 ** (failedAttempts - freeAttempts), maxDelayMs)
}
