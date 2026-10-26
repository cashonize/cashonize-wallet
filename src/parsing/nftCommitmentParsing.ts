import { ref, computed, watch, onMounted } from 'vue'
import type { Utxo } from "@cashonize/bch-wallet-lib"
import type { ParseResult } from 'src/parsing/nftParsing'
import { useStore } from 'src/stores/store'
import { useSettingsStore } from 'src/stores/settingsStore'
import { EMERALD_DAO_CATEGORY } from 'src/utils/defi/emeraldDao'
import { emeraldKeycardParseResult } from 'src/parsing/emeraldKeycard'
import { BADGERCOIN_CATEGORY } from 'src/utils/defi/badgersStake'
import { parseHoneyBadgersNft } from 'src/parsing/honeyBadgers'

// Vue composable for Parsable-NFT state.
// Keeps parsing state and parses the NFT commitment on mount/when metadata becomes available.
// isEnabled gates parsing (e.g. tokenItemNFT only parses when it holds a single NFT).
// Callback arguments read the latest reactive values when parsing runs.
export function useNftCommitmentParsing(getCategory: () => string, getNftUtxo: () => Utxo | undefined, isEnabled: () => boolean = () => true) {
  const store = useStore();
  const settingsStore = useSettingsStore();
  const parsedResult = ref(undefined as ParseResult | undefined);
  const parsingNft = ref(false);

  const hasParyonUsdExtension = computed(() => {
    return Boolean(store.bcmrRegistries?.[getCategory()]?.extensions?.paryonusd);
  });
  const isParsable = computed(() =>
    store.bcmrRegistries?.[getCategory()]?.nft_type === 'parsable'
  );

  async function parseNft() {
    const nftUtxo = getNftUtxo();
    if (!nftUtxo) return;
    parsingNft.value = true;
    parsedResult.value = await store.parseNftCommitment(getCategory(), nftUtxo);
    parsingNft.value = false;
  }

  onMounted(async () => {
    if (isEnabled() && isParsable.value) await parseNft();
  })

  // Watch for isParsable becoming true after mount (e.g. bcmrRegistries loads async)
  watch(isParsable, async (nowParsable) => {
    if (nowParsable && isEnabled() && !parsedResult.value) await parseNft();
  })

  // Emerald DAO keycards come without parse info in their metadata, so the portfolio's reading of
  // the commitment stands in for it; parse info the registry does publish takes precedence
  const keycardResult = computed(() => {
    if (!isEnabled() || isParsable.value || getCategory() !== EMERALD_DAO_CATEGORY) return undefined;
    return emeraldKeycardParseResult(getNftUtxo()?.token?.nft?.commitment, store.exchangeRate, settingsStore.currency);
  });
  // HoneyBadgers NFTs likewise, see honeyBadgers.ts
  const honeyBadgersResult = computed(() => {
    const commitment = getNftUtxo()?.token?.nft?.commitment;
    if (!isEnabled() || isParsable.value || getCategory() !== BADGERCOIN_CATEGORY || commitment === undefined) return undefined;
    return parseHoneyBadgersNft(commitment);
  });
  const parseResult = computed(() => parsedResult.value ?? keycardResult.value ?? honeyBadgersResult.value);

  return { parseResult, parsingNft, isParsable, hasParyonUsdExtension };
}
