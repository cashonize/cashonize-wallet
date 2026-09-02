<script setup lang="ts">
  import { ref } from 'vue';
  import { TokenMintRequest, type NFTCapability, type Utxo } from "mainnet-js"
  import { mintOutputs } from 'src/utils/tools/authchainIdentity'
  import { bigIntToVmNumber, binToHex } from "@bitauth/libauth"
  import type { TokenActionType } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { parseTokenPaymentRequest } from 'src/utils/payments/paymentRequest'
  import { validateTokenRecipientAddress } from 'src/utils/payments/recipientAddress'
  import { notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const { t } = useI18n()

  const props = defineProps<{
    category: string,
    identityUtxo?: Utxo | undefined, // set when the minting NFT is the token's identity UTXO
  }>()
  const walletAddresses = () => ({
    bch: store.wallet.getDepositAddress(),
    token: store.wallet.getTokenDepositAddress(),
  });
  const emit = defineEmits<{
    minted: []
  }>();
  // shared with the host component so send/mint/burn actions can't run concurrently
  const activeAction = defineModel<TokenActionType | null>('activeAction', { required: true })

  const mintMode = ref<"single" | "collection">("single");
  const mintCapability = ref<"none" | "mutable" | "minting">("none");
  const numberingUniqueNfts = ref<"vm-numbers" | "hex-numbers">("vm-numbers");
  const mintCommitment = ref("");
  const mintQuantity = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);
  const destinationAddr = ref("");

  function parseAddrParams(){
    const parsed = parseTokenPaymentRequest(destinationAddr.value, props.category);
    if(!parsed) return;
    destinationAddr.value = parsed.address;
  }
  const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);

  async function mintNfts() {
    if (activeAction.value) return;
    activeAction.value = 'minting';
    try {
      let recipientAddr = store.wallet.getTokenDepositAddress();
      if(destinationAddr.value) {
        recipientAddr = validateTokenRecipientAddress(destinationAddr.value, store.wallet.networkPrefix);
        destinationAddr.value = recipientAddr;
      }
      if(mintQuantity.value == undefined) throw new Error(t('tokenItem.errors.invalidAmountNfts'));
      const mintAmount = parseInt(mintQuantity.value);

      if(mintMode.value === "collection" && startingNumberNFTs.value == undefined) {
        throw new Error(t('tokenItem.errors.invalidStartingNumber'));
      }
      // single mode: validate commitment is valid hex
      let nftCommitment = mintMode.value === "collection" ? "" : mintCommitment.value;
      const validCommitment = (isHex(nftCommitment) || nftCommitment == "")
      if(!validCommitment) throw new Error(t('tokenItem.errors.commitmentMustBeHex', { commitment: nftCommitment }));

      if((store.spendableBalance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));
      const mints: { cashaddr: string; commitment: string; capability: string; value: bigint }[] = [];
      for (let i = 0; i < mintAmount; i++){
        if(mintMode.value === "collection" && startingNumberNFTs.value){
          const startingNumber = parseInt(startingNumberNFTs.value);
          const nftNumber = startingNumber + i;
          if(numberingUniqueNfts.value == "vm-numbers"){
            const vmNumber = bigIntToVmNumber(BigInt(nftNumber));
            nftCommitment = binToHex(vmNumber)
          } else if(numberingUniqueNfts.value == "hex-numbers"){
            nftCommitment = nftNumber.toString(16);
            if(nftCommitment.length % 2 != 0) nftCommitment = `0${nftCommitment}`;
          }
        }
        mints.push({ cashaddr: recipientAddr, commitment: nftCommitment, capability: mintCapability.value, value: 1000n });
      }
      notifySending();
      // A minting NFT that is the token's identity UTXO is held back, so minting from it is an
      // authchain operation: the identity output first, then the minted NFTs, through the spend
      // every identity operation uses. Any other minting NFT goes through tokenMint as before.
      let txId: string | undefined;
      if (props.identityUtxo) {
        const outputs = mintOutputs(props.identityUtxo, walletAddresses(), props.category, mints);
        const mintOptions = { tokenOperation: 'mint' as const, checkTokenQuantities: false };
        ({ txId } = await store.spend.spendAuthUtxo(props.identityUtxo, outputs, [], mintOptions));
      } else {
        const mintRequests = mints.map(mint => new TokenMintRequest({
          cashaddr: mint.cashaddr,
          nft: { commitment: mint.commitment, capability: mint.capability as NFTCapability },
          value: mint.value,
        }));
        ({ txId } = await store.spend.tokenMint(props.category, mintRequests));
      }
      const displayId = `${props.category.slice(0, 20)}...${props.category.slice(-8)}`;
      const commitmentText = nftCommitment ? `with commitment ${nftCommitment}` : "";
      let alertMessage = t('tokenItem.alerts.mintedNfts', { amount: mintAmount, tokenId: displayId });
      if (mintAmount == 1) {
        alertMessage = t('tokenItem.alerts.mintedNft', { tokenId: displayId, commitmentText });
      }
      // reset input fields
      mintCapability.value = "none";
      mintCommitment.value = "";
      mintQuantity.value = undefined;
      startingNumberNFTs.value = undefined;
      emit('minted');
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.mintSuccessful'));
    } catch (error) {
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
</script>

<template>
  <div class="tokenAction">
    <b>{{ t('tokenItem.mint.modeSingle') }}</b>: {{ t('tokenItem.mint.titleSingle') }} <br>
    <b>{{ t('tokenItem.mint.modeCollection') }}</b>: {{ t('tokenItem.mint.titleCollection') }}
    <div style="display: flex; gap: 10px; align-items: center; margin: 5px 0;">
      <label>{{ t('tokenItem.mint.modeLabel') }}</label>
      <select v-model="mintMode" style="max-width: 260px; padding: 4px 8px;">
        <option value="single">{{ t('tokenItem.mint.modeSingle') }}</option>
        <option value="collection">{{ t('tokenItem.mint.modeCollection') }}</option>
      </select>
    </div>

    <div v-if="mintMode === 'collection'" style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
      <label for="numbering" style="width: 80px;">{{ t('tokenItem.mint.numberingLabel') }}</label>
      <select id="numbering" v-model="numberingUniqueNfts" style="max-width: 260px; padding: 4px 8px;">
        <option value="vm-numbers">{{ t('tokenItem.mint.vmNumbers') }}</option>
        <option value="hex-numbers">{{ t('tokenItem.mint.hexNumbers') }}</option>
      </select>
    </div>

    <span class="grouped" style="align-items: center; margin-bottom: 5px;">
      <input v-if="mintMode === 'single'" v-model="mintCommitment" :placeholder="t('tokenItem.mint.commitmentPlaceholder')">
      <input v-if="mintMode === 'collection'" v-model="mintQuantity" type="number" :placeholder="t('tokenItem.mint.collectionSizePlaceholder')">
      <input v-if="mintMode === 'collection'" v-model="startingNumberNFTs" type="number" :placeholder="t('tokenItem.mint.startingNumberPlaceholder')">
      <select v-model="mintCapability" style="max-width: 130px;">
        <option value="none">{{ t('tokenItem.mint.capabilityImmutable') }}</option>
        <option value="mutable">{{ t('tokenItem.mint.capabilityMutable') }}</option>
        <option value="minting">{{ t('tokenItem.mint.capabilityMinting') }}</option>
      </select>
      <input v-if="mintMode === 'single'" v-model="mintQuantity" type="number" :placeholder="t('tokenItem.mint.quantityPlaceholder')" style="max-width: 122px;">
    </span>
    <span class="grouped">
      <input v-model="destinationAddr" @input="parseAddrParams()" :placeholder="t('tokenItem.mint.destinationPlaceholder')">
      <input @click="mintNfts()" type="button" :value="activeAction === 'minting' ? t('tokenItem.mint.mintingButton') : t('tokenItem.mint.mintButton')" class="primaryButton" :disabled="activeAction !== null">
    </span>
  </div>
</template>
