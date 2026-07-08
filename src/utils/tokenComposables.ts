// Composables shared by the tokenItems components (tokenItemFT, tokenItemNFT, nftChild, nftMintForm)
import { ref, computed, watch, onMounted } from 'vue'
import { Notify } from "quasar";
import { decodeCashAddress } from "@bitauth/libauth"
import type { Utxo } from "mainnet-js"
import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation';
import type { ParseResult } from 'src/parsing/nftParsing'
import { useStore } from 'src/stores/store'
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export type TokenActionType = 'sending' | 'minting' | 'burning' | 'transferAuth';

// Destination address input for token sends: BIP21 URI parsing, QR scanning and validation.
// onOtherParams receives the non-standard BIP21 params (c, ft, ...) after a URI was accepted.
export function useTokenAddressInput(getCategory: () => string, onOtherParams?: (otherParams: Record<string, string>) => void) {
  const store = useStore();
  const destinationAddr = ref("");
  const showQrCodeDialog = ref(false);

  function parseAddrParams(){
    if(!isBip21Uri(destinationAddr.value) || !destinationAddr.value.includes("?")) return;

    // Parse BIP21 URIs with query params
    try {
      const parsed = parseBip21Uri(destinationAddr.value);

      const validationError = getBip21ValidationError(parsed);
      if (validationError) {
        Notify.create({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // Check if c= is for a different token
      if(parsed.otherParams?.c && parsed.otherParams.c !== getCategory()){
        Notify.create({ message: t('tokenItem.errors.differentTokenRequest'), icon: 'warning', color: "grey-7" });
        return;
      }

      // Set the address (without query params)
      destinationAddr.value = parsed.address;

      if(parsed.otherParams) onOtherParams?.(parsed.otherParams);
    } catch {
      // If parsing fails, leave the input as-is
    }
  }

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams();
  }

  const qrFilter = (content: string) => {
    // Extract address from BIP21 URI if needed
    let addressToCheck = content;
    if(isBip21Uri(content) && content.includes("?")){
      try {
        const parsed = parseBip21Uri(content);
        addressToCheck = parsed.address;
      } catch {
        // If parsing fails, try with original content
      }
    }
    const decoded = decodeCashAddress(addressToCheck);
    if (typeof decoded === "string" || decoded.prefix !== `${store.wallet.networkPrefix}`) {
      return t('tokenItem.errors.notCashaddress');
    }
    return true;
  }

  // Validates destinationAddr, normalizes it to a prefixed cashaddress (also in the input field)
  // and returns it. Throws a localized error on empty/invalid/wrong-network/non-token address.
  function validateDestination(opts?: { requireTokenSupport?: boolean }): string {
    if(!destinationAddr.value) throw new Error(t('tokenItem.errors.noDestination'));
    const { address, decodedAddress } = normalizeCashAddressForNetwork(destinationAddr.value, store.wallet.networkPrefix, {
      invalidAddress: t('tokenItem.errors.invalidAddress'),
      wrongNetwork: t('tokenItem.errors.notCashaddress'),
    });
    destinationAddr.value = address;
    if(opts?.requireTokenSupport){
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens) throw new Error(t('tokenItem.errors.notTokenAddress'));
    }
    return address;
  }

  return { destinationAddr, showQrCodeDialog, qrDecode, parseAddrParams, qrFilter, validateDestination };
}

// Parsable-NFT state: runs the BCMR parsing bytecode on the NFT commitment.
// isEnabled gates parsing (e.g. tokenItemNFT only parses when it holds a single NFT).
export function useNftParsing(getCategory: () => string, getNftUtxo: () => Utxo | undefined, isEnabled: () => boolean = () => true) {
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
