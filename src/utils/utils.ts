import { decodeBip39Mnemonic, hexToBin } from "@bitauth/libauth"
import { Notify } from "quasar";
import { Wallet, TestNetWallet, HDWallet, TestNetHDWallet, type Utxo, type TransactionHistoryItem } from "mainnet-js"
import type { BcmrTokenMetadata, ElectrumTokenData, TokenDataFT, TokenDataNFT, CurrencyShortNames, DateFormat, WalletType } from "../interfaces/interfaces"
import { type Ref, watch, type WatchStopHandle } from "vue";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function copyToClipboard(copyText:string|undefined){
  if(!copyText) return
  void navigator.clipboard.writeText(copyText);
  Notify.create({
    message: t('common.copied'),
    icon: 'info',
    timeout : 1000,
    color: "grey-6"
  })
}

export function runAsyncVoid(fn: () => Promise<void>) {
  void fn();
}

// Electrum servers are stored as "host" or "host:port", the conventional wss port 50004 applies when none is given
export function electrumWssUrl(server: string): string {
  return server.includes(":") ? `wss://${server}` : `wss://${server}:50004`;
}

// Chaingraph's Hasura API conventionally serves GraphQL at /v1/graphql. Keep
// explicitly supplied paths intact for instances configured differently.
export function chaingraphGraphqlUrl(server: string): string {
  const serverWithScheme = /^https?:\/\//i.test(server) ? server : `https://${server}`;
  const url = new URL(serverWithScheme);
  if (url.pathname === "/") url.pathname = "/v1/graphql";
  else url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function walletTypeFromWalletId(walletId: string): 'single' | 'hd' {
  return walletId.startsWith('hd:') ? 'hd' : 'single';
}

export async function loadWalletFromId(walletId: string, network: 'mainnet' | 'chipnet'): Promise<WalletType> {
  const isHD = walletTypeFromWalletId(walletId) === 'hd';
  if (network === 'mainnet') {
    const wallet = isHD ? await HDWallet.fromId(walletId) : await Wallet.fromId(walletId);
    return wallet;
  }
  const wallet = isHD ? await TestNetHDWallet.fromId(walletId) : await TestNetWallet.fromId(walletId);
  return wallet;
}

// Sanitize untrusted URLs (e.g. from dApp metadata) to prevent protocol abuse.
// Only allows https: in production, plus http://localhost in dev.
export function sanitizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'http:' && import.meta.env.QUASAR_DEV && parsed.hostname === 'localhost') return parsed.href;
  } catch {
    // invalid URL
  }
  return undefined;
}

// Normalize user-entered seed phrases before validation/import
export function normalizeSeedPhrase(seedPhrase: string): string {
  return seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ')
}

// decodeBip39Mnemonic validates word count, wordlist membership, and checksum
export function isValidBip39Mnemonic(seedPhrase: string): boolean {
  const result = decodeBip39Mnemonic(normalizeSeedPhrase(seedPhrase))
  return typeof result !== 'string'
}

export function formatTime(timestamp: number): string {
  // Uses 12-hour format (2:30 PM) for US/UK locales, 24-hour (14:30) for European locales
  // Note: Electron only includes en-US locale, so this always uses 12-hour format there
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Easily readable date like "1 Aug 2026, 23:48"
export function formatReadableDate(timestamp: number): string {
  const day = new Date(timestamp * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${formatTime(timestamp)}`;
}

// Calendar-day label for grouping history rows: Today, Yesterday, or "1 Aug 2026".
// Pending transactions have no timestamp and group under their own header
export function dayLabel(timestamp: number | undefined): string {
  if (!timestamp) return t('history.pending');
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('history.today');
  if (date.toDateString() === yesterday.toDateString()) return t('history.yesterday');
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Date inputs hold local calendar dates (YYYY-MM-DD); compare in local time to match the displayed dates
export function localDayStart(isoDate: string, dayOffset = 0): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day + dayOffset).getTime() / 1000;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return t('relativeTime.secondsAgo', { count: diff });
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return mins === 1 ? t('relativeTime.minuteAgo', { count: mins }) : t('relativeTime.minutesAgo', { count: mins });
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return hours === 1 ? t('relativeTime.hourAgo', { count: hours }) : t('relativeTime.hoursAgo', { count: hours });
  }
  if (diff < 2592000) { // less than 30 days
    const days = Math.floor(diff / 86400);
    return days === 1 ? t('relativeTime.dayAgo', { count: days }) : t('relativeTime.daysAgo', { count: days });
  }
  // months and days
  const months = Math.floor(diff / 2592000);
  const remainingDays = Math.floor((diff % 2592000) / 86400);
  if (remainingDays === 0) {
    return t('relativeTime.monthsAgo', { months });
  }
  return t('relativeTime.monthsDaysAgo', { months, days: remainingDays });
}

// A deadline sits in the future, which the "ago" strings above cannot express. Intl says it in
// both directions and in every locale without a translated string per unit.
export function formatTimeUntil(timestamp: number, locale: string): string {
  const seconds = timestamp - Math.floor(Date.now() / 1000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return relative.format(seconds, 'second');
}

export function formatTimestamp(timestamp: number | undefined, dateFormat: DateFormat, short = false): string {
  if (!timestamp) return "Unconfirmed";
  const date = new Date(timestamp * 1000);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = short ? date.getFullYear().toString().slice(-2) : date.getFullYear().toString();
  // Uses 12-hour format (2:30 PM) for US/UK locales, 24-hour (14:30) for European locales
  // Note: Electron only includes en-US locale, so this always uses 12-hour format there
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  let dateStr: string;
  switch (dateFormat) {
    case 'MM/DD/YY':
      dateStr = `${month}/${day}/${year}`;
      break;
    case 'YY-MM-DD':
      dateStr = `${year}-${month}-${day}`;
      break;
    default: // DD/MM/YY
      dateStr = `${day}/${month}/${year}`;
  }
  return short ? dateStr : `${dateStr} ${time}`;
}

function validateTokenAmountString(tokenAmount: string, decimals: number){
  // Validate the amount format (no separating commas allowed here).
  if (!/^\d*\.?\d*$/.test(tokenAmount)) throw new Error(t('tokenItem.errors.invalidNumberFormat'));

  // Validate if the input can be converted to a number
  const number = parseFloat(tokenAmount);
  if (isNaN(number) || number <= 0) throw new Error(t('tokenItem.errors.enterValidAmount'));

  // check number of decimal places
  const decimalPart = tokenAmount.split('.')[1];
  const decimalPlaces = decimalPart ? decimalPart.length : 0;
  const validInput = decimalPlaces <= decimals
  if(!validInput && !decimals) throw new Error(t('tokenItem.errors.noDecimalsAllowed'));
  if(!validInput) throw new Error(t('tokenItem.errors.maxDecimalsAllowed', { decimals }));
}

// Parses a user-entered token amount into base units.
// Throws a localized error on invalid input; uses string math instead of
// float multiplication so large amounts don't lose precision.
export function parseTokenAmountToBigInt(input: string, decimals: number): bigint {
  const sanitizedInput = input.replace(/,/g, '');
  validateTokenAmountString(sanitizedInput, decimals);
  const [integerPart = '', fractionalPart = ''] = sanitizedInput.split('.');
  return BigInt(integerPart + fractionalPart.padEnd(decimals, '0'));
}

// Inverse of parseTokenAmountToBigInt: turns base units back into a whole-token amount
// string, again with string math so large amounts keep every digit. Trailing zeros are
// stripped, there is no need to show them.
export function formatTokenAmountFromBigInt(baseUnits: bigint, decimals: number): string {
  if (!decimals) return baseUnits.toString();
  const divisor = 10n ** BigInt(decimals);
  const wholePart = baseUnits / divisor;
  const fractionalPart = (baseUnits % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fractionalPart ? `${wholePart}.${fractionalPart}` : `${wholePart}`;
}

export function convertToCurrency(satAmount: bigint, exchangeRate:number) {
  const newFiatValue =  Number(satAmount) * exchangeRate / 100_000_000
  return Number(newFiatValue.toFixed(2));
}

export function formatFiatAmount(amount: number, currency: keyof typeof CurrencyShortNames): string {
  return amount.toLocaleString('en', { style: "currency", currency });
}

// Formats with thousands separators, trailing zeros are stripped (no need to show them in the UI).
export function formatNumber(value: number, maxDecimals: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

export function satsToBch(satoshis: bigint | number) {
  return Number(satoshis) / 100_000_000;
};

export function formatBchAmount(satoshis: number, signed = false, maxDecimals = 5): string {
  const amount = (satoshis / 100_000_000).toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: maxDecimals });
  return signed && satoshis > 0 ? `+${amount}` : amount;
}

export interface TokenChangeChip {
  key: string;
  category: string;
  amountText: string;
  symbol: string;
  negative: boolean;
}

// Tokens like BADGER have both fungibles and NFTs with the same category in user wallets,
// so one token change can yield both a fungible chip and an NFT chip
export function tokenChangeChips(
  transaction: TransactionHistoryItem,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
): TokenChangeChip[] {
  const chips: TokenChangeChip[] = [];
  for (const tokenChange of transaction.tokenAmountChanges) {
    const tokenMetadata = bcmrRegistries?.[tokenChange.category]?.token;
    const symbol = tokenMetadata?.symbol ?? tokenChange.category.slice(0, 8);
    const decimals = tokenMetadata?.decimals ?? 0;
    // Show the fungible change for any nonzero amount. When there is no NFT change either,
    // still show it (as "0") so a token change never renders without a chip.
    if (tokenChange.amount !== 0n || tokenChange.nftAmount === 0n) {
      const amount = Number(tokenChange.amount) / 10 ** decimals;
      chips.push({
        key: tokenChange.category + "-ft",
        category: tokenChange.category,
        amountText: `${amount > 0 ? '+' : ''}${amount.toLocaleString("en-US", { maximumFractionDigits: decimals })}`,
        symbol,
        negative: amount < 0,
      });
    }
    if (tokenChange.nftAmount !== 0n) {
      chips.push({
        key: tokenChange.category + "-nft",
        category: tokenChange.category,
        amountText: `${tokenChange.nftAmount > 0n ? '+' : ''}${tokenChange.nftAmount}`,
        symbol: `${symbol} NFT`,
        negative: tokenChange.nftAmount < 0n,
      });
    }
  }
  return chips;
}

export function getTokenUtxos(utxos:  Utxo[]){
  return utxos.filter((val) =>val.token);
}

export function getAllNftTokenBalances(tokenUtxos: Utxo[]){
  const result:Record<string, number> = {};
  const nftUtxos = tokenUtxos.filter((val) => val.token?.nft?.commitment !== undefined);
  for (const utxo of nftUtxos) {
    if(!utxo.token?.category) continue // should never happen
    result[utxo.token.category] = (result[utxo.token.category] ?? 0) + 1;
  }
  return result
}

export function getFungibleTokenBalances(tokenUtxos: Utxo[]){
  const result:Record<string, bigint> = {};
  const fungiblesUtxos = tokenUtxos.filter((val) => val.token?.amount);
  for (const utxo of fungiblesUtxos) {
    if(!utxo.token?.category) continue  // should never happen
    const category = utxo.token.category;
    result[category] = (result[category] ?? 0n) + utxo.token.amount;
  }
  return result
}

export function getBalanceFromUtxos(utxos: Utxo[]) {
  const bchUtxos = utxos.filter((utxo) => utxo.token === undefined);
  const balanceSats = bchUtxos.reduce((currentBalance: bigint, utxo: Utxo) => currentBalance + utxo.satoshis, 0n);
  return balanceSats
}

export function parseExtendedJson(jsonString: string){
  const uint8ArrayRegex = /^<Uint8Array: 0x(?<hex>[0-9a-f]*)>$/u;
  const bigIntRegex = /^<bigint: (?<bigint>[0-9]*)n>$/;

  return JSON.parse(jsonString, (_key, value) => {
    if (typeof value === "string") {
      const bigintMatch = value.match(bigIntRegex);
      if (bigintMatch?.groups?.bigint !== undefined) {
        return BigInt(bigintMatch.groups.bigint);
      }
      const uint8ArrayMatch = value.match(uint8ArrayRegex);
      if (uint8ArrayMatch?.groups?.hex !== undefined) {
        return hexToBin(uint8ArrayMatch.groups.hex);
      }
    }
    return value;
  })
}

export function convertElectrumTokenData(electrumTokenData: ElectrumTokenData | undefined){
  if(!electrumTokenData) return
  if(electrumTokenData.amount && BigInt(electrumTokenData.amount)){
    const tokenDataFT: TokenDataFT = {
      amount: BigInt(electrumTokenData.amount),
      category: electrumTokenData.category,
    }
    return tokenDataFT
  }
  return {
    category: electrumTokenData.category,
    nfts: [
      {
        token: {
          nft: {
            capability: electrumTokenData.nft?.capability,
            commitment: electrumTokenData.nft?.commitment
          }
        }
      }
    ]
  } as TokenDataNFT
}

export const waitForInitialized = async function(property: Ref<boolean>): Promise<void> {
  // Declare a handle for our stopWatching function here so that it is in-scope.
  let stopWatching: WatchStopHandle | undefined;

  const waitForPromise = new Promise((resolve): void => {
    // Create a watcher on the reactive property and give it a handle so we can unwatch it later.
    // NOTE: We use `immediate: true` to eagerly evaluate when `watch` is first called.
    stopWatching = watch(
      property,
      (newValue) => {
        if (newValue === true) resolve(true);
      },
      { immediate: true },
    );
  });

  // Wait for our promise to resolve.
  await waitForPromise;

  // Stop watching this value.
  // NOTE: This cannot be called inside our watcher as the stopWatching handle won't be instantiated yet.
  if (stopWatching) stopWatching();
};
