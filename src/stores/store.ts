import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import { Wallet, TestNetWallet, BaseWallet, Config, BalanceResponse, UtxoI } from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import type { TokenList, bcmrIndexerResponse } from "../interfaces/interfaces"
import { useSettingsStore } from './settingsStore'
import { queryAuthHeadTxid } from "../queryChainGraph"
import { getAllNftTokenBalances, getFungibleTokenBalances } from "src/utils/utils"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

export const featuredTokens = [
  "36546e4062a1cfd070a4a8d8ff9db18aae4ddf8d9ac9a4fa789314d108b49797"
];

export const useStore = defineStore('store', () => {
  // Wallet State
  const wallet = ref(null as (Wallet | TestNetWallet | null));
  const balance = ref(undefined as (BalanceResponse | undefined));
  const maxAmountToSend = ref(undefined as (BalanceResponse | undefined));
  const network = computed(() => wallet.value?.network == "mainnet" ? "mainnet" : "chipnet")
  const explorerUrl = computed(() => network.value == "mainnet" ? settingsStore.explorerMainnet : settingsStore.explorerChipnet);
  const tokenList = ref(null as (TokenList | null))
  const plannedTokenId = ref(undefined as (undefined | string));
  const bcmrRegistries = ref(undefined as (Record<string, any> | undefined));
  const nrBcmrRegistries = computed(() => bcmrRegistries.value ? Object.keys(bcmrRegistries.value) : undefined);
  const bcmrIndexer = computed(() => network.value == 'mainnet' ? defaultBcmrIndexer : defaultBcmrIndexerChipnet)

  async function updateTokenList(){
    if(!wallet.value) return // should never happen
    const tokenUtxos = await wallet.value.getTokenUtxos();
    const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos, featuredTokens);
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

  return { wallet, balance, maxAmountToSend, network, explorerUrl, tokenList, updateTokenList, hasPreGenesis, fetchAuthUtxos, plannedTokenId, bcmrRegistries, nrBcmrRegistries, importRegistries }
})