import { queryAuthHeadTxid } from "src/queryChainGraph";
import { cachedFetch } from "src/utils/cacheUtils";
import type { Utxo } from "mainnet-js";
import type { BcmrTokenMetadata, TokenList } from "src/interfaces/interfaces";
import { getAllNftTokenBalances, getFungibleTokenBalances, getTokenUtxos } from "src/utils/utils";
import { displayAndLogError } from "src/utils/errorHandling";
import { BcmrIndexerResponseSchema } from "src/utils/zodValidation";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function tokenListFromUtxos(walletUtxos: Utxo[]) {
  const tokenUtxos = getTokenUtxos(walletUtxos);
  const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
  const nftsResult = getAllNftTokenBalances(tokenUtxos);
  const arrayTokens: TokenList = [];
  for (const category of Object.keys(fungibleTokensResult)) {
    const fungibleTokenAmount = fungibleTokensResult[category]
    if(!fungibleTokenAmount) continue // should never happen
    arrayTokens.push({ category, amount: fungibleTokenAmount });
  }
  for (const category of Object.keys(nftsResult)) {
    const utxosNftCategory = tokenUtxos.filter((val) =>val.token?.category === category);
    arrayTokens.push({ category, nfts: utxosNftCategory });
  }
  return arrayTokens
}

export async function fetchTokenMetadata(
  tokenList: TokenList,
  fetchNftInfo: boolean,
  bcmrIndexer: string,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
) {
  const metadataPromises = [];
  for (const item of tokenList) {
    if('nfts' in item && (fetchNftInfo || Object.keys(item.nfts).length == 1)) {
      const listCommitments = item.nfts.map(nftItem => nftItem.token?.nft?.commitment)
      const uniqueCommitments = new Set(listCommitments);
      for(const nftCommitment of uniqueCommitments) {
        const nftEndpoint = nftCommitment ? nftCommitment : "empty"
        const metadataPromise = cachedFetch(`${bcmrIndexer}/tokens/${item.category}/${nftEndpoint}/`);
        metadataPromises.push(metadataPromise);
      }
    } else {
      const metadataPromise = cachedFetch(`${bcmrIndexer}/tokens/${item.category}/`);
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
      const jsonResponse = await response.json();
      // validate the response to match expected schema
      const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
      if (!parseResult.success) {
        console.error(`BCMR indexer response validation error for URL ${response.url}: ${parseResult.error.message}`);
        displayAndLogError(t('store.errors.bcmrIndexerValidationError'));
        continue;
      }
      const tokenInfoResult = parseResult.data;
      if ('error' in tokenInfoResult) {
        console.error(`Indexer error for URL ${response.url}: ${tokenInfoResult.error}`);
        continue;
      }
      const tokenId = tokenInfoResult.token?.category
      if(tokenInfoResult.type_metadata) {
        const nftEndpoint = response.url.split("/").at(-2) as string;
        const commitment = nftEndpoint != "empty"? nftEndpoint : "";
        if(!registries[tokenId]) registries[tokenId] = tokenInfoResult;
        if(!registries[tokenId]?.nfts) registries[tokenId].nfts = {}
        registries[tokenId].nfts[commitment] = tokenInfoResult.type_metadata
      } else {
        if(!registries[tokenId]) registries[tokenId] = tokenInfoResult;
      }
    }
  }
  return registries;
}

// Fetch NFT metadata for a specific category and commitment
export async function fetchNftMetadata(
  category: string,
  commitment: string,
  bcmrIndexer: string,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
) {
  const nftEndpoint = commitment || "empty";
  const res = await cachedFetch(`${bcmrIndexer}/tokens/${category}/${nftEndpoint}/`);
  if (res.status !== 200) return bcmrRegistries ?? {};
  const jsonResponse = await res.json();
  const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
  if (!parseResult.success) {
    console.error(`BCMR indexer response validation error for URL ${res.url}: ${parseResult.error.message}`);
    displayAndLogError(t('store.errors.bcmrIndexerValidationError'));
    return bcmrRegistries ?? {};
  }
  const tokenInfoResult = parseResult.data;
  if ('error' in tokenInfoResult) {
    console.error(`Indexer error for URL ${res.url}: ${tokenInfoResult.error}`);
    return bcmrRegistries ?? {};
  }
  const tokenId = tokenInfoResult.token?.category;
  const registries = bcmrRegistries ?? {};
  if (tokenInfoResult.type_metadata) {
    if (!registries[tokenId]) registries[tokenId] = tokenInfoResult;
    if (!registries[tokenId]?.nfts) registries[tokenId].nfts = {};
    registries[tokenId].nfts[commitment] = tokenInfoResult.type_metadata;
  } else {
    if (!registries[tokenId]) registries[tokenId] = tokenInfoResult;
  }
  return registries;
}

export async function updateTokenListWithAuthUtxos(
  tokenList: TokenList, chaingraphUrl: string, tokenUtxos: Utxo[]
) {
  const copyTokenList = [...tokenList]
  // get all authHeadTxIds in parallel
  const authHeadTxIdPromises: Promise<string>[] = [];
  for (const token of tokenList){
    const fetchAuthHeadPromise = queryAuthHeadTxid(token.category, chaingraphUrl)
    authHeadTxIdPromises.push(fetchAuthHeadPromise)
  }
  const authHeadTxIdSettled = await Promise.allSettled(authHeadTxIdPromises);
  const authHeadTxIdResults = authHeadTxIdSettled.map(result => {
    if (result.status === 'fulfilled') return result.value;
    console.error("ChainGraph query failed:", result.reason);
    return undefined;
  });
  // check if any tokenUtxo of category is the authUtxo for that category
  copyTokenList.forEach((token, index) => {
    const authHeadTxId = authHeadTxIdResults[index];
    const filteredTokenUtxos = tokenUtxos.filter(
      (tokenUtxo) => tokenUtxo.token?.category === token.category
    );
    const authUtxo = filteredTokenUtxos.find(utxo => utxo.txid == authHeadTxId && utxo.vout == 0);
    if(authUtxo) token.authUtxo = authUtxo;
  })
  return copyTokenList
}

