import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import { Wallet, TestNetWallet, BaseWallet, Config, BalanceResponse, UtxoI, TxI } from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import type { TokenList, bcmrIndexerResponse, bcmrTokenMetadata } from "../interfaces/interfaces"
import { useSettingsStore } from './settingsStore'
import { queryAuthHeadTxid } from "../queryChainGraph"
import { getAllNftTokenBalances, getFungibleTokenBalances } from "src/utils/utils"
import { TransactionHistoryItem } from "mainnet-js/dist/module/history/interface"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
Config.UseLocalStorageCache = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

export const useStore = defineStore('store', () => {
  // Wallet State
  const wallet = ref(null as (Wallet | TestNetWallet | null));
  const balance = ref(undefined as (BalanceResponse | undefined));
  const maxAmountToSend = ref(undefined as (BalanceResponse | undefined));
  const network = computed(() => wallet.value?.network == "mainnet" ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? settingsStore.explorerMainnet : settingsStore.explorerChipnet);
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const bcmrRegistries = ref({} as (Record<string, bcmrTokenMetadata>));
  const nrBcmrRegistries = computed(() => bcmrRegistries.value ? Object.keys(bcmrRegistries.value) : undefined);
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)
  const history = ref(undefined as (undefined | TransactionHistoryItem[]));
  const reloadHistory = ref(true);
  const currentBlockHeight = ref(0);

  async function updateTokenList(){
    if(!wallet.value) return // should never happen
    const tokenUtxos = await wallet.value.getTokenUtxos();
    const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos, settingsStore.featuredTokens);
    const nftsResult = getAllNftTokenBalances(tokenUtxos);
    if(!fungibleTokensResult || !nftsResult) return // should never happen
    const arrayTokens:TokenList = [];
    for (const tokenId of Object.keys(fungibleTokensResult)) {
      arrayTokens.push({ tokenId, amount: fungibleTokensResult[tokenId] });
    }
    for (const tokenId of Object.keys(nftsResult)) {
      const utxosNftTokenid = tokenUtxos.filter((val) =>val.token?.tokenId === tokenId);
      arrayTokens.push({ tokenId, nfts: utxosNftTokenid });
    }

    // const featuredTokenList = arrayTokens.filter(token => settingsStore.featuredTokens.includes(token.tokenId));
    // const otherTokenList = arrayTokens.filter(token => !settingsStore.featuredTokens.includes(token.tokenId));

    tokenList.value = arrayTokens; // [...featuredTokenList, ...otherTokenList];
    const catgeories = Object.keys({...fungibleTokensResult, ...nftsResult})
    return catgeories;
  }

  // Import onchain resolved BCMRs
  async function importRegistries(tokenList: TokenList, fetchNftInfo: boolean) {
    const metadataPromises = [];
    for (const item of tokenList) {
      if('nfts' in item && (fetchNftInfo || Object.keys(item.nfts).length == 1)) {
        const listCommitments = item.nfts.map(nftItem => nftItem.token?.commitment)
        const uniqueCommitments = new Set(listCommitments);
        for(const nftCommitment of uniqueCommitments) {
          const nftEndpoint = nftCommitment ? nftCommitment : "empty"
          const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/${nftEndpoint}/`);
          metadataPromises.push(metadataPromise);
        }
      } else {
        const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/`);
        metadataPromises.push(metadataPromise);
      }
    }
    const resolveMetadataPromsises = Promise.all(metadataPromises);
    const resultsMetadata = await resolveMetadataPromsises;
    const registries = bcmrRegistries.value ?? {};
    for await(const response of resultsMetadata) {
      if(response?.status != 404) {
        const jsonResponse:bcmrIndexerResponse = await response.json();
        const tokenId = jsonResponse?.token?.category
        if(jsonResponse?.type_metadata) {
          const nftEndpoint = response.url.split("/").at(-2) as string;
          const commitment = nftEndpoint != "empty"? nftEndpoint : "";
          if(!registries[tokenId]) registries[tokenId] = jsonResponse;
          if(!registries[tokenId]?.nfts) registries[tokenId].nfts = {}
          registries[tokenId].nfts[commitment] = jsonResponse?.type_metadata
        } else {
          if(!registries[tokenId]) registries[tokenId] = jsonResponse;
        }
      }
    }
    bcmrRegistries.value = registries
  }

  async function hasPreGenesis(){
    plannedTokenId.value = undefined;
    const walletUtxos = await wallet.value?.getAddressUtxos();
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    plannedTokenId.value = preGenesisUtxo?.txid ?? "";
  }

  async function fetchAuthUtxos(){
    if(!wallet.value) return // should never happen
    if(!tokenList.value?.length) return
    const copyTokenList = [...tokenList.value]
    const authHeadTxIdPromises: Promise<string>[] = [];
    // get all tokenUtxos & authHeadTxIds
    const tokenUtxosPromise: Promise<UtxoI[]> = wallet.value.getTokenUtxos();
    for (const token of tokenList.value){
      const fetchAuthHeadPromise = queryAuthHeadTxid(token.tokenId, settingsStore.chaingraph)
      authHeadTxIdPromises.push(fetchAuthHeadPromise)
    }
    const authHeadTxIdResults = await Promise.all(authHeadTxIdPromises);
    const tokenUtxosResult = await tokenUtxosPromise;
    // check if any tokenUtxo of category is the authUtxo for that category
      tokenList.value.forEach((token, index) => {
      const authHeadTxId = authHeadTxIdResults[index];
      const filteredTokenUtxos = tokenUtxosResult.filter(
        (tokenUtxos) => tokenUtxos.token?.tokenId === token.tokenId
      );
      const authUtxo = filteredTokenUtxos.find(utxo => utxo.txid == authHeadTxId && utxo.vout == 0);
      if(authUtxo) copyTokenList[index].authUtxo = authUtxo;
    })
    tokenList.value = copyTokenList;
  }

  return { wallet, balance, maxAmountToSend, network, explorerUrl, tokenList, updateTokenList, hasPreGenesis, fetchAuthUtxos, plannedTokenId, bcmrRegistries, nrBcmrRegistries, importRegistries, history, shouldReloadHistory: reloadHistory, currentBlockHeight }
})