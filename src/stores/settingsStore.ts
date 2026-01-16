import { useWindowSize } from "@vueuse/core";
import { Config } from "mainnet-js";
import { defineStore } from "pinia"
import { ref } from 'vue'
import { BitpayRatesSchema } from "src/utils/zodValidation";
import type { QRCodeAnimationName, DateFormat, ExchangeRateProvider, Currency } from "src/interfaces/interfaces";
import { CurrencySymbols } from "src/interfaces/interfaces";

const defaultExplorerMainnet = "https://blockchair.com/bitcoin-cash/transaction";
const defaultExplorerChipnet = "https://chipnet.chaingraph.cash/tx";
const defaultElectrumMainnet = "electrum.imaginary.cash"
const defaultElectrumChipnet = "chipnet.bch.ninja"
const defaultChaingraph = "https://gql.chaingraph.pat.mn/v1/graphql";
const dafaultIpfsGateway = "https://w3s.link/ipfs/";

const { width,height } = useWindowSize();
const isDesktop = (process.env.MODE == "electron");
const isMobileDevice = width.value / height.value < 1.5

export const useSettingsStore = defineStore('settingsStore', () => {
  // Global settings
  const currency = ref<Currency>("usd");
  const bchUnit = ref("bch" as ("bch" | "sat"));
  const explorerMainnet = ref(defaultExplorerMainnet);
  const explorerChipnet = ref(defaultExplorerChipnet);
  const electrumServerMainnet = ref(defaultElectrumMainnet);
  const electrumServerChipnet = ref(defaultElectrumChipnet);
  const chaingraph = ref(defaultChaingraph);
  const ipfsGateway = ref(dafaultIpfsGateway);
  const darkMode  = ref(false);
  const showFiatValueHistory = ref(true);
  const tokenBurn = ref(false);
  const showCauldronSwap = ref(false);
  const qrScan = ref(true);
  const featuredTokens = ref([] as string[]);
  const hasInstalledPWA = ref(false as boolean);
  const qrAnimation = ref("MaterializeIn" as QRCodeAnimationName | 'None')
  const hasPlayedAnimation = ref(false as boolean)
  // Per-wallet backup status: 'verified' (passed backup test), 'imported' (restored via seed), 'none' (needs backup)
  // Stored in localStorage as JSON: { "walletName": "verified", ... }
  const walletBackupStatus = ref<Record<string, 'verified' | 'imported' | 'none'>>({})

  // Per-wallet metadata (creation date, etc.)
  // Stored in localStorage as JSON: { "walletName": { createdAt: "2025-01-16T..." }, ... }
  interface WalletMetadata {
    createdAt?: string; // ISO date string
  }
  const walletMetadata = ref<Record<string, WalletMetadata>>({})
  const mintNfts = ref(false);
  const authchains = ref(false);
  const dateFormat = ref<DateFormat>("DD/MM/YY");
  const confirmBeforeSending = ref(true);
  const loadTokenIcons = ref(true);
  const exchangeRateProvider = ref<ExchangeRateProvider>("default");

  // read local storage for stored settings
  const readCurrency = localStorage.getItem("currency");
  if(readCurrency && readCurrency in CurrencySymbols) {
    currency.value = readCurrency as Currency;
    Config.DefaultCurrency = readCurrency;
  }

  const readUnit = localStorage.getItem("unit");
  if(readUnit && (readUnit=="bch" || readUnit=="sat")) bchUnit.value = readUnit;

  // Load per-wallet backup status and migrate from old 'seedBackedUp' key if needed
  const readWalletBackupStatus = localStorage.getItem("walletBackupStatus");
  if (readWalletBackupStatus) {
    try {
      walletBackupStatus.value = JSON.parse(readWalletBackupStatus);
    } catch { /* ignore parse errors */ }
  }
  // Migration: convert old global 'seedBackedUp' to per-wallet status for 'mywallet'
  const oldSeedBackedUp = localStorage.getItem("seedBackedUp");
  if (oldSeedBackedUp === "true" && !walletBackupStatus.value["mywallet"]) {
    walletBackupStatus.value["mywallet"] = "verified";
    localStorage.setItem("walletBackupStatus", JSON.stringify(walletBackupStatus.value));
    localStorage.removeItem("seedBackedUp");
  } else if (oldSeedBackedUp !== null) {
    // Clean up old key even if it was "false"
    localStorage.removeItem("seedBackedUp");
  }

  // Load per-wallet metadata
  const readWalletMetadata = localStorage.getItem("walletMetadata");
  if (readWalletMetadata) {
    try {
      walletMetadata.value = JSON.parse(readWalletMetadata);
    } catch { /* ignore parse errors */ }
  }

  const readFiatValueHistory = localStorage.getItem("fiatValueHistory");
  if(readFiatValueHistory) showFiatValueHistory.value = readFiatValueHistory == "true";

  const readQrScan = localStorage.getItem("qrScan");
  if(!readQrScan && (isDesktop || !isMobileDevice)) qrScan.value = false;
  if(readQrScan) qrScan.value = readQrScan == "true";

  const readMintNfts = localStorage.getItem("mintNfts");
  if(readMintNfts) mintNfts.value = readMintNfts == "true";

  const readQrAnimation = localStorage.getItem("qrAnimation");
  if(readQrAnimation) qrAnimation.value = readQrAnimation as QRCodeAnimationName | 'None';

  const readDarkMode = localStorage.getItem("darkMode");
  if(readDarkMode == "true"){
    document.body.classList.add("dark");
    darkMode.value = true;
  }
  const prefersDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches
  if(readDarkMode == null && prefersDarkMode){
    document.body.classList.add("dark");
    darkMode.value = true;
  }

  const readShowSwap = localStorage.getItem("showCauldronSwap");
  if(readShowSwap == "true"){
    showCauldronSwap.value = true;
  }

  const readFeaturedTokens = localStorage.getItem("featuredTokens");
  if(readFeaturedTokens) {
    featuredTokens.value = JSON.parse(readFeaturedTokens) as string[];
  }

  const readHasInstalledPWA = localStorage.getItem("pwaInstalled");
  if(readHasInstalledPWA == "true") hasInstalledPWA.value = true
  // add event listener for pwa app installed, this will trigger on the pwa side
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('pwaInstalled', 'true');
    hasInstalledPWA.value = true
    alert("Using Cashonize as an 'Installed Web app' links the wallet data to the browser usage. Deleting the browser data will also affect the installed web app.");
  });

  const readElectrumMainnet = localStorage.getItem("electrum-mainnet") ?? "";
  if(readElectrumMainnet) electrumServerMainnet.value = readElectrumMainnet

  const readElectrumChipnet = localStorage.getItem("electrum-chipnet") ?? "";
  if(readElectrumChipnet) electrumServerChipnet.value = readElectrumChipnet

  const readChaingraph = localStorage.getItem("chaingraph") ?? "";
  if(readChaingraph) chaingraph.value = readChaingraph
  
  const readIpfsGateway = localStorage.getItem("ipfsGateway") ?? "";
  if(readIpfsGateway) ipfsGateway.value = readIpfsGateway

  const readExplorerMainnet = localStorage.getItem("explorerMainnet") ?? "";
  const readExplorerChipnet = localStorage.getItem("explorerChipnet") ?? "";
  if(readExplorerMainnet) explorerMainnet.value = readExplorerMainnet
  if(readExplorerChipnet) explorerChipnet.value = readExplorerChipnet

  const readAuthchains = localStorage.getItem("authchains") ?? "";
  if(readAuthchains) authchains.value = readAuthchains == "true";

  const readDateFormat = localStorage.getItem("dateFormat");
  if(readDateFormat && (readDateFormat=="DD/MM/YY" || readDateFormat=="MM/DD/YY" || readDateFormat=="YY-MM-DD")) {
    dateFormat.value = readDateFormat;
  }

  const readConfirmBeforeSending = localStorage.getItem("confirmBeforeSending");
  if(readConfirmBeforeSending) confirmBeforeSending.value = readConfirmBeforeSending == "true";

  const readLoadTokenIcons = localStorage.getItem("loadTokenIcons");
  if(readLoadTokenIcons) loadTokenIcons.value = readLoadTokenIcons == "true";

  // --- Exchange rate provider configuration ---

  const BITPAY_RATES_API = "https://bitpay.com/rates/BCH";

  async function getExchangeRateBitpay(symbol: string): Promise<number> {
    const response = await fetch(BITPAY_RATES_API);
    const json = await response.json();
    const parseResult = BitpayRatesSchema.safeParse(json);
    if (!parseResult.success) {
      console.error(`BitPay rates response validation error: ${parseResult.error.message}`);
      throw Error("BitPay rates response validation error");
    }
    const normalizedSymbol = symbol.toLowerCase();
    const match = parseResult.data.data.find(rate => rate.code.toLowerCase() === normalizedSymbol);
    if (match) {
      return match.rate;
    }
    throw Error(`Currency '${symbol}' is not supported.`);
  }

  function configureExchangeRateProvider(provider: ExchangeRateProvider) {
    if (provider === "bitpay") {
      Config.GetExchangeRateFn = getExchangeRateBitpay;
    } else {
      // "default" - use mainnet-js default behavior
      Config.GetExchangeRateFn = undefined;
    }
  }

  const readExchangeRateProvider = localStorage.getItem("exchangeRateProvider");
  if (readExchangeRateProvider && (readExchangeRateProvider === "default" || readExchangeRateProvider === "bitpay")) {
    exchangeRateProvider.value = readExchangeRateProvider;
  }
  configureExchangeRateProvider(exchangeRateProvider.value);

  // --- Auto-approve session logic ---

  interface ForeverAutoApproveSessionReq {
    mode: "forever" 
  }
  interface TimeAutoApproveSessionReq {
    mode: "time",
    timestamp: number | null,
  }
  interface CountAutoApproveSessionReq {
    mode: "count",
    requests: number | null,
  }
  type AutoApproveSessionReq = ForeverAutoApproveSessionReq | TimeAutoApproveSessionReq | CountAutoApproveSessionReq;

  function getAutoApproveState(topic: string) {
    const state = JSON.parse(localStorage.getItem("auto-approve") || "{}");
    return state?.[topic] as AutoApproveSessionReq || null;
  }

  function setAutoApproveState(
    topic: string,
    newState: AutoApproveSessionReq | null
  ) {
    const state = JSON.parse(localStorage.getItem("auto-approve") || "{}");
  
    if (!newState) {
      delete state[topic];
    } else {
      state[topic] = newState;
    }
  
    localStorage.setItem("auto-approve", JSON.stringify(state));
  }
  

  function clearAutoApproveState(topic: string) {
    setAutoApproveState(topic, null);
  }

  function decrementAutoApproveRequest(topic: string): number | null {
    const current = getAutoApproveState(topic);
    if(!current || current.mode != 'count' || typeof current.requests !== "number"){
      throw new Error("Invalid auto-approve state");
    }

    current.requests = Math.max(0, current.requests - 1);
    setAutoApproveState(topic, current);

    return current.requests;
  }

  function isAutoApproveValid(topic: string): boolean {
    const current = getAutoApproveState(topic);
    if (!current) return false;

    if (current.mode === "forever") return true;

    const now = Date.now();
    const isTimeValid = Boolean(current.mode === "time" && current.timestamp && now < current.timestamp);
    const hasRequestsLeft = Boolean(current.mode === "count" && current.requests && current.requests > 0);

    return isTimeValid || hasRequestsLeft;
  }


  removeOldCacheData();

  // Helper functions for per-wallet backup status
  function getBackupStatus(walletName: string): 'verified' | 'imported' | 'none' {
    return walletBackupStatus.value[walletName] || 'none';
  }

  function setBackupStatus(walletName: string, status: 'verified' | 'imported' | 'none') {
    if (status === 'none') {
      delete walletBackupStatus.value[walletName];
    } else {
      walletBackupStatus.value[walletName] = status;
    }
    localStorage.setItem("walletBackupStatus", JSON.stringify(walletBackupStatus.value));
  }

  function clearBackupStatus(walletName: string) {
    delete walletBackupStatus.value[walletName];
    localStorage.setItem("walletBackupStatus", JSON.stringify(walletBackupStatus.value));
  }

  // Helper functions for per-wallet metadata
  function getWalletMetadata(walletName: string): WalletMetadata {
    return walletMetadata.value[walletName] || {};
  }

  function setWalletCreatedAt(walletName: string, date: Date = new Date()) {
    if (!walletMetadata.value[walletName]) {
      walletMetadata.value[walletName] = {};
    }
    walletMetadata.value[walletName].createdAt = date.toISOString();
    localStorage.setItem("walletMetadata", JSON.stringify(walletMetadata.value));
  }

  function clearWalletMetadata(walletName: string) {
    delete walletMetadata.value[walletName];
    localStorage.setItem("walletMetadata", JSON.stringify(walletMetadata.value));
  }

  function removeOldCacheData(){
    // remove tx- and header- keys from localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('tx-') || key.startsWith('header-')) localStorage.removeItem(key);
    });
  }

  return {
    currency,
    bchUnit,
    explorerMainnet,
    explorerChipnet,
    electrumServerMainnet,
    electrumServerChipnet,
    chaingraph,
    ipfsGateway,
    darkMode,
    showFiatValueHistory,
    tokenBurn,
    showCauldronSwap,
    qrScan,
    qrAnimation,
    hasPlayedAnimation,
    featuredTokens,
    hasInstalledPWA,
    getBackupStatus,
    setBackupStatus,
    clearBackupStatus,
    getWalletMetadata,
    setWalletCreatedAt,
    clearWalletMetadata,
    mintNfts,
    authchains,
    dateFormat,
    confirmBeforeSending,
    loadTokenIcons,
    exchangeRateProvider,
    configureExchangeRateProvider,
    getAutoApproveState,
    setAutoApproveState,
    clearAutoApproveState,
    decrementAutoApproveRequest,
    isAutoApproveValid  }
})