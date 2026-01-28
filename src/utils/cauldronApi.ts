import { CauldronValueLockedSchema } from "./zodValidation";
import { cachedFetch } from "./cacheUtils";

const CAULDRON_INDEXER_URL = "https://indexer.cauldron.quest";
const MIN_LIQUIDITY_SATS = 1_000_000_000; // 10 BCH minimum
const CAULDRON_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CauldronPriceData {
  satoshis: number;
  tokenAmount: number;
  hasSufficientLiquidity: boolean;
}

// Fetch prices for multiple tokens
export async function fetchCauldronPrices(
  tokenIds: string[]
): Promise<Record<string, CauldronPriceData>> {
  const results: Record<string, CauldronPriceData> = {};

  const fetchPromises = tokenIds.map(async (tokenId) => {
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
  });

  const settled = await Promise.allSettled(fetchPromises);

  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.data) {
      const { tokenId, data } = result.value;
      results[tokenId] = {
        satoshis: data.satoshis,
        tokenAmount: data.token_amount,
        hasSufficientLiquidity: data.satoshis >= MIN_LIQUIDITY_SATS
      };
    }
  }

  return results;
}

// Calculate fiat value of user's total holdings
// Accounts for the 0.3% LP fee that would apply to any swap
// Note: slippage/price impact is ignored as it varies with trade size
const PRICE_AFTER_LP_FEE = 0.997; // 100% - 0.3% = 99.7%

export function calculateHoldingsFiatValue(
  userAmount: bigint,
  decimals: number,
  priceData: CauldronPriceData,
  bchExchangeRate: number
): number | null {
  if (!priceData.hasSufficientLiquidity || priceData.tokenAmount === 0) return null;

  // Convert user's amount to display units
  const displayAmount = Number(userAmount) / Math.pow(10, decimals);

  // Price per display unit in sats
  const pricePerUnitSats = (priceData.satoshis / priceData.tokenAmount) * Math.pow(10, decimals);

  // Total value in fiat (after 0.3% LP fee)
  const totalSats = displayAmount * pricePerUnitSats;
  const totalBch = totalSats / 1e8;
  return totalBch * bchExchangeRate * PRICE_AFTER_LP_FEE;
}
