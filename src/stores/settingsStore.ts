import { useWindowSize } from "@vueuse/core";
import { Config } from "mainnet-js";
import { defineStore } from "pinia"
import { ref } from 'vue'

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
  const qrScan = ref(true);
  const featuredTokens = ref([] as string[]);
  const hasSeedBackedUp = ref(false as boolean)

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

  const readFeaturedTokens = localStorage.getItem("featuredTokens");
  if(readFeaturedTokens) {
    featuredTokens.value = JSON.parse(readFeaturedTokens) as string[];
  }

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

  // --- Auto-approve session logic ---

  interface AutoApproveSessionReq {
    mode: "forever" | "count" | "time",
    requests?: number,
    timestamp?: number
  }

  function getAutoApproveState(topic: string) {
    const state = JSON.parse(localStorage.getItem("auto-approve") || "{}");
    return state?.[topic] as AutoApproveSessionReq || null;
  }

  function setAutoApproveState(
    topic: string,
    newState: { mode: "forever" | "count" | "time", requests?: number, timestamp?: number } | null
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
    if (!current || typeof current.requests !== "number") return null;

    current.requests = Math.max(0, current.requests - 1);
    setAutoApproveState(topic, current);

    return current.requests;
  }

  function isAutoApproveValid(topic: string): boolean {
    const current = getAutoApproveState(topic);
    if (!current) return false;

    if (current.mode === "forever") return true;

    const now = Date.now();
    const isTimeValid = !current.timestamp || now < current.timestamp;
    const hasRequestsLeft = current.requests === undefined || current.requests > 0;

    return isTimeValid && hasRequestsLeft;
  }


  removeOldCacheData();

  function removeOldCacheData(){
    // remove tx- and header- keys from local storage
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
    qrScan,
    featuredTokens,
    hasSeedBackedUp,
    getAutoApproveState,
    setAutoApproveState,
    clearAutoApproveState,
    decrementAutoApproveRequest,
    isAutoApproveValid  }
})