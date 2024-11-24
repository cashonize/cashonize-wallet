<script setup lang="ts">
  import { ref, onMounted, toRefs, computed, watch } from 'vue';
  import dialogNftIcon from './dialogNftIcon.vue'
  import nftChild from './nftChild.vue'
  import { TokenSendRequest, TokenMintRequest, SendRequest, TokenI } from "mainnet-js"
  import { decodeCashAddress } from "@bitauth/libauth"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import alertDialog from 'src/components/alertDialog.vue'
  import type { TokenDataNFT, bcmrTokenMetadata } from "src/interfaces/interfaces"
  import { querySupplyNFTs, queryActiveMinting } from "src/queryChainGraph"
  import { copyToClipboard } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    tokenData: TokenDataNFT,
  }>()
  const { tokenData } = toRefs(props);

  const showNftImage = ref(false);
  const displaySendNft = ref(false);
  const displaySendAllNfts = ref(false);
  const displayMintNfts = ref(false);
  const displayBurnNft = ref(false);
  const displayAuthTransfer = ref(false);
  const displayTokenInfo = ref(false);
  const displayChildNfts = ref(false);
  const destinationAddr = ref("");
  const tokenMetaData = ref(undefined as (bcmrTokenMetadata | undefined));
  const mintUniqueNfts = ref("yes" as 'yes' | 'no');
  const mintCommitment = ref("");
  const mintAmountNfts = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);
  const totalNumberNFTs = ref(undefined as number | undefined);
  const hasMintingNFT = ref(undefined as boolean | undefined);

  let fetchedMetadataChildren = false

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.tokenId] ?? null;

  const isSingleNft = computed(() => tokenData.value.nfts?.length == 1);
  const nftMetadata = computed(() => {
    if(!isSingleNft.value) return
    const nftData = tokenData.value.nfts?.[0];
    const commitment = nftData?.token?.commitment;
    const matchedNftMetadata = tokenMetaData?.value?.nfts?.[commitment ?? ""]
    return matchedNftMetadata ? matchedNftMetadata : tokenMetaData?.value
  })
  const httpsUrlTokenIcon = computed(() => {
    let tokenIconUri = tokenMetaData.value?.uris?.icon;
    if(isSingleNft.value){
      const nftIconUri = nftMetadata.value?.uris?.icon;
      if(nftIconUri) tokenIconUri = nftIconUri;
    }
    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    let tokenName = tokenMetaData.value?.name;
    if(isSingleNft.value) tokenName = nftMetadata.value?.name;
    return tokenName;
  })

  onMounted(() => {
    const icon = createIcon({
      seed: tokenData.value.tokenId,
      size: 12,
      scale: 4,
      spotcolor: '#000'
    });
    icon.style = "display: block; border-radius: 50%;"
    const template = document.querySelector(`#id${tokenData.value.tokenId.slice(0, 10)}nft`);
    const iconDiv = template?.querySelector("#genericTokenIcon")
    iconDiv?.appendChild(icon);
  })

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalNumberNFTs.value && tokenData.value?.nfts && hasMintingNFT.value == undefined){
      const supplyNFTs = await querySupplyNFTs(tokenData.value.tokenId, settingsStore.chaingraph);
      const resultHasMintingNft = await queryActiveMinting(tokenData.value.tokenId, settingsStore.chaingraph);
      totalNumberNFTs.value = supplyNFTs;
      hasMintingNFT.value = resultHasMintingNft;
    }
  })

  async function showChildNfts() {
    if(!fetchedMetadataChildren && tokenMetaData.value){
      console.time('fetch NFT info');
      await store.importRegistries([tokenData.value], true)
      fetchedMetadataChildren = true
      console.timeEnd('fetch NFT info');
    }
    displayChildNfts.value = !displayChildNfts.value;
  }
  
  // NFT Group specific functionality
  async function sendAllNfts(){
    try{
      if(!store.wallet) return;
      if(!destinationAddr.value) throw("No destination address provided")
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        throw(`Address prefix ${networkPrefix} is required`)
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(`Not a Token Address (should start with z...)`);
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      const tokenId = tokenData.value.tokenId;
      const allNfts = tokenData.value.nfts;
      const outputArray:TokenSendRequest[] = [];
      allNfts?.forEach(nftItem => {
        const nftCommitment = nftItem?.token?.commitment;
        const nftCapability = nftItem?.token?.capability;
        outputArray.push(
          new TokenSendRequest({
          cashaddr: destinationAddr.value,
          tokenId: tokenId,
          commitment: nftCommitment,
          capability: nftCapability,
        }))
      })
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send(outputArray);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage = `Sent all NFTs of category  ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string } 
        }
      })
      $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displaySendAllNfts.value = false;
    }catch(error){
      handleTransactionError(error)
    }
  }
  // single NFT specific functionality
  async function sendNft(){
    try{
      if(!store.wallet) return;
      if(!destinationAddr.value) throw("No destination address provided")
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        throw(`Address prefix ${networkPrefix} is required`)
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(`Not a Token Address (should start with z...)`);
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      const tokenId = tokenData.value.tokenId;
      const nftInfo = tokenData.value.nfts?.[0].token as TokenI;
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          tokenId: tokenId,
          commitment: nftInfo.commitment,
          capability: nftInfo.capability,
        }),
      ]);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage = `Sent NFT of category ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
      $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
      })
      console.log(alertMessage)
      console.log(`${store.explorerUrl}/${txId}`);
      destinationAddr.value = "";
      displaySendNft.value = false;
      await store.updateTokenList();
    }catch(error){
      handleTransactionError(error)
    }
  }
  async function mintNfts() {
    const tokenId = tokenData.value.tokenId;
    const nftInfo = tokenData.value.nfts?.[0].token;
    try {
      if(!store.wallet || !nftInfo) return;
      const tokenAddr = store.wallet.tokenaddr;
      const unique = mintUniqueNfts.value === 'yes';
      let tokenCommitment = unique? "" : mintCommitment.value;
      if(mintAmountNfts.value == undefined) throw('invalid amount NFTs to mint');
      if(startingNumberNFTs.value == undefined) throw('invalid starting number');
      const mintAmount = parseInt(mintAmountNfts.value);
      const startingNumber = parseInt(startingNumberNFTs.value);
      const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);
      const validCommitment = (isHex(tokenCommitment) || tokenCommitment == "")
      if(!validCommitment) throw(`tokenCommitment '${tokenCommitment}' must be a hexadecimal`);
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      const recipientAddr = destinationAddr.value? destinationAddr.value : tokenAddr;
      const arraySendrequests = [];
      for (let i = 0; i < mintAmount; i++){
        if(unique){
          tokenCommitment = (startingNumber + i).toString(16);
          if(tokenCommitment.length % 2 != 0) tokenCommitment = `0${tokenCommitment}`;
        }
        const mintRequest = new TokenMintRequest({
          cashaddr: recipientAddr,
          commitment: tokenCommitment,
          capability: "none",
          value: 1000,
        })
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
      const commitmentText= tokenCommitment? `with commitment ${tokenCommitment}`: "";
      const alertMessage = mintAmount == 1 ?
        `Minted immutable NFT of category ${displayId} ${commitmentText}`
        : `Minted ${mintAmount} NFTs of category ${displayId}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
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
    } catch (error) {
      handleTransactionError(error)
    }
  }
  async function burnNft() {
    try {
      if(!store.wallet) return;
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);

      const tokenId = tokenData.value.tokenId;
      const nftInfo = tokenData.value.nfts?.[0].token;
      const nftTypeString = nftInfo?.capability == 'minting' ? "a minting NFT" : "an NFT"
      const burnWarning = `You are about to burn ${nftTypeString}, this can not be undone. \nAre you sure you want to burn the NFT?`;
      if (confirm(burnWarning) != true) return;
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })

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
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage= `Burned ${nftTypeString} of category ${displayId}`;
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Burn successful'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      await store.updateTokenList();
    } catch (error) {
      handleTransactionError(error)
    }
  }
  async function transferAuth() {
    if(!store.wallet || !store.wallet.tokenaddr) return;
    if(!tokenData.value?.authUtxo) return;
    const tokenId = tokenData.value.tokenId;
    const authNft = tokenData.value.authUtxo?.token;
    try {
      const authTransfer = {
        cashaddr: destinationAddr.value,
        value: 1000,
        unit: 'sats',
      } as SendRequest;
      const changeOutputNft = new TokenSendRequest({
        cashaddr: store.wallet.tokenaddr,
        tokenId: tokenData.value.tokenId,
        commitment: authNft?.commitment,
        capability: authNft?.capability
      });
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([authTransfer,changeOutputNft], { ensureUtxos: [tokenData.value.authUtxo] });
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage = `Transferred the Auth of utxo ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Auth transfer successful'
      })
      displayAuthTransfer.value = false;
      destinationAddr.value = "";
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
    } catch (error) { 
      handleTransactionError(error)
    }
  }

  function handleTransactionError(error: any){
    console.log(error)
    const errorMessage = typeof error == 'string' ? error : "something went wrong";
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    }) 
  }
</script>

<template id="token-template">
  <div :id="`id${tokenData.tokenId.slice(0, 10)}nft`" class="item">
    <fieldset style="position: relative;">
      <legend>
        <div id="tokenType"></div>
      </legend>
      <!--<div v-if="tokenData?.verified" id="verified" class="verified">
        <div class="tooltip">
          <img class="verifiedIcon" src="images/check-circle.svg">
          <span class="tooltiptext">Verified</span>
        </div>
      </div>-->
      <div class="tokenInfo">
        <video v-if="httpsUrlTokenIcon?.endsWith('.mp4')" id="tokenIcon" class="tokenIcon" loading="lazy" style="cursor: pointer;" @click="() => showNftImage = true">
          <source :src="httpsUrlTokenIcon" type="video/mp4" />
        </video>
        <img v-else-if="httpsUrlTokenIcon && isSingleNft" class="tokenIcon" loading="lazy" style="cursor: pointer;" :src="httpsUrlTokenIcon" @click="() => showNftImage = true">
        <img v-else-if="httpsUrlTokenIcon && !isSingleNft" class="tokenIcon" loading="lazy" :src="httpsUrlTokenIcon">
        <div v-else-if="!httpsUrlTokenIcon" id="genericTokenIcon" loading="lazy" class="tokenIcon"></div>

        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName" id="tokenName">Name: {{ tokenName }}</div>
            <div id="tokenIdBox" style="word-break: break-all;">
              TokenId:
              <span @click="copyToClipboard(tokenData.tokenId)" style="cursor: pointer;">
                <span class="tokenId">
                  {{ !isMobile ? `${tokenData.tokenId.slice(0, 20)}...${tokenData.tokenId.slice(-10)}` :  `${tokenData.tokenId.slice(0, 10)}...${tokenData.tokenId.slice(-10)}`}}
                </span>
                <img class="copyIcon" src="images/copyGrey.svg">
              </span>
            </div>
            <div id="childNftCommitment" style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="(tokenData.nfts?.length ?? 0) > 1" @click="showChildNfts()" class="showChildNfts">
            <span class="nrChildNfts" id="nrChildNfts">Number NFTs: {{ tokenData.nfts?.length }}</span>
            <span class="hide" id="showMore" style="margin-left: 10px;">
              <img class="icon" :src="settingsStore.darkMode? (displayChildNfts? 'images/chevron-square-up-lightGrey.svg':'images/chevron-square-down-lightGrey.svg') : 
                (displayChildNfts? 'images/chevron-square-up.svg':'images/chevron-square-down.svg')">
            </span>
          </div>
        </div>
        <span @click="store.toggleFavorite(tokenData.tokenId)" class="boxStarIcon">
          <img :src="settingsStore.featuredTokens.includes(tokenData.tokenId) ? 'images/star-full.svg' : 
            settingsStore.darkMode? 'images/star-empty-grey.svg' : 'images/star-empty.svg'">
        </span>
      </div>

      <div class="tokenActions">
        <div class="actionBar">
          <span v-if="tokenData?.nfts?.length == 1" @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
            <img id="sendIcon" class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> send </span>
          <span @click="displayTokenInfo = !displayTokenInfo" id="infoButton">
            <img id="infoIcon" class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> info
          </span>
          <span v-if="(tokenData.nfts?.length ?? 0) > 1" @click="displaySendAllNfts = !displaySendAllNfts" style="margin-left: 10px;">
            <img id="sendIcon" class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> transfer all </span>
          <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.capability == 'minting'" @click="displayMintNfts = !displayMintNfts">
            <img id="mintIcon" class="icon" :src="settingsStore.darkMode? 'images/hammerLightGrey.svg' : 'images/hammer.svg'"> mint NFTs
          </span>
          <span v-if="isSingleNft && settingsStore.tokenBurn" @click="displayBurnNft = !displayBurnNft" style="white-space: nowrap;">
            <img id="burnIcon" class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            <span>burn NFT</span>
          </span>
          <span v-if="tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;" id="authButton">
            <img id="authIcon" class="icon" :src="settingsStore.darkMode? 'images/shieldLightGrey.svg' : 'images/shield.svg'">
            <span>auth transfer</span>
          </span>
        </div>
        <div v-if="displayTokenInfo" style="margin-top: 10px;">
          <div></div>
          <div v-if="tokenMetaData?.description">Token description: {{ tokenMetaData.description }} </div>
          <div v-if="isSingleNft">
            NFT commitment: {{ tokenData.nfts?.[0].token?.commitment ? tokenData.nfts?.[0].token?.commitment : "none" }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            Token web link:
            <a :href="tokenMetaData.uris.web" target="_blank">{{ tokenMetaData.uris.web }}</a>
          </div>
          <div v-if="tokenData?.nfts?.length">
            Total supply NFTs: {{ totalNumberNFTs? totalNumberNFTs: "..."}}
          </div>
          <div v-if="tokenData?.nfts?.length">
            Has active minting NFT: {{ hasMintingNFT == undefined? "..." :( hasMintingNFT? "yes": "no")}}
          </div>
          <div>
            <a style="color: var(--font-color); cursor: pointer;" :href="'https://tokenexplorer.cash/?tokenId=' + tokenData.tokenId" target="_blank">
              See details on TokenExplorer <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
            </a>
          </div>
          <details v-if="isSingleNft && nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary style="display: list-item">NFT attributes</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap;">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : "none" }}
            </div>
          </details>
        </div>

        <div v-if="displaySendNft" style="margin-top: 10px;">
          Send this NFT to
          <p class="grouped">
            <input v-model="destinationAddr" id="tokenAddress" placeholder="token address">
            <input @click="sendNft()" type="button" class="primaryButton" id="sendNFT" value="Send NFT">
          </p>
        </div>
        <div v-if="displaySendAllNfts" style="margin-top: 10px;">
          Send all {{ tokenData.nfts?.length }} NFTs of this category to
          <p class="grouped">
            <input v-model="destinationAddr" id="tokenAddress" placeholder="token address">
            <input @click="sendAllNfts()" type="button" class="primaryButton" id="sendNFT" value="Transfer NFTs">
          </p>
        </div>
        <div id="nftMint" v-if="displayMintNfts" style="margin-top: 10px;">
          Mint a number of (unique) NFTs to a specific address
          <div>
            <input type="checkbox" v-model="mintUniqueNfts" true-value="yes" false-value="no" style="margin: 0px; vertical-align: text-bottom;">
            make each NFT unique by numbering each one in the collection
          </div>
          <p class="grouped" style="align-items: center; margin-bottom: 5px;">
            <input v-model="mintAmountNfts" type="number" placeholder="amount NFTs">
            <input v-if="mintUniqueNfts == 'yes'" v-model="startingNumberNFTs" type="number" placeholder="starting number" style="margin-right: 0px;">
            <input v-if="mintUniqueNfts == 'no'" v-model="mintCommitment" placeholder="commitment">
          </p>
          <span class="grouped">
            <input v-model="destinationAddr" placeholder="destinationAddress"> 
            <input @click="mintNfts()" type="button" id="mintNFTs" value="Mint NFTs" class="primaryButton">
          </span>
        </div>
        <div v-if="displayBurnNft" style="margin-top: 10px;">
          <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.capability == 'minting'">Burn this NFT so no new NFTs of this category can be minted</span>
          <span v-else>Burning this NFT to remove it from your wallet forever</span>
          <br>
          <input @click="burnNft()" type="button" id="burnNFT" value="burn NFT" class="button error">
        </div>
        <div v-if="displayAuthTransfer" style="margin-top: 10px;">
          Transfer the authority to change the token's metadata to another wallet <br>
          You can either transfer the Auth to a dedicated wallet or to the <a href="https://cashtokens.studio/" target="_blank">CashTokens Studio</a>.<br>
          <span class="grouped" style="margin-top: 10px;">
            <input v-model="destinationAddr" placeholder="destinationAddress"> 
            <input @click="transferAuth()" type="button" value="Transfer Auth" class="primaryButton">
          </span>
        </div>
      </div>
    </fieldset>

    <div v-if="showNftImage && (nftMetadata?.uris?.image || nftMetadata?.uris?.icon)">
      <dialogNftIcon :srcNftImage="nftMetadata?.uris?.image ? nftMetadata?.uris?.image : nftMetadata?.uris?.icon" :nftName="tokenName" @close-dialog="() => showNftImage = false"/>
    </div>

    <div v-if="displayChildNfts && (tokenData.nfts?.length ?? 0) > 1">
      <div v-for="(nft, index) in tokenData.nfts" :key="'nft'+tokenData.tokenId.slice(0,4) + index">
        <nftChild :nftData="nft" :tokenMetaData="store.bcmrRegistries?.[tokenData.tokenId] " :id="'nft'+tokenData.tokenId.slice(0,4) + index"/>
      </div>
    </div>
  </div>
</template>