import { cachedFetch } from "src/utils/cacheUtils";
import type { Utxo } from "mainnet-js";
import type { BcmrTokenMetadata, TokenList } from "src/interfaces/interfaces";
import { getAllNftTokenBalances, getFungibleTokenBalances, getTokenUtxos } from "src/utils/utils";
import { outpointOf, spendableFromUtxos, type ReservedUtxos } from "src/utils/wallet/reservedUtxos";
import { BcmrIndexerResponseSchema } from "src/utils/zodValidation";
import { parseNft, type NftParseInfo, type ParseResult } from "src/parsing/nftParsing"
import { utxoToLibauthOutput } from "src/parsing/utxoConverter"
import { invokeExtensions } from "src/parsing/extensions/index"
import { createElectrumAdapter } from "src/parsing/electrumAdapter"
import type { IdentitySnapshot } from "src/parsing/bcmr-v2.schema"

// A fungible entry says what the wallet can spend of a category and, apart from it, what its held
// back coins carry: the list shows the whole holding, the way the wallet page shows its balance
// and its held back part, and a send is measured against the spendable part alone. Of the held
// back part, what rides on an identity's UTXO is the reserve, supply never issued, which the
// portfolio leaves out of a total. A category held back entirely is listed with nothing to spend.
// An NFT is not a balance, so a held back one is still listed, and refused when a send names it.
export function tokenListFromUtxos(walletUtxos: Utxo[], reservedUtxos: ReservedUtxos = {}) {
  const tokenUtxos = getTokenUtxos(walletUtxos);
  const heldBalances = getFungibleTokenBalances(tokenUtxos);
  const spendableBalances = getFungibleTokenBalances(spendableFromUtxos(tokenUtxos, reservedUtxos));
  const reserveBalances = getFungibleTokenBalances(tokenUtxos.filter(utxo => reservedUtxos[outpointOf(utxo)] === 'auth'));
  const nftsResult = getAllNftTokenBalances(tokenUtxos);
  const arrayTokens: TokenList = [];
  for (const category of Object.keys(heldBalances)) {
    const held = heldBalances[category] ?? 0n;
    if (!held) continue; // should never happen
    const amount = spendableBalances[category] ?? 0n;
    const heldBack = held - amount;
    const inReserve = reserveBalances[category] ?? 0n;
    arrayTokens.push({
      category,
      amount,
      ...(heldBack ? { heldBack } : {}),
      ...(inReserve ? { inReserve } : {}),
    });
  }
  for (const category of Object.keys(nftsResult)) {
    const utxosNftCategory = tokenUtxos.filter((val) =>val.token?.category === category);
    arrayTokens.push({ category, nfts: utxosNftCategory });
  }
  return arrayTokens
}

// The token metadata endpoints. The indexer indexes token identities only, keyed by category, so
// this is not a way to name a non-token identity: the identities page reads those from their own
// registries.
export async function fetchTokenMetadata(
  tokenList: TokenList,
  fetchNftInfo: boolean,
  tokenMetadataIndexer: string,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
) {
  const metadataPromises = [];
  for (const item of tokenList) {
    if('nfts' in item && (fetchNftInfo || Object.keys(item.nfts).length == 1)) {
      const listCommitments = item.nfts.map(nftItem => nftItem.token?.nft?.commitment)
      const uniqueCommitments = new Set(listCommitments);
      for(const nftCommitment of uniqueCommitments) {
        const nftEndpoint = nftCommitment ? nftCommitment : "empty"
        const metadataPromise = cachedFetch(`${tokenMetadataIndexer}/tokens/${item.category}/${nftEndpoint}/`);
        metadataPromises.push(metadataPromise);
      }
    } else {
      const metadataPromise = cachedFetch(`${tokenMetadataIndexer}/tokens/${item.category}/`);
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
      // Invalid metadata is skipped without a user-facing toast: metadata is cosmetic
      // enrichment fetched in the background, and the token displays with the
      // category-hex fallback either way
      const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
      if (!parseResult.success) {
        console.error(`BCMR indexer response validation error for URL ${response.url}: ${parseResult.error.message}`);
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
  tokenMetadataIndexer: string,
  bcmrRegistries: Record<string, BcmrTokenMetadata> | undefined
) {
  const nftEndpoint = commitment || "empty";
  const res = await cachedFetch(`${tokenMetadataIndexer}/tokens/${category}/${nftEndpoint}/`);
  if (res.status !== 200) return bcmrRegistries ?? {};
  const jsonResponse = await res.json();
  const parseResult = BcmrIndexerResponseSchema.safeParse(jsonResponse);
  if (!parseResult.success) {
    console.error(`BCMR indexer response validation error for URL ${res.url}: ${parseResult.error.message}`);
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

export async function parseNftCommitment(
  utxo: Utxo,
  metadata: BcmrTokenMetadata | undefined,
  provider: Parameters<typeof createElectrumAdapter>[0],
  networkPrefix: string,
): Promise<ParseResult | undefined> {
  if (!metadata?.token.nfts?.parse || metadata.nft_type !== 'parsable') return undefined;

  const parse = metadata.token.nfts.parse;
  if (!('bytecode' in parse)) return undefined;

  const parseInfo: NftParseInfo = {
    bytecode: parse.bytecode,
    types: parse.types,
    fields: metadata.token.nfts.fields,
  };

  let libauthOutput = utxoToLibauthOutput(utxo);

  // If the metadata has extensions, invoke them to modify the UTXO before parsing
  if (metadata.extensions) {
    try {
      const identitySnapshot: IdentitySnapshot = {
        name: metadata.name,
        extensions: metadata.extensions,
      };
      const electrumClient = createElectrumAdapter(provider);
      libauthOutput = await invokeExtensions(
        libauthOutput,
        identitySnapshot,
        electrumClient,
        networkPrefix,
      );
    } catch (error) {
      console.error("Extension invocation failed, parsing unmodified UTXO:", error);
    }
  }

  return parseNft(libauthOutput, parseInfo);
}
