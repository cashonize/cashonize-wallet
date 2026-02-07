import type { Registry, NftCategory, NftCategoryField } from "./bcmr-v2.schema";
import type { BcmrTokenMetadata } from "src/interfaces/interfaces";

/**
 * Build a synthetic Registry from Paytaca indexer metadata, so getNftParsingInfo/parseNft 
 * can work without fetching the full registry from the /registries/ endpoint.
 */
export function buildSyntheticRegistry(
  categoryId: string,
  metadata: BcmrTokenMetadata
): Registry | undefined {
  const nftsParseInfo = metadata.token.nfts;
  if (!nftsParseInfo?.parse) return undefined;

  // Convert indexer field format to NftCategoryField.
  // The cast is safe: the only difference is exactOptionalPropertyTypes
  // (our interface allows `| undefined` on optional fields, the schema type doesn't).
  const fields: NftCategoryField = {};
  if (nftsParseInfo.fields) {
    for (const [fieldId, fieldDef] of Object.entries(nftsParseInfo.fields)) {
      fields[fieldId] = {
        encoding: fieldDef.encoding as NftCategoryField[string]["encoding"],
        ...(fieldDef.name != null && { name: fieldDef.name }),
        ...(fieldDef.description != null && { description: fieldDef.description }),
      };
    }
  }

  const nftCategory: NftCategory = {
    parse: nftsParseInfo.parse as NftCategory["parse"],
    ...(nftsParseInfo.description != null && { description: nftsParseInfo.description }),
    ...(Object.keys(fields).length > 0 && { fields }),
  };

  const tokenCategory = {
    category: categoryId,
    symbol: metadata.token.symbol,
    nfts: nftCategory,
    ...(metadata.token.decimals != null && { decimals: metadata.token.decimals }),
  };

  const snapshot = {
    name: metadata.name,
    description: metadata.description,
    token: tokenCategory,
    ...(metadata.uris != null && { uris: metadata.uris }),
    ...(metadata.extensions != null && { extensions: metadata.extensions }),
  };

  return {
    version: { major: 0, minor: 0, patch: 0 },
    latestRevision: new Date().toISOString(),
    registryIdentity: { name: metadata.name },
    identities: {
      [categoryId]: {
        "2000-01-01T00:00:00.000Z": snapshot,
      },
    },
  };
}
