import { ref, computed, watch, onMounted } from 'vue'
import type { Utxo } from "mainnet-js"
import type { ParseResult } from 'src/parsing/nftParsing'
import { useStore } from 'src/stores/store'

// Parsable-NFT state: runs the BCMR parsing bytecode on the NFT commitment.
// isEnabled gates parsing (e.g. tokenItemNFT only parses when it holds a single NFT).
export function useNftCommitmentParsing(getCategory: () => string, getNftUtxo: () => Utxo | undefined, isEnabled: () => boolean = () => true) {
  const store = useStore();
  const parseResult = ref(undefined as ParseResult | undefined);
  const parsingNft = ref(false);

  const hasParyonUsdExtension = computed(() => {
    const ext = store.bcmrRegistries?.[getCategory()]?.extensions;
    return Boolean(ext?.paryonusd ?? ext?.pusd);
  });
  const isParsable = computed(() =>
    store.bcmrRegistries?.[getCategory()]?.nft_type === 'parsable'
  );

  async function parseNft() {
    const nftUtxo = getNftUtxo();
    if (!nftUtxo) return;
    parsingNft.value = true;
    parseResult.value = await store.parseNftCommitment(getCategory(), nftUtxo);
    parsingNft.value = false;
  }

  onMounted(async () => {
    if (isEnabled() && isParsable.value) await parseNft();
  })

  // Watch for isParsable becoming true after mount (e.g. bcmrRegistries loads async)
  watch(isParsable, async (nowParsable) => {
    if (nowParsable && isEnabled() && !parseResult.value) await parseNft();
  })

  return { parseResult, parsingNft, isParsable, hasParyonUsdExtension };
}
