<script setup lang="ts">
  import dialogNftIcon from './dialogNftIcon.vue'
  import nftMintForm from './nftMintForm.vue'
  import { ref, onMounted, toRefs, computed, watch, nextTick } from 'vue';
  import { TokenSendRequest, type TokenI } from "mainnet-js"
  import { type Utxo } from "mainnet-js"
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import type { BcmrTokenMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useNftParsing, type TokenActionType } from 'src/utils/tokenComposables'
  import { parseTokenRecipientRequest, getCashAddressScanError, validateTokenRecipientAddress } from 'src/utils/tokenRecipientUtils'
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { appendBlockieIcon } from 'src/utils/blockieIcon'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    nftData: Utxo,
    tokenMetaData: BcmrTokenMetadata | undefined,
    id: string,
    isSelected?: boolean
  }>()
  const { nftData, tokenMetaData, id } = toRefs(props);

  const emit = defineEmits<{
    'toggle-select': []
  }>();

  const showNftImage = ref(false);
  const imageLoadFailed = ref(false);
  const displaySendNft = ref(false);
  const displayNftInfo = ref(false);
  const displayMintNfts = ref(false);
  const displayBurnNft = ref(false);
  const destinationAddr = ref("");
  const showQrCodeDialog = ref(false);
  const activeAction = ref<TokenActionType | null>(null);

  const category = computed(() => nftData.value.token!.category);

  const { parseResult, parsingNft, isParsable, hasParyonUsdExtension } =
    useNftParsing(() => category.value, () => nftData.value);

  const nftMetadata = computed(() => {
    const commitment = nftData.value?.token?.nft?.commitment;
    return tokenMetaData?.value?.nfts?.[commitment ?? ""];
  })
  const httpsUrlTokenIcon = computed(() => {
    let tokenIconUri = tokenMetaData.value?.uris?.icon;
    const nftIconUri = nftMetadata.value?.uris?.icon;
    if(nftIconUri) tokenIconUri = nftIconUri;
    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    // Prefer parsed type name when available (e.g. extension-resolved loan keys)
    if(parseResult.value?.success && parseResult.value.nftTypeName) return parseResult.value.nftTypeName;
    let tokenName = tokenMetaData.value?.name;
    const nftName = nftMetadata.value?.name;
    if(nftName) tokenName = nftName;
    return tokenName;
  })
  const nftDescription = computed(() => {
    if(parseResult.value?.success && parseResult.value.nftTypeDescription) return parseResult.value.nftTypeDescription;
    let tokenDescription = tokenMetaData.value?.description;
    const nftDesc = nftMetadata.value?.description;
    if(nftDesc) tokenDescription = nftDesc;
    return tokenDescription;
  })
  const commitmentDisplay = computed(() => {
    const commitment = nftData.value?.token?.nft?.commitment;
    if (!commitment) return t('tokenItem.empty');
    if (commitment.length > 40) return commitment.slice(0, 20) + '...' + commitment.slice(-20);
    return commitment;
  })

  onMounted(() => {
    appendBlockieIcon(category.value, `#${id.value}`);
  })

  watch(imageLoadFailed, async (failedToLoad) => {
    if(failedToLoad) {
      // waits for next tick, so the DOM updates and renders the genericTokenIcon div
      await nextTick();
      appendBlockieIcon(category.value, `#${id.value}`);
    }
  })

  function parseAddrParams(){
    const parsed = parseTokenRecipientRequest(destinationAddr.value, category.value);
    if(!parsed) return;
    destinationAddr.value = parsed.address;
  }
  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams();
  }
  const qrFilter = (content: string) => getCashAddressScanError(content, store.wallet.networkPrefix) ?? true;
  function validateDestination(opts?: { requireTokenSupport?: boolean }): string {
    const address = validateTokenRecipientAddress(destinationAddr.value, store.wallet.networkPrefix, opts);
    destinationAddr.value = address;
    return address;
  }

  async function sendNft(){
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      validateDestination({ requireTokenSupport: true });
      if((store.balance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));

      const nftInfo = nftData.value.token as TokenI;
      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? nftInfo.category.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await confirmDialog(
          t('tokenItem.dialogs.confirmNftSend.title'),
          t('tokenItem.dialogs.confirmNftSend.message', { symbol: tokenSymbol, address: truncatedAddr }),
          t('tokenItem.dialogs.confirmButton')
        )
        if (!confirmed) return
      }

      notifySending();
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          category: nftInfo.category,
          nft: {
            commitment: nftInfo.nft!.commitment,
            capability: nftInfo.nft!.capability,
          },
        }),
      ]);
      const nftName = tokenName.value;
      let alertMessage = t('tokenItem.alerts.sentNft', { tokenId: nftInfo.category, address: destinationAddr.value });
      if (nftName) {
        alertMessage = t('tokenItem.alerts.sentNftNamed', { name: nftName, address: destinationAddr.value });
      }
      destinationAddr.value = "";
      displaySendNft.value = false;
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.transactionSent'));
    }catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function burnNft() {
    if (activeAction.value) return;
    activeAction.value = 'burning';
    try {
      if((store.balance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));

      const nftInfo = nftData.value.token as TokenI;
      const nftTypeString = nftInfo?.nft?.capability == 'minting' ? t('tokenItem.dialogs.burnNft.nftTypeMinting') : t('tokenItem.dialogs.burnNft.nftTypeRegular')
      const confirmed = await confirmDialog(
        t('tokenItem.dialogs.burnNft.title'),
        t('tokenItem.dialogs.burnNft.message', { nftType: nftTypeString }),
        t('tokenItem.dialogs.burnNft.burnButton'),
        'red'
      )
      if (!confirmed) return

      notifySending();
      const { txId } = await store.wallet.tokenBurn(
        {
          category: category.value,
          nft: {
            capability: nftInfo.nft!.capability,
            commitment: nftInfo.nft!.commitment,
          },
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${category.value.slice(0, 20)}...${category.value.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.burnedNft', { nftType: nftTypeString, tokenId: displayId });
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.burnSuccessful'));
    } catch (error) {
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
</script>

<template>
  <div class="item" :id="id">
    <fieldset style="position: relative;">
      <div class="tokenInfo">
        <video
          v-if="!settingsStore.disableTokenIcons && httpsUrlTokenIcon?.endsWith('.mp4')"
          class="tokenIcon" width="48" height="48" loading="lazy"
          style="cursor: pointer;"
          @click="() => showNftImage = true"
        >
          <source :src="httpsUrlTokenIcon" type="video/mp4" />
        </video>
        <img
          v-else-if="!settingsStore.disableTokenIcons && httpsUrlTokenIcon && !imageLoadFailed"
          class="tokenIcon" width="48" height="48" loading="lazy"
          :style="{ cursor: (nftMetadata?.uris?.image || nftMetadata?.uris?.icon) ? 'pointer' : 'default' }"
          :src="httpsUrlTokenIcon"
          @click="() => showNftImage = true"
          @error="() => imageLoadFailed = true"
        >
        <div v-else id="genericTokenIcon" class="tokenIcon"></div>

        <div class="tokenBaseInfo">
          <div>
            <div v-if="tokenName">{{ t('tokenItem.name') }} {{ tokenName }}</div>
            <div v-if="parsingNft && hasParyonUsdExtension">{{ t('tokenItem.loadingLoanData') }}</div>
            <div v-else-if="parseResult?.success && parseResult.namedFields?.length && parseResult.namedFields.length <= 3">
              <div v-for="(field, index) in parseResult.namedFields" :key="'main-field-' + index">
                {{ field.name ?? field.fieldId ?? `Field ${index}` }}: {{ field.parsedValue?.formatted ?? field.value }}
              </div>
            </div>
            <div v-else-if="parseResult?.success && parseResult.namedFields?.length">
              {{ t('tokenItem.seeParsedData') }}
            </div>
            <div v-else style="word-break: break-all;"> {{ t('tokenItem.commitment') }} {{ commitmentDisplay }}</div>
          </div>
        </div>
      </div>

      <div class="actionActions">
        <div class="actionBar">
          <span @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> {{ t('tokenItem.actions.send') }} </span>
          <span v-if="nftMetadata || isParsable" @click="displayNftInfo = !displayNftInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> {{ t('tokenItem.actions.info') }}
          </span>
          <span @click="displayMintNfts = !displayMintNfts" v-if="nftData?.token?.nft?.capability == 'minting' && settingsStore.mintNfts">
            <img class="icon" :src="settingsStore.darkMode? 'images/hammerLightGrey.svg' : 'images/hammer.svg'"> {{ t('tokenItem.actions.mintNfts') }}
          </span>
          <span @click="displayBurnNft = !displayBurnNft" v-if="settingsStore.tokenBurn" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            <span class="hidemobile">{{ t('tokenItem.actions.burnNft') }}</span>
          </span>
          <span @click="emit('toggle-select')" :class="{ 'nft-selected': isSelected }">
            {{ isSelected ? t('tokenItem.actions.selected') + ' ✓' : t('tokenItem.actions.select') }}
          </span>
        </div>
        <div v-if="displayNftInfo" class="tokenAction">
          <div v-if="nftDescription" class="indentText"> {{ t('tokenItem.info.nftDescription') }} {{ nftDescription }} </div>
          <div v-if="parseResult?.success && parseResult.namedFields?.length && parseResult.namedFields.length > 3">
            <div>{{ hasParyonUsdExtension ? t('tokenItem.info.extensionNote') : t('tokenItem.info.parsedFields') }}</div>
            <div v-for="(field, index) in parseResult.namedFields" :key="'parsed-field-' + index" style="white-space: pre-wrap; margin-left:15px">
              {{ field.name ?? field.fieldId ?? `Field ${index}` }}: {{ field.parsedValue?.formatted ?? field.value }}
            </div>
          </div>
          <div style="word-break: break-all;"> {{ t('tokenItem.commitment') }} {{ commitmentDisplay }}</div>
          <details v-if="nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary style="display: list-item">{{ t('tokenItem.info.nftAttributes') }}</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap; margin-left:15px">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : t('tokenItem.empty') }}
            </div>
          </details>
        </div>
        <div v-if="displaySendNft" class="tokenAction">
          {{ t('tokenItem.sendNft.title') }}
          <div class="inputGroup">
            <div class="addressInputNftSend">
              <input v-model="destinationAddr" @input="parseAddrParams()" name="tokenAddress" :placeholder="t('tokenItem.sendTokens.addressPlaceholder')">
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <input @click="sendNft()" type="button" class="primaryButton" :value="activeAction === 'sending' ? t('tokenItem.sendNft.sendingButton') : t('tokenItem.sendNft.sendButton')" :disabled="activeAction !== null">
          </div>
        </div>
        <nftMintForm v-if="displayMintNfts" :category="category" v-model:active-action="activeAction" @minted="displayMintNfts = false"/>
        <div v-if="displayBurnNft" class="tokenAction">
          <span v-if="nftData?.token?.nft?.capability == 'minting'">{{ t('tokenItem.burn.burnMintingDescription') }}</span>
          <span v-else>{{ t('tokenItem.burn.burnNftDescription') }}</span>
          <br>
          <input @click="burnNft()" type="button" :value="activeAction === 'burning' ? t('tokenItem.burn.burningButton') : t('tokenItem.burn.burnNftButton')" class="button error" :disabled="activeAction !== null">
        </div>
      </div>
    </fieldset>
    <div v-if="showNftImage && (nftMetadata?.uris?.image || nftMetadata?.uris?.icon)">
      <dialogNftIcon :srcNftImage="nftMetadata?.uris?.image ? nftMetadata.uris.image : nftMetadata.uris.icon as string" :nftName="nftMetadata.name" @close-dialog="() => showNftImage = false"/>
    </div>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
.nft-selected {
  color: var(--color-primary);
}
</style>
