import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import { Wallet, TestNetWallet, BaseWallet, Config, BalanceResponse, UtxoI, Connection, ElectrumNetworkProvider, binToHex, type CancelWatchFn } from "mainnet-js"
import { IndexedDBProvider } from "@mainnet-cash/indexeddb-storage"
import type { TokenList, bcmrIndexerResponse } from "../interfaces/interfaces"
import { queryAuthHeadTxid } from "../queryChainGraph"
import { getAllNftTokenBalances, getFungibleTokenBalances } from "src/utils/utils"
import { convertElectrumTokenData } from "src/utils/utils"
import { Notify } from "quasar";
import { useSettingsStore } from './settingsStore'
import { useWalletconnectStore } from "./walletconnectStore"
import { useCashconnectStore } from "./cashconnectStore"
const settingsStore = useSettingsStore()

// set mainnet-js config
Config.EnforceCashTokenReceiptAddresses = true;
BaseWallet.StorageProvider = IndexedDBProvider;

const defaultBcmrIndexer = 'https://bcmr.paytaca.com/api';
const defaultBcmrIndexerChipnet = 'https://bcmr-chipnet.paytaca.com/api';

const nameWallet = 'mywallet';

export const useStore = defineStore('store', () => {
  const displayView = ref(undefined as (number | undefined));
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

  let cancelWatchBchtxs: undefined | CancelWatchFn;
  let cancelWatchTokenTxs: undefined | CancelWatchFn;

  function changeView(newView: number) {
    displayView.value = newView;
  }

  async function setWallet(newWallet: TestNetWallet){
    changeView(1);
    if(newWallet.network == 'mainnet'){
      const connectionMainnet = new Connection("mainnet", `wss://${settingsStore.electrumServerMainnet}:50004`)
      newWallet.provider = connectionMainnet.networkProvider as ElectrumNetworkProvider 
    }
    wallet.value = newWallet;
    console.time('initweb3wallet');
    console.time('initialize walletconnect and cashconnect');
    await Promise.all([initializeWalletConnect(newWallet), initializeCashConnect(newWallet)]);
    console.timeEnd('initialize walletconnect and cashconnect');
    // fetch bch balance
    console.time('Balance Promises');
    const promiseWalletBalance = wallet.value.getBalance() as BalanceResponse;
    const promiseMaxAmountToSend = wallet.value.getMaxAmountToSend();
    const balancePromises = [promiseWalletBalance,promiseMaxAmountToSend];
    const [resultWalletBalance, resultMaxAmountToSend] = await Promise.all(balancePromises);
    console.timeEnd('Balance Promises');
    // fetch token balance
    console.time('fetch tokenUtxos Promise');
    await updateTokenList();
    console.timeEnd('fetch tokenUtxos Promise');
    balance.value = resultWalletBalance;
    maxAmountToSend.value = resultMaxAmountToSend;
    setUpWalletSubscriptions();
    // get plannedTokenId
    if(!tokenList.value) return // should never happen
    console.time('importRegistries');
    await importRegistries(tokenList.value, false);
    console.timeEnd('importRegistries');
    console.time('planned tokenid');
    await hasPreGenesis()
    console.timeEnd('planned tokenid');
    console.time('fetchAuthUtxos');
    await fetchAuthUtxos();
    console.timeEnd('fetchAuthUtxos');
  }

  async function setUpWalletSubscriptions(){
    cancelWatchBchtxs = wallet.value?.watchBalance(async (newBalance) => {
      const oldBalance = balance.value;
      balance.value = newBalance;
      if(oldBalance?.sat && newBalance?.sat){
        if(oldBalance.sat < newBalance.sat){
          const amountReceived = (newBalance.sat - oldBalance.sat) / 100_000_000
          const unitString = network.value == 'mainnet' ? 'BCH' : 'tBCH'
          Notify.create({
            type: 'positive',
            message: `Received ${amountReceived} ${unitString}`
          })
        }
      }
      maxAmountToSend.value = await wallet.value?.getMaxAmountToSend();
    });
    cancelWatchTokenTxs = wallet.value?.watchAddressTokenTransactions(async(tx) => {
      if(!wallet.value) return // should never happen
      const walletPkh = binToHex(wallet.value.getPublicKeyHash() as Uint8Array);
      const tokenOutputs = tx.vout.filter(voutElem => voutElem.tokenData && voutElem.scriptPubKey.hex.includes(walletPkh));
      const previousTokenList = tokenList.value;
      const listNewTokens:TokenList = []
      // Check if transaction not initiated by user
      const userInputs = tx.vin.filter(vinElem => vinElem.address == wallet.value?.address);
      for(const tokenOutput of tokenOutputs){
        if(!userInputs.length){
          const tokenType = tokenOutput?.tokenData?.nft ? "NFT" : "tokens"
          Notify.create({
            type: 'positive',
            message: `Received new ${tokenType}`
          })
        }
        const tokenId = tokenOutput?.tokenData?.category;
        const isNewTokenItem = !previousTokenList?.find(elem => elem.tokenId == tokenId);
        if(!tokenId && !isNewTokenItem) continue;
        const newTokenItem = convertElectrumTokenData(tokenOutput?.tokenData)
        if(newTokenItem) listNewTokens.push(newTokenItem)
      }
      // Dynamically import tokenmetadata
      await importRegistries(listNewTokens, true);
      await updateTokenList(); 
    });
  }

  async function changeNetwork(newNetwork: 'mainnet' | 'chipnet'){
    // cancel active listeners
    if(cancelWatchBchtxs && cancelWatchTokenTxs){
      cancelWatchBchtxs()
      cancelWatchTokenTxs()
    }
    const walletClass = (newNetwork == 'mainnet')? Wallet : TestNetWallet;
    const newWallet = await walletClass.named(nameWallet);
    setWallet(newWallet);
    localStorage.setItem('network', newNetwork);
    // reset wallet to default state
    balance.value = undefined;
    maxAmountToSend.value = undefined;
    plannedTokenId.value = undefined;
    tokenList.value = null;
    bcmrRegistries.value = undefined;
    changeView(1);
  }

  async function initializeWalletConnect(wallet: Wallet | TestNetWallet) {
    const walletconnectStore = await useWalletconnectStore(wallet as Wallet)
    await walletconnectStore.initweb3wallet();
    const web3wallet = walletconnectStore.web3wallet;
    const walletAddress = wallet.getDepositAddress()
    web3wallet?.on('session_request', async (event) => walletconnectStore.wcRequest(event, walletAddress));
  }

  async function initializeCashConnect(wallet: Wallet | TestNetWallet) {
    // Initialize CashConnect.
    const cashconnectWallet = await useCashconnectStore(wallet);

    // Start the wallet service.
    await cashconnectWallet.cashConnectWallet.start();

    // Monitor the wallet for balance changes.
    wallet.watchBalance(async () => {
      // Convert the network into WC format,
      const chainIdFormatted = wallet.network === 'mainnet' ? 'bch:bitcoincash' : 'bch:bchtest';

      // Invoke wallet state has changed so that CashConnect can retrieve fresh UTXOs (and token balances).
      cashconnectWallet.cashConnectWallet.walletStateHasChanged(chainIdFormatted);
    });
  }

  async function updateTokenList() {
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

  async function fetchTokenInfo(categoryId: string) {
    return await fetch(`${bcmrIndexer.value}/tokens/${categoryId}/`);
  }

  async function hasPreGenesis(){
    plannedTokenId.value = undefined;
    const walletUtxos = await wallet.value?.getAddressUtxos();
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    plannedTokenId.value = preGenesisUtxo?.txid ?? "";
  }

  async function fetchAuthUtxos() {
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

  return {
    nameWallet,
    displayView,
    wallet,
    balance,
    maxAmountToSend,
    network,
    explorerUrl,
    tokenList,
    plannedTokenId,
    bcmrRegistries,
    nrBcmrRegistries,
    changeView,
    setWallet,
    changeNetwork,
    fetchTokenInfo,
    updateTokenList,
    hasPreGenesis,
    fetchAuthUtxos,
    importRegistries
  }
})
