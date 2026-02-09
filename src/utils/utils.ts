import { hexToBin } from "@bitauth/libauth"
import { Notify } from "quasar";
import type { Utxo } from "mainnet-js"
import type { ElectrumTokenData, TokenDataFT, TokenDataNFT, CurrencyShortNames, DateFormat } from "../interfaces/interfaces"
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

export function formatTime(timestamp: number): string {
  // Uses 12-hour format (2:30 PM) for US/UK locales, 24-hour (14:30) for European locales
  // Note: Electron only includes en-US locale, so this always uses 12-hour format there
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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

export function convertToCurrency(satAmount: bigint, exchangeRate:number) {
  const newFiatValue =  Number(satAmount) * exchangeRate / 100_000_000
  return Number(newFiatValue.toFixed(2));
}

export function formatFiatAmount(amount: number, currency: keyof typeof CurrencyShortNames): string {
  return amount.toLocaleString('en', { style: "currency", currency });
}

export function satsToBch(satoshis: bigint | number) {
  return Number(satoshis) / 100_000_000;
};

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
    return {
      amount: BigInt(electrumTokenData.amount),
      category: electrumTokenData.category,
    } as TokenDataFT
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
