import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import { Wallet, TestNetWallet, BaseWallet, Config, BalanceResponse, UtxoI } from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import type { TokenList, bcmrIndexerResponse } from "../interfaces/interfaces"
import { useSettingsStore } from './settingsStore'
import { queryAuthHead } from "../queryChainGraph"
import { getAllNftTokenBalances, getFungibleTokenBalances } from "src/utils/utils"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const explorerUrlMainnet = "https://explorer.bitcoinunlimited.info";
const explorerUrlChipnet = "https://chipnet.chaingraph.cash";
const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

export const useStore = defineStore('store', () => {
  // Wallet State
  const wallet = ref(null as (Wallet | TestNetWallet | null));
  const balance = ref(undefined as (BalanceResponse | undefined));
  const maxAmountToSend = ref(undefined as (BalanceResponse | undefined));
  const network = computed(() => wallet.value?.network == "mainnet" ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? explorerUrlMainnet : explorerUrlChipnet);
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const bcmrRegistries = ref(undefined as (Record<string, any> | undefined));
  const nrBcmrRegistries = computed(() => bcmrRegistries.value ? Object.keys(bcmrRegistries.value) : undefined);
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)

  async function updateTokenList(){
    if(!wallet.value) return // should never happen
    const tokenUtxos = await wallet.value.getTokenUtxos();
    const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
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
    tokenList.value = arrayTokens;
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
          const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}/${nftEndpoint}`);
          metadataPromises.push(metadataPromise);
        }
      } else {
        const metadataPromise = fetch(`${bcmrIndexer.value}/tokens/${item.tokenId}`);
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
          registries[tokenId] = jsonResponse;
        }
      }
    }
    bcmrRegistries.value = registries
  }

  async function fetchAuthUtxos(){
    if(!wallet.value) return // should never happen
    if(!tokenList.value?.length) return
    const copyTokenList = tokenList.value
    const authHeadTxIdPromises: any[] = [];
    const tokenUtxosPromises: any[] = [];
    for (const token of tokenList.value){
      authHeadTxIdPromises.push(queryAuthHead(token.tokenId, settingsStore.chaingraph))
      tokenUtxosPromises.push(wallet.value.getTokenUtxos(token.tokenId));
    }
    const authHeadTxIdResults: string[] = await Promise.all(authHeadTxIdPromises);
    const tokenUtxosResults: UtxoI[][] = await Promise.all(tokenUtxosPromises);
    tokenUtxosResults.forEach((tokenUtxos, index) => {
      const authHeadTxId = authHeadTxIdResults[index];
      const authUtxo = tokenUtxos.find(utxo => utxo.txid == authHeadTxId && utxo.vout == 0);
      if(authUtxo) copyTokenList[index].authUtxo = authUtxo;
    })
    tokenList.value = copyTokenList;
  }

  return { wallet, balance, maxAmountToSend, network, explorerUrl, tokenList, updateTokenList, fetchAuthUtxos, plannedTokenId, bcmrRegistries, nrBcmrRegistries, importRegistries }
})