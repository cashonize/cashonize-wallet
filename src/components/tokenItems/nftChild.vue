<script setup lang="ts">
  import dialogNftIcon from './dialogNftIcon.vue'
  import { ref, onMounted, toRefs, computed, watch, nextTick } from 'vue';
  import { TokenSendRequest, TokenMintRequest, type TokenI } from "mainnet-js"
  import { type UtxoI } from "mainnet-js"
  import { bigIntToVmNumber, binToHex, decodeCashAddress } from "@bitauth/libauth"
  import alertDialog from 'src/components/general/alertDialog.vue'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import type { BcmrTokenMetadata, TokenBurnRequestParams, TokenSendRequestParams } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { caughtErrorToString } from 'src/utils/errorHandling'
  import { appendBlockieIcon } from 'src/utils/blockieIcon'
  import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    nftData: UtxoI,
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
  const mintUniqueNfts = ref(true);
  const numberingUniqueNfts = ref("vm-numbers" as "vm-numbers" | "hex-numbers");
  const mintCommitment = ref("");
  const mintAmountNfts = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);
  const showQrCodeDialog = ref(false);
  const activeAction = ref<'sending' | 'minting' | 'burning' | null>(null);

  const nftMetadata = computed(() => {
    const commitment = nftData.value?.token?.commitment;
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
    let tokenName = tokenMetaData.value?.name;
    const nftName = nftMetadata.value?.name;
    if(nftName) tokenName = nftName;
    return tokenName;
  })
  const nftDescription = computed(() => {
    let tokenDescription = tokenMetaData.value?.description;
    const nftDescription = nftMetadata.value?.description;
    if(tokenDescription) tokenDescription = nftDescription;
    return tokenDescription;
  })

  onMounted(() => {
    const tokenId = nftData.value.token!.tokenId;
    appendBlockieIcon(tokenId, `#${id.value}`);
  })

  watch(imageLoadFailed, async (failedToLoad) => {
    if(failedToLoad) {
      // waits for next tick, so the DOM updates and renders the genericTokenIcon div
      await nextTick();
      const tokenId = nftData.value.token!.tokenId;
      appendBlockieIcon(tokenId, `#${id.value}`);
    }
  })

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams();
  }

  function parseAddrParams(){
    if(!isBip21Uri(destinationAddr.value) || !destinationAddr.value.includes("?")) return;

    // Parse BIP21 URIs with query params
    try {
      const parsed = parseBip21Uri(destinationAddr.value);
      const tokenId = (nftData.value.token as TokenI)?.tokenId;

      const validationError = getBip21ValidationError(parsed);
      if (validationError) {
        $q.notify({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // Check if c= is for a different token
      if(parsed.otherParams?.c && parsed.otherParams.c !== tokenId){
        $q.notify({ message: t('tokenItem.errors.differentTokenRequest'), icon: 'warning', color: "grey-7" });
        return;
      }

      // Set the address (without query params)
      destinationAddr.value = parsed.address;
    } catch {
      // If parsing fails, leave the input as-is
    }
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
    if (typeof decoded === "string" || decoded.prefix !== store.wallet.networkPrefix) {
      return t('tokenItem.errors.notCashaddress');
    }
    return true;
  }
  async function sendNft(){
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      if(!destinationAddr.value) throw(t('tokenItem.errors.noDestination'))
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw(t('tokenItem.errors.invalidAddress'))
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(t('tokenItem.errors.notTokenAddress'));
      if((store.balance?.sat ?? 0) < 550) throw(t('tokenItem.errors.needBchForFee'));

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const nftInfo = nftData.value.token as TokenI;
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? nftInfo.tokenId.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: t('tokenItem.dialogs.confirmNftSend.title'),
            message: t('tokenItem.dialogs.confirmNftSend.message', { symbol: tokenSymbol, address: truncatedAddr }),
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: t('tokenItem.dialogs.confirmButton'), color: 'primary', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!confirmed) return
      }

      const nftInfo = nftData.value.token as TokenI;
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })

      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          tokenId: nftInfo.tokenId,
          commitment: nftInfo.commitment,
          capability: nftInfo.capability,
        } as TokenSendRequestParams),
      ]);
      const displayId = `${nftInfo.tokenId.slice(0, 20)}...${nftInfo.tokenId.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.sentNft', { tokenId: displayId, address: destinationAddr.value });
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
      $q.notify({
        type: 'positive',
        message: t('tokenItem.success.transactionSent')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displaySendNft.value = false;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);

  async function mintNfts() {
    if (activeAction.value) return;
    const nftInfo = nftData.value.token as TokenI;
    const tokenId = nftInfo.tokenId;
    const tokenAddr = store.wallet.tokenaddr;
    const recipientAddr = destinationAddr.value? destinationAddr.value : tokenAddr;

    activeAction.value = 'minting';
    try {
      if(!nftInfo) return;
      // mint amount should always be provided
      if(mintAmountNfts.value == undefined) throw(t('tokenItem.errors.invalidAmountNfts'));
      const mintAmount = parseInt(mintAmountNfts.value);

      // startingNumberNFTs should be provided if mintUniqueNfts is checked
      if(mintUniqueNfts.value && startingNumberNFTs.value == undefined) throw(t('tokenItem.errors.invalidStartingNumber'));
      // initialize commitment with mintCommitment or empty string
      let nftCommitment = mintUniqueNfts.value? "" : mintCommitment.value;
      const validCommitment = (isHex(nftCommitment) || nftCommitment == "")
      if(!validCommitment) throw(t('tokenItem.errors.commitmentMustBeHex', { commitment: nftCommitment }));

      if((store.balance?.sat ?? 0) < 550) throw(t('tokenItem.errors.needBchForFee')); 
      // construct array of TokenMintRequest
      const arraySendrequests = [];
      for (let i = 0; i < mintAmount; i++){
        if(mintUniqueNfts.value && startingNumberNFTs.value){
          const startingNumber = parseInt(startingNumberNFTs.value);
          const nftNumber = startingNumber + i;
          // handle both vm-numering and hex numbering
          if(numberingUniqueNfts.value == "vm-numbers"){
            const vmNumber = bigIntToVmNumber(BigInt(nftNumber));
            nftCommitment = binToHex(vmNumber)
          } else if(numberingUniqueNfts.value == "hex-numbers"){
            nftCommitment = nftNumber.toString(16);
            if(nftCommitment.length % 2 != 0) nftCommitment = `0${nftCommitment}`;
          }
        }
        const mintRequest = new TokenMintRequest({
          cashaddr: recipientAddr,
          commitment: nftCommitment,
          capability: "none",
          value: 1000,
        } as TokenSendRequestParams)
        arraySendrequests.push(mintRequest);
      }
      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenMint(tokenId, arraySendrequests);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-8)}`;
      const commitmentText = nftCommitment? `with commitment ${nftCommitment}`: "";
      let alertMessage = t('tokenItem.alerts.mintedNfts', { amount: mintAmount, tokenId: displayId });
      if (mintAmount == 1) {
        alertMessage = t('tokenItem.alerts.mintedNft', { tokenId: displayId, commitmentText });
      }
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('tokenItem.success.mintSuccessful')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // reset input fields
      displayMintNfts.value = false;
      mintCommitment.value = "";
      mintAmountNfts.value = undefined;
      startingNumberNFTs.value = undefined;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function burnNft() {
    if (activeAction.value) return;
    activeAction.value = 'burning';
    try {
      if((store.balance?.sat ?? 0) < 550) throw(t('tokenItem.errors.needBchForFee'));

      const nftInfo = nftData.value.token as TokenI;
      const tokenId = nftInfo.tokenId;
      const nftTypeString = nftInfo?.capability == 'minting' ? t('tokenItem.dialogs.burnNft.nftTypeMinting') : t('tokenItem.dialogs.burnNft.nftTypeRegular')
      const confirmed = await new Promise<boolean>((resolve) => {
        $q.dialog({
          title: t('tokenItem.dialogs.burnNft.title'),
          message: t('tokenItem.dialogs.burnNft.message', { nftType: nftTypeString }),
          html: true,
          cancel: { flat: true, color: 'dark' },
          ok: { label: t('tokenItem.dialogs.burnNft.burnButton'), color: 'red', textColor: 'white' },
          persistent: true
        }).onOk(() => resolve(true))
          .onCancel(() => resolve(false))
      })
      if (!confirmed) return

      $q.notify({
        spinner: true,
        message: t('common.status.sending'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenBurn(
        {
          tokenId: tokenId,
          capability: nftInfo?.capability,
          commitment: nftInfo?.commitment,
        } as TokenBurnRequestParams,
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.burnedNft', { nftType: nftTypeString, tokenId: displayId });
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('tokenItem.success.burnSuccessful')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }

  function handleTransactionError(error: unknown){
    const errorMessage = caughtErrorToString(error)
    console.error(errorMessage)
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    }) 
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
            <div style="word-break: break-all;"> {{ t('tokenItem.commitment') }} {{ nftData?.token?.commitment ? nftData?.token?.commitment : t('tokenItem.none')  }}</div>
          </div>
        </div>
      </div>

      <div class="actionActions">
        <div class="actionBar">
          <span @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> {{ t('tokenItem.actions.send') }} </span>
          <span v-if="nftMetadata" @click="displayNftInfo = !displayNftInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> {{ t('tokenItem.actions.info') }}
          </span>
          <span @click="displayMintNfts = !displayMintNfts" v-if="nftData?.token?.capability == 'minting' && settingsStore.mintNfts">
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
          <div v-if="tokenMetaData?.description" class="indentText"> {{ t('tokenItem.info.nftDescription') }} {{ nftDescription }} </div>
          <div style="white-space: pre-line;"></div>
          <details v-if="nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary style="display: list-item">{{ t('tokenItem.info.nftAttributes') }}</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap; margin-left:15px">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : t('tokenItem.none') }}
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
        <div v-if="displayMintNfts" class="tokenAction">
          {{ t('tokenItem.mint.title') }}
          <div>
            <input type="checkbox" v-model="mintUniqueNfts" style="margin: 0px; vertical-align: text-bottom;">
            {{ t('tokenItem.mint.uniqueCheckbox') }}
          </div>
          <div v-if="mintUniqueNfts" style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
            <label for="numbering" style="width: 80px;">{{ t('tokenItem.mint.numberingLabel') }}</label>
            <select id="numbering" v-model="numberingUniqueNfts" style="max-width: 260px; padding: 4px 8px;">
              <option value="vm-numbers">{{ t('tokenItem.mint.vmNumbers') }}</option>
              <option value="hex-numbers">{{ t('tokenItem.mint.hexNumbers') }}</option>
            </select>
          </div>
          <p class="grouped" style="align-items: center; margin-bottom: 5px;">
            <input v-model="mintAmountNfts" type="number" :placeholder="t('tokenItem.mint.amountPlaceholder')">
            <input v-if="mintUniqueNfts" v-model="startingNumberNFTs" type="number" :placeholder="t('tokenItem.mint.startingNumberPlaceholder')" style="margin-right: 0px;">
            <input v-else v-model="mintCommitment" :placeholder="t('tokenItem.mint.commitmentPlaceholder')">
          </p>
          <span class="grouped">
            <input v-model="destinationAddr" @input="parseAddrParams()" :placeholder="t('tokenItem.mint.destinationPlaceholder')">
            <input @click="mintNfts()" type="button" :value="activeAction === 'minting' ? t('tokenItem.mint.mintingButton') : t('tokenItem.mint.mintButton')" :disabled="activeAction !== null">
          </span>
        </div>
        <div v-if="displayBurnNft" class="tokenAction">
          <span v-if="nftData?.token?.capability == 'minting'">{{ t('tokenItem.burn.burnMintingDescription') }}</span>
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