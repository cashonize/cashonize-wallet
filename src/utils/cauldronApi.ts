import { CauldronValueLockedSchema } from "./zodValidation";
import { cachedFetch } from "./cacheUtils";

const CAULDRON_INDEXER_URL = "https://indexer.cauldron.quest";
const MIN_LIQUIDITY_SATS = 100_000_000; // 1 BCH minimum
const CAULDRON_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface CauldronPriceData {
  satoshis: number;
  tokenAmount: number;
  hasSufficientLiquidity: boolean;
}

// Fetch prices for multiple tokens in batches to avoid server-side rate throttling
// The Cauldron indexer throttles after ~35-40 requests per 60s window by delaying responses ~60s
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

export async function fetchCauldronPrices(
  tokenIds: string[],
  onBatchComplete?: (results: Record<string, CauldronPriceData>) => void
): Promise<Record<string, CauldronPriceData>> {
  const results: Record<string, CauldronPriceData> = {};
  const totalBatches = Math.ceil(tokenIds.length / BATCH_SIZE);
  const totalStart = Date.now();
  console.log(`[Cauldron] Fetching prices for ${tokenIds.length} tokens in ${totalBatches} batches of ${BATCH_SIZE}`);

  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchStart = Date.now();

    const batchResponses = await Promise.all(
      batch.map(async (tokenId) => {
        try {
          const response = await cachedFetch(
            `${CAULDRON_INDEXER_URL}/cauldron/valuelocked/${tokenId}`,
            CAULDRON_CACHE_TTL_MS
          );
          const json = await response.json();
          const parsed = CauldronValueLockedSchema.safeParse(json);
          if (!parsed.success) {
            console.error(`Cauldron validation error for ${tokenId}:`, parsed.error);
            return { tokenId, data: null };
          }
          return { tokenId, data: parsed.data };
        } catch (error) {
          // 404 = token not on Cauldron, other errors logged
          if (!(error instanceof Error && error.message.includes('404'))) {
            console.error(`Cauldron fetch error for ${tokenId}:`, error);
          }
          return { tokenId, data: null };
        }
      })
    );

    for (const { tokenId, data } of batchResponses) {
      if (data) {
        results[tokenId] = {
          satoshis: data.satoshis,
          tokenAmount: data.token_amount,
          hasSufficientLiquidity: data.satoshis >= MIN_LIQUIDITY_SATS
        };
      }
    }

    const batchElapsed = Date.now() - batchStart;
    const successCount = batchResponses.filter(r => r.data !== null).length;
    console.log(`[Cauldron] Batch ${batchNum}/${totalBatches} (requests ${i + 1}-${i + batch.length}): ${batchElapsed}ms, ${successCount}/${batch.length} found`);

    // Update UI progressively after each batch
    onBatchComplete?.({ ...results });

    // Delay between batches to stay under rate limit, but not after the last batch
    if (i + BATCH_SIZE < tokenIds.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[Cauldron] Done: ${Object.keys(results).length}/${tokenIds.length} prices fetched in ${Date.now() - totalStart}ms`);
  return results;
}

// Calculate fiat value of user's fungible token holdings from Cauldron price data
// Clamps as a maximum to the pool's BCH amount to avoid overstating value due to limited liquidity
// Note: slippage/price impact is ignored as it varies with trade size
export function calculateTokenFiatValue(
  userAmount: bigint,
  poolInfo: CauldronPriceData,
  bchExchangeRate: number
): number | null {
  if (!poolInfo.hasSufficientLiquidity || poolInfo.tokenAmount === 0) return null;
  const poolPrice = poolInfo.satoshis / poolInfo.tokenAmount;
  const tokenBchValue = Number(userAmount) * poolPrice;

  const totalSats = Math.min(tokenBchValue, poolInfo.satoshis);
  const totalBch = totalSats / 1e8;
  const fiatValueTokens = totalBch * bchExchangeRate;
  return fiatValueTokens;
}
