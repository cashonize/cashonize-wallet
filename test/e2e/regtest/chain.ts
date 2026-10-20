// The regtest chain of the regtest e2e tests, as the tests see it: the node's RPC, mining, and a
// funder wallet holding the coinbases start.sh mines. The app runs in chipnet mode against this
// chain through proxy.ts, so its bchtest addresses map to bchreg ones here.

import { decodeCashAddress, encodeCashAddress, generateRandomBytes } from '@bitauth/libauth'
import { DefaultProvider, RegTestWallet, SendRequest, TokenGenesisRequest, TokenSendRequest } from 'mainnet-js'

// as env.sh
export const RPC_PORT = 18543
export const FULCRUM_WS_PORT = 60103
export const PROXY_PORT = 60104
export const PROXY_CONTROL_PORT = 60105
export const PROXY_TLS_PORT = 60106
const RPC_AUTH = 'Basic ' + Buffer.from('e2e:e2e').toString('base64')

// The key of env.sh's FUNDER_ADDRESS, a regtest-only key
const FUNDER_WIF = 'cNfsPtqN2bMRS7vH5qd8tR8GMvgXyL5BjnGAKgZ8DYEiCrCCQcP6'
const FUNDER_ADDRESS = 'bchreg:qpttdv3qg2usm4nm7talhxhl05mlhms3ys43u76rn0'

// The server the app is pointed at, its custom chipnet electrum server (proxy instance A)
export const APP_ELECTRUM_SERVER = `ws://127.0.0.1:${PROXY_PORT}`
// Proxy instance B, as a user types a server into the settings form: host:port, reached over wss://
export const SECOND_ELECTRUM_SERVER = `127.0.0.1:${PROXY_TLS_PORT}`

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${RPC_PORT}/`, {
    method: 'POST',
    headers: { Authorization: RPC_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'e2e', method, params }),
  })
  const { result, error } = await response.json() as { result: T, error: { message: string } | null }
  if (error) throw new Error(`${method}: ${error.message}`)
  return result
}

export async function mine(blocks = 1): Promise<void> {
  await rpc('generatetoaddress', [blocks, FUNDER_ADDRESS])
}

// The same script under the regtest prefix: what the node and Fulcrum know an app address by
export function toRegtest(address: string): string {
  return withPrefix(address, 'bchreg')
}

export function toChipnet(address: string): string {
  return withPrefix(address, 'bchtest')
}

function withPrefix(address: string, prefix: 'bchreg' | 'bchtest'): string {
  const decoded = decodeCashAddress(address)
  if (typeof decoded === 'string') throw new Error(decoded)
  const encoded = encodeCashAddress({ prefix, type: decoded.type, payload: decoded.payload })
  if (typeof encoded === 'string') throw new Error(encoded)
  return encoded.address
}

// A fresh chipnet address nobody holds, to pay to
export function randomAddress(type: 'p2pkh' | 'p2pkhWithTokens' = 'p2pkh'): string {
  const encoded = encodeCashAddress({ prefix: 'bchtest', type, payload: generateRandomBytes(20) })
  if (typeof encoded === 'string') throw new Error(encoded)
  return encoded.address
}

let funder: RegTestWallet | undefined
export async function funderWallet(): Promise<RegTestWallet> {
  if (funder) return funder
  DefaultProvider.servers.regtest = [`ws://127.0.0.1:${FULCRUM_WS_PORT}`]
  funder = await RegTestWallet.fromWIF(FUNDER_WIF)
  return funder
}

// Pays an app address (either prefix) and confirms the payment
export async function fund(address: string, satoshis: bigint): Promise<string> {
  const wallet = await funderWallet()
  const { txId } = await wallet.send([new SendRequest({ cashaddr: toRegtest(address), value: satoshis })])
  await mine()
  return txId!
}

export interface TokenOptions {
  amount?: bigint
  nft?: { capability: 'none' | 'mutable' | 'minting', commitment: string }
  value?: bigint
}

// Creates a token category on one coin at an app token address (either prefix) and confirms it,
// returning the category
export async function createToken(tokenAddress: string, { amount, nft, value = 1000n }: TokenOptions): Promise<string> {
  const wallet = await funderWallet()
  const request: ConstructorParameters<typeof TokenGenesisRequest>[0] = { cashaddr: toRegtest(tokenAddress), value }
  if (amount !== undefined) request.amount = amount
  if (nft) request.nft = { capability: nft.capability, commitment: nft.commitment }
  const { categories } = await wallet.tokenGenesis(new TokenGenesisRequest(request))
  await mine()
  const category = categories?.[0]
  if (!category) throw new Error('the genesis returned no category')
  return category
}

// Pays an app token address `coins` separate coins of one new category, `amount` tokens each,
// in one confirmed transaction, returning the category
export async function fundTokenCoins(tokenAddress: string, coins: number, amount: bigint): Promise<string> {
  const wallet = await funderWallet()
  const category = await createToken(wallet.tokenaddr, { amount: amount * BigInt(coins) })
  const requests = Array.from({ length: coins }, () => new TokenSendRequest({
    cashaddr: toRegtest(tokenAddress), category, amount, value: 1000n,
  }))
  await wallet.send(requests)
  await mine()
  return category
}

export interface DecodedTransaction {
  vin: { txid: string, vout: number }[]
  vout: { value: number, scriptPubKey: { addresses?: string[] }, tokenData?: { category: string, amount: string, nft?: { capability: string, commitment: string } } }[]
}

export async function decodedTransaction(txid: string): Promise<DecodedTransaction> {
  return rpc<DecodedTransaction>('getrawtransaction', [txid, 1])
}

// The token data of the coins a transaction spends, read from the transactions that made them
export async function spentTokenCoins(txid: string) {
  return (await spentCoins(txid)).map(coin => coin.tokenData)
}

// The coins a transaction spends, as the transactions that made them have them
export async function spentCoins(txid: string) {
  const transaction = await decodedTransaction(txid)
  return Promise.all(transaction.vin.map(async input => {
    const previous = await decodedTransaction(input.txid)
    return previous.vout[input.vout]!
  }))
}
