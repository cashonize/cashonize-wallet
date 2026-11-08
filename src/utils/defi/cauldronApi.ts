import { CauldronValueLockedSchema } from "../zodValidation";
import { cachedFetch } from "../cacheUtils";
import { useSettingsStore } from "src/stores/settingsStore";
import type { AppNetwork } from "src/utils/wallet/networks";

// Minimum pool liquidity for a price to be used. Test network pools are orders of
// magnitude smaller than mainnet ones, so mainnet's 1 BCH would reject them all
const MIN_LIQUIDITY_SATS_MAINNET = 100_000_000; // 1 BCH
const MIN_LIQUIDITY_SATS_TEST_NETWORK = 1_000_000; // 0.01 tBCH
const CAULDRON_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CauldronPriceData {
  satoshis: number;
  tokenAmount: number;
  hasSufficientLiquidity: boolean;
}

// Whether the network has a Cauldron indexer set: by default mainnet and chipnet
export function cauldronAvailableOn(network: AppNetwork): boolean {
  return useSettingsStore().cauldronIndexer[network] !== "";
}

// Fetch prices for multiple tokens; none on a network without a Cauldron indexer
export async function fetchCauldronPrices(
  tokenIds: string[],
  network: AppNetwork
): Promise<Record<string, CauldronPriceData>> {
  const results: Record<string, CauldronPriceData> = {};
  if (!cauldronAvailableOn(network)) return results;
  const indexerUrl = useSettingsStore().cauldronIndexer[network];
  let minLiquiditySats = MIN_LIQUIDITY_SATS_TEST_NETWORK;
  if (network === 'mainnet') minLiquiditySats = MIN_LIQUIDITY_SATS_MAINNET;

  const fetchPromises = tokenIds.map(async (tokenId) => {
    try {
      const response = await cachedFetch(
        `${indexerUrl}/cauldron/valuelocked/${tokenId}`,
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

  const responses = await Promise.all(fetchPromises);

  for (const { tokenId, data } of responses) {
    if (data) {
      results[tokenId] = {
        satoshis: data.satoshis,
        tokenAmount: data.token_amount,
        hasSufficientLiquidity: data.satoshis >= minLiquiditySats
      };
    }
  }

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
