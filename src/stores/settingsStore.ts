import { Config } from "mainnet-js";
import { defineStore } from "pinia"
import { ref } from 'vue'

const defaultExplorerMainnet = "https://blockchair.com/bitcoin-cash/transaction";
const defaultExplorerChipnet = "https://chipnet.chaingraph.cash/tx";
const defaultElectrumMainnet = "electrum.imaginary.cash"
const defaultChaingraph = "https://gql.chaingraph.pat.mn/v1/graphql";
const dafaultIpfsGateway = "https://ipfs.io/ipfs/";

export const useSettingsStore = defineStore('settingsStore', () => {
  // Global settings
  const bchUnit = ref("bch" as ("bch" | "sat"));
  const explorerMainnet = ref(defaultExplorerMainnet);
  const explorerChipnet = ref(defaultExplorerChipnet);
  const electrumServerMainnet = ref(defaultElectrumMainnet);
  const chaingraph = ref(defaultChaingraph);
  const ipfsGateway = ref(dafaultIpfsGateway);
  const darkMode  = ref(false);
  const tokenBurn = ref(false);
  const walletConnect = ref(false);
  const tokenCreation = ref(false);
  const currency = ref("usd" as ("usd" | "eur"));
  const historyUseCurrency = ref(false);

  // read local storage for stored settings
  const readCurrency = localStorage.getItem("currency");
  if(readCurrency && (readCurrency=="usd" || readCurrency=="eur")) {
    currency.value = readCurrency;
    Config.DefaultCurrency = readCurrency;
  }

  const readHistoryUseCurrency = localStorage.getItem("historyUseCurrency");
  if(readHistoryUseCurrency) {
    historyUseCurrency.value = readHistoryUseCurrency==="true";
  }

  const readUnit = localStorage.getItem("unit");
  if(readUnit && (readUnit=="bch" || readUnit=="sat")) bchUnit.value = readUnit;

  const readDarkMode = localStorage.getItem("darkMode");
  if(readDarkMode == "true"){
    document.body.classList.add("dark");
    darkMode.value = true;
  }
  const readTokenBurn = localStorage.getItem("tokenBurn");
  if(readTokenBurn == "true"){
    document.body.classList.add("tokenBurn");
    tokenBurn.value = true;
  }
  const readWalletConnect = localStorage.getItem("walletConnect");
  if(readWalletConnect == "true"){
    document.body.classList.add("walletConnect");
    walletConnect.value = true;
  }
  const readTokenCreation = localStorage.getItem("tokenCreation");
  if(readTokenCreation == "true"){
    document.body.classList.add("tokenCreation");
    tokenCreation.value = true;
  }
  const readElectrumMainnet = localStorage.getItem("electrum-mainnet") ?? "";
  if(readElectrumMainnet) electrumServerMainnet.value = readElectrumMainnet

  const readChaingraph = localStorage.getItem("chaingraph") ?? "";
  if(readChaingraph) chaingraph.value = readChaingraph

  const readIpfsGateway = localStorage.getItem("ipfsGateway") ?? "";
  if(readIpfsGateway) ipfsGateway.value = readIpfsGateway

  const readExplorerMainnet = localStorage.getItem("explorerMainnet") ?? "";
  const readExplorerChipnet = localStorage.getItem("explorerChipnet") ?? "";
  if(readExplorerMainnet) explorerMainnet.value = readExplorerMainnet
  if(readExplorerChipnet) explorerChipnet.value = readExplorerChipnet

  return { bchUnit, explorerMainnet, explorerChipnet, electrumServerMainnet, chaingraph, ipfsGateway, darkMode, tokenBurn, walletConnect, tokenCreation, currency, historyUseCurrency }
})