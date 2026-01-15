import { useWindowSize } from "@vueuse/core";
import { Config } from "mainnet-js";
import { defineStore } from "pinia"
import { ref } from 'vue'
import type { QRCodeAnimationName, DateFormat } from "src/interfaces/interfaces";

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
  const currency = ref("usd" as ("usd" | "eur"));
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
  const hasSeedBackedUp = ref(false as boolean)
  const mintNfts = ref(false);
  const authchains = ref(false);
  const dateFormat = ref<DateFormat>("DD/MM/YY");
  const confirmBeforeSending = ref(false);
  const loadTokenIcons = ref(true);

  // read local storage for stored settings
  const readCurrency = localStorage.getItem("currency");
  if(readCurrency && (readCurrency=="usd" || readCurrency=="eur")) {
    currency.value = readCurrency;
    Config.DefaultCurrency = readCurrency;
  }

  const readUnit = localStorage.getItem("unit");
  if(readUnit && (readUnit=="bch" || readUnit=="sat")) bchUnit.value = readUnit;

  const readHasSeedBackedUp = localStorage.getItem("seedBackedUp");
  if(readHasSeedBackedUp) hasSeedBackedUp.value = readHasSeedBackedUp == "true";

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
    hasSeedBackedUp,
    mintNfts,
    authchains,
    dateFormat,
    confirmBeforeSending,
    loadTokenIcons,
    getAutoApproveState,
    setAutoApproveState,
    clearAutoApproveState,
    decrementAutoApproveRequest,
    isAutoApproveValid  }
})