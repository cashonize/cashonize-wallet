<script setup lang="ts">
  import dialogNftIcon from './dialogNftIcon.vue'
  import { ref, onMounted, toRefs, computed } from 'vue';
  import { TokenSendRequest, TokenMintRequest, type TokenI } from "mainnet-js"
  import { type UtxoI } from "mainnet-js"
  import { bigIntToVmNumber, binToHex, decodeCashAddress } from "@bitauth/libauth"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import alertDialog from 'src/components/alertDialog.vue'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import type { BcmrTokenMetadata, TokenBurnRequestParams, TokenSendRequestParams } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { caughtErrorToString } from 'src/utils/errorHandling'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    nftData: UtxoI,
    tokenMetaData: BcmrTokenMetadata | undefined,
    id: string
  }>()
  const { nftData, tokenMetaData, id } = toRefs(props);

  const showNftImage = ref(false);
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
    const tokenId = (nftData.value.token as TokenI).tokenId;
    const icon = createIcon({
      seed: tokenId,
      size: 12,
      scale: 4,
      spotcolor: '#000'
    });
    icon.style = "display: block; border-radius: 50%;"
    const template = document.querySelector(`#${id.value}`);
    const iconDiv = template?.querySelector("#genericTokenIcon")
    iconDiv?.appendChild(icon);
  })

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
  }
  const qrFilter = (content: string) => {
    const decoded = decodeCashAddress(content);
    if (typeof decoded === "string" || decoded.prefix !== store.wallet?.networkPrefix) {
      return "Not a cashaddress on current network";
    }
    return true;
  }
  async function sendNft(){
    try{
      if(!store.wallet) return;
      if(!destinationAddr.value) throw("No destination address provided")
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(`Not a Token Address (should start with z...)`);
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      const nftInfo = nftData.value.token as TokenI;
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
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
      const displayId = `${nftInfo.tokenId.slice(0, 20)}...${nftInfo.tokenId.slice(-10)}`;
      const alertMessage = `Sent NFT of category ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId } 
        }
      })
      $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displaySendNft.value = false;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history
      store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    }
  }
  const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);

  async function mintNfts() {
    const nftInfo = nftData.value.token as TokenI;
    const tokenId = nftInfo.tokenId;
    const tokenAddr = store.wallet!.tokenaddr;
    const recipientAddr = destinationAddr.value? destinationAddr.value : tokenAddr;

    try {
      if(!store.wallet || !nftInfo) return;
      // mint amount should always be provided
      if(mintAmountNfts.value == undefined) throw('invalid amount NFTs to mint');
      const mintAmount = parseInt(mintAmountNfts.value);

      // startingNumberNFTs should be provided if mintUniqueNfts is checked
      if(mintUniqueNfts.value && startingNumberNFTs.value == undefined) throw('invalid starting number');
      // initialize commitment with mintCommitment or empty string
      let nftCommitment = mintUniqueNfts.value? "" : mintCommitment.value;
      const validCommitment = (isHex(nftCommitment) || nftCommitment == "")
      if(!validCommitment) throw(`nftCommitment '${nftCommitment}' must be a hexadecimal`);

      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`); 
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
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenMint(tokenId, arraySendrequests);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const commitmentText = nftCommitment? `with commitment ${nftCommitment}`: "";
      const alertMessage = mintAmount == 1 ?
        `Minted immutable NFT of category ${displayId} ${commitmentText}`
        : `Minted ${mintAmount} NFTs of category ${displayId}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Mint successful'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // reset input fields
      displayMintNfts.value = false;
      mintCommitment.value = "";
      mintAmountNfts.value = undefined;
      startingNumberNFTs.value = undefined;
      // update wallet history
      store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
    }
  }
  async function burnNft() {
    try {
      if(!store.wallet) return;
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      
      const nftInfo = nftData.value.token as TokenI;
      const tokenId = nftInfo.tokenId;
      const nftTypeString = nftInfo?.capability == 'minting' ? "a minting NFT" : "an NFT"
      const burnWarning = `You are about to burn ${nftTypeString}, this can not be undone. \nAre you sure you want to burn the NFT?`;
      if (confirm(burnWarning) != true) return;

      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
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
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage = `Burned ${nftTypeString} of category ${displayId}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Burn successful'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history
      store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error)
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
        <video v-if="httpsUrlTokenIcon?.endsWith('.mp4')" class="tokenIcon" loading="lazy" style="cursor: pointer;" @click="() => showNftImage = true">
          <source :src="httpsUrlTokenIcon" type="video/mp4" />
        </video>
        <img v-else-if="httpsUrlTokenIcon" class="tokenIcon" loading="lazy" :style="{ cursor: (nftMetadata?.uris?.image || nftMetadata?.uris?.icon) ? 'pointer' : 'default' }" :src="httpsUrlTokenIcon" @click="() => showNftImage = true">
        <div v-else id="genericTokenIcon" class="tokenIcon"></div>

        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName">Name: {{ tokenName }}</div>
            <div style="word-break: break-all;"> Commitment: {{ nftData?.token?.commitment ? nftData?.token?.commitment : "none"  }}</div>
          </div>
        </div>
      </div>

      <div class="actionActions">
        <div class="actionBar">
          <span @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> send </span>
          <span v-if="nftMetadata" @click="displayNftInfo = !displayNftInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> info
          </span>
          <span @click="displayMintNfts = !displayMintNfts" v-if="nftData?.token?.capability == 'minting'">
            <img class="icon" :src="settingsStore.darkMode? 'images/hammerLightGrey.svg' : 'images/hammer.svg'"> mint NFTs
          </span>
          <span @click="displayBurnNft = !displayBurnNft" v-if="settingsStore.tokenBurn" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            <span class="hidemobile">burn NFT</span>
          </span>
        </div>
        <div v-if="displayNftInfo" style="margin-top: 10px;">
          <div v-if="tokenMetaData?.description"> NFT description: {{ nftDescription }} </div>
          <div style="white-space: pre-line;"></div>
          <details v-if="nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary style="display: list-item">NFT attributes</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap;">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : "none" }}
            </div>
          </details>
        </div>
        <div v-if="displaySendNft" style="margin-top: 10px;">
          Send this NFT to
          <div class="inputGroup">
            <div class="addressInputNftSend">
              <input v-model="destinationAddr" name="tokenAddress" placeholder="token address">
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <input @click="sendNft()" type="button" class="primaryButton" value="Send NFT">
          </div>
        </div>
        <div v-if="displayMintNfts" style="margin-top: 10px;">
          Mint a number of (unique) NFTs to a specific address
          <div>
            <input type="checkbox" v-model="mintUniqueNfts" style="margin: 0px; vertical-align: text-bottom;">
            make each NFT unique by numbering each one in the collection
          </div>
          <div v-if="mintUniqueNfts" style="display: flex; gap: 10px; align-items: center; margin-bottom: 5px;">
            <label for="numbering" style="width: 80px;">Numbering:</label>
            <select id="numbering" v-model="numberingUniqueNfts" style="max-width: 260px; padding: 4px 8px;">
              <option value="vm-numbers">VM numbers (default)</option>
              <option value="hex-numbers">Hex numbers (old cashonize)</option>
            </select>
          </div>
          <p class="grouped" style="align-items: center; margin-bottom: 5px;">
            <input v-model="mintAmountNfts" type="number" placeholder="amount NFTs">
            <input v-if="mintUniqueNfts" v-model="startingNumberNFTs" type="number" placeholder="starting number" style="margin-right: 0px;">
            <input v-else v-model="mintCommitment" placeholder="commitment">
          </p>
          <span class="grouped">
            <input v-model="destinationAddr" placeholder="destinationAddress"> 
            <input @click="mintNfts()" type="button" value="Mint NFTs">
          </span>
        </div>
        <div v-if="displayBurnNft" style="margin-top: 10px;">
          <span v-if="nftData?.token?.capability == 'minting'">Burn this NFT so no new NFTs of this category can be minted</span>
          <span v-else>Burning this NFT to remove it from your wallet forever</span>
          <br>
          <input @click="burnNft()" type="button" value="burn NFT" class="button error">
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