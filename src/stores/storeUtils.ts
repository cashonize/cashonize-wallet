import { queryAuthHeadTxid } from "src/queryChainGraph";
import { cachedFetch } from "src/utils/cacheUtils";
import type { UtxoI } from "mainnet-js";
import type { BcmrIndexerResponse, BcmrTokenMetadata, TokenList } from "src/interfaces/interfaces";
import { getAllNftTokenBalances, getFungibleTokenBalances, getTokenUtxos } from "src/utils/utils";

export function tokenListFromUtxos(walletUtxos: UtxoI[]) {
  const tokenUtxos = getTokenUtxos(walletUtxos);
  const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
  const nftsResult = getAllNftTokenBalances(tokenUtxos);
  const arrayTokens: TokenList = [];
  for (const tokenId of Object.keys(fungibleTokensResult)) {
    const fungibleTokenAmount = fungibleTokensResult[tokenId]
    if(!fungibleTokenAmount) continue // should never happen
    arrayTokens.push({ tokenId, amount: fungibleTokenAmount });
  }
  for (const tokenId of Object.keys(nftsResult)) {
    const utxosNftTokenid = tokenUtxos.filter((val) =>val.token?.tokenId === tokenId);
    arrayTokens.push({ tokenId, nfts: utxosNftTokenid });
  }
  return arrayTokens
}

export async function importBcmrRegistries(
  tokenList: TokenList,
  fetchNftInfo: boolean,
  bcmrIndexer: string,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
) {
  const metadataPromises = [];
  for (const item of tokenList) {
    if('nfts' in item && (fetchNftInfo || Object.keys(item.nfts).length == 1)) {
      const listCommitments = item.nfts.map(nftItem => nftItem.token?.commitment)
      const uniqueCommitments = new Set(listCommitments);
      for(const nftCommitment of uniqueCommitments) {
        const nftEndpoint = nftCommitment ? nftCommitment : "empty"
        const metadataPromise = cachedFetch(`${bcmrIndexer}/tokens/${item.tokenId}/${nftEndpoint}/`);
        metadataPromises.push(metadataPromise);
      }
    } else {
      const metadataPromise = cachedFetch(`${bcmrIndexer}/tokens/${item.tokenId}/`);
      metadataPromises.push(metadataPromise);
    }
  }
  // MetadataPromises promises can be rejected in 'cachedFetch', the function should still return all fulfilled promises
  // so we use Promise.allSettled and handle the fulfilled results
  const resolveMetadataPromises = Promise.allSettled(metadataPromises);
  const resultsMetadata = await resolveMetadataPromises;
  const registries = bcmrRegistries ?? {};
  for(const settledResult of resultsMetadata) {
    const response = settledResult.status == "fulfilled" ? settledResult.value : undefined;
    if(response?.status == 200) {
      const jsonResponse:BcmrIndexerResponse = await response.json();
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
  return registries;
}

export async function updateTokenListWithAuthUtxos(
  tokenList: TokenList, chaingraphUrl: string, tokenUtxos: UtxoI[]
) {
  const copyTokenList = [...tokenList]
  // get all authHeadTxIds in parallel
  const authHeadTxIdPromises: Promise<string | undefined>[] = [];
  for (const token of tokenList){
    const fetchAuthHeadPromise = queryAuthHeadTxid(token.tokenId, chaingraphUrl)
    authHeadTxIdPromises.push(fetchAuthHeadPromise)
  }
  const authHeadTxIdResults = await Promise.all(authHeadTxIdPromises);
  if(authHeadTxIdResults.includes(undefined)) console.error("ChainGraph instance not returning all authHeadTxIds")
  // check if any tokenUtxo of category is the authUtxo for that category
  copyTokenList.forEach((token, index) => {
    const authHeadTxId = authHeadTxIdResults[index];
    const filteredTokenUtxos = tokenUtxos.filter(
      (tokenUtxo) => tokenUtxo.token?.tokenId === token.tokenId
    );
    const authUtxo = filteredTokenUtxos.find(utxo => utxo.txid == authHeadTxId && utxo.vout == 0);
    if(authUtxo) token.authUtxo = authUtxo;
  })
  return copyTokenList
}