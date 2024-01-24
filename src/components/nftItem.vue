<script setup lang="ts">
  import { ref, onMounted, toRefs, computed } from 'vue';
  import { TokenSendRequest, TokenMintRequest } from "mainnet-js"
  import { type UtxoI } from "mainnet-js"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import type { IdentitySnapshot } from "mainnet-js"
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    nftData: UtxoI,
    tokenMetaData: IdentitySnapshot | null,
    id: string
  }>()
  const { nftData, tokenMetaData, id } = toRefs(props);

  const displaySendNft = ref(false);
  const displayNftInfo = ref(false);
  const displayMintNfts = ref(false);
  const displayBurnNft = ref(false);
  const destinationAddr = ref("");
  const mintUniqueNfts = ref("yes" as 'yes' | 'no');
  const mintCommitment = ref("");
  const mintAmountNfts = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);

  const nftMetadata = computed(() => {
    const commitment = nftData.value?.token?.commitment;
    return tokenMetaData?.value?.token?.nfts?.parse?.types[commitment ?? ""];
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
    const tokenId = nftData.value.token?.tokenId as string;
    let icon = createIcon({
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

  async function sendNft(){
    try{
      if(!store.wallet) return;
      const nftInfo = nftData.value.token;
      const tokenId = nftInfo?.tokenId as string;
      const tokenCommitment = nftInfo?.commitment;
      const tokenCapability = nftInfo?.capability;
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          tokenId: tokenId,
          commitment: tokenCommitment,
          capability: tokenCapability,
        }),
      ]);
      console.log(tokenCommitment, tokenCapability)
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      alert(`Sent NFT of category ${displayId} to ${destinationAddr.value}`);
      console.log(`Sent NFT of category ${displayId} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      destinationAddr.value = "";
      displaySendNft.value = false;
      await store.updateTokenList(undefined, undefined);
    } catch(error){
      console.log(error);
      alert(error);
    }
  }
  async function mintNfts() {
    try {
      if(!store.wallet || !nftData.value?.token) return;
      const tokenAddr = store.wallet.tokenaddr;
      const unique = mintUniqueNfts.value === 'yes';
      let tokenCommitment = unique? "" : mintCommitment.value;
      const nftInfo = nftData.value.token;
      const tokenId = nftInfo?.tokenId as string;
      if(mintAmountNfts.value == undefined || startingNumberNFTs.value == undefined){
        alert('invalid inputs');
        return;
      }
      const mintAmount = parseInt(mintAmountNfts.value);
      const startingNumber = parseInt(startingNumberNFTs.value);
      const isHex = (str:string) => /^[A-F0-9]+$/i.test(str);
      const validCommitment = (isHex(tokenCommitment) || tokenCommitment == "")
      if(!validCommitment) throw(`tokenCommitment '${tokenCommitment}' must be a hexadecimal`);
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
      const { txId } = await store.wallet.tokenMint(tokenId, arraySendrequests);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const commitmentText= tokenCommitment? `with commitment ${tokenCommitment}`: "";
      if(mintAmount == 1){
        alert(`Minted immutable NFT of category ${displayId} ${commitmentText}`);
        console.log(`Minted immutable NFT of category ${displayId} ${commitmentText} \n${store.explorerUrl}/tx/${txId}`);
      } else {
        alert(`Minted ${mintAmount} NFTs of category ${displayId}`);
        console.log(`Minted ${mintAmount} immutable NFT of category ${displayId} \n${store.explorerUrl}/tx/${txId}`);
      }
    } catch (error) { alert(error) }
  }
  async function burnNft() {
    const nftInfo = nftData.value.token;
    const tokenId = nftInfo?.tokenId as string;
    const nftTypeString = nftInfo?.capability == 'minting' ? "a minting NFT" : "an NFT"
    let burnWarning = `You are about to burn ${nftTypeString}, this can not be undone. \nAre you sure you want to burn the NFT?`;
    if (confirm(burnWarning) != true) return;
    if(!store.wallet) return;
    try {
      const { txId } = await store.wallet.tokenBurn(
        {
          tokenId: tokenId,
          capability: nftInfo?.capability,
          commitment: nftInfo?.commitment,
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      alert(`Burned minting NFT of category ${displayId}`);
      console.log(`Burned minting NFT of category ${displayId} \n${store.explorerUrl}/tx/${txId}`);
    } catch (error) { alert(error) }
  }
</script>

<template id="nft-template">
  <div class="item" :id="id">
    <fieldset style="position: relative;">
      <legend>
        <div id="tokenType"></div>
      </legend>
      <!--<div v-if="tokenData?.verified" id="verified" class="verified">
        <div class="tooltip">
          <img class="verifiedIcon" src="/images/check-circle.svg">
          <span class="tooltiptext">Verified</span>
        </div>
      </div>-->
      <div class="tokenInfo">
        <img v-if="httpsUrlTokenIcon" id="tokenIcon" class="tokenIcon" style="width: 48px; border-radius: 50%;" :src="httpsUrlTokenIcon">
        <div v-else id="genericTokenIcon" class="tokenIcon"></div>
        <!--<div v-if="tokenData?.nft" id="tokenIconModal" class="modal">
          <span class="close">&times;</span>
          <img class="modal-content" id="imgTokenIcon" style="width: 400px; max-width: 80%;">
          <div id="caption"></div>
        </div>-->
        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName" id="tokenName">Name: {{ tokenName }}</div>
            <div style="word-break: break-all;"> Commitment: {{ nftData?.token?.commitment ? nftData?.token?.commitment : "none"  }}</div>
          </div>
        </div>
      </div>

      <div class="actionBar">
        <span @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
          <img id="sendIcon" class="icon" :src="settingsStore.darkMode? '/images/sendLightGrey.svg' : '/images/send.svg'"> send </span>
        <span v-if="nftMetadata" @click="displayNftInfo = !displayNftInfo" id="infoButton">
          <img id="infoIcon" class="icon" :src="settingsStore.darkMode? '/images/infoLightGrey.svg' : '/images/info.svg'"> info
        </span>
        <span @click="displayMintNfts = !displayMintNfts" v-if="nftData?.token?.capability == 'minting'">
          <img id="mintIcon" class="icon" :src="settingsStore.darkMode? '/images/hammerLightGrey.svg' : '/images/hammer.svg'"> mint NFTs
        </span>
        <span @click="displayBurnNft = !displayBurnNft" v-if="nftData?.token?.capability == 'minting' || settingsStore.tokenBurn" style="white-space: nowrap;">
          <img id="burnIcon" class="icon" :src="settingsStore.darkMode? '/images/fireLightGrey.svg' : '/images/fire.svg'">
          <span class="hidemobile">burn NFT</span>
        </span>
        <!--<span v-if="tokenData?.auth" style="white-space: nowrap;" id="authButton">
          <img id="authIcon" class="icon" src="/images/shield.svg">
          <span class="hidemobile">auth transfer</span>
          <span class="showmobile">auth</span>
        </span>-->
        <div v-if="displayNftInfo" id="tokenInfoDisplay" style="margin-top: 10px;">
          <div id="tokenBegin"></div>
          <div v-if="tokenMetaData?.description" id="tokenDescription"> {{ nftDescription }} </div>
          <div id="tokenCommitment"></div>
          <div id="tokenWebLink"></div>
          <div id="onchainTokenInfo" style="white-space: pre-line;"></div>
          <details v-if="nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary>NFT attributes</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap;">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : "none" }}
            </div>
          </details>
        </div>
        <div v-if="displaySendNft" id="nftSend" style="margin-top: 10px;">
          Send this NFT to
          <p class="grouped">
            <input v-model="destinationAddr" id="tokenAddress" placeholder="token address">
            <input @click="sendNft()" type="button" class="primaryButton" id="sendNFT" value="Send NFT">
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
            <input @click="mintNfts()" type="button" id="mintNFTs" value="Mint NFTs">
          </span>
        </div>
        <div v-if="displayBurnNft" id="nftBurn" style="margin-top: 10px;">
          <span v-if="nftData?.token?.capability == 'minting'">Burn this NFT so no new NFTs of this category can be minted</span>
          <span v-else>Burning this NFT to remove it from your wallet forever</span>
          <br>
          <input @click="burnNft()" type="button" id="burnNFT" value="burn NFT" class="button error">
        </div>
        <!---<div id="authTransfer" class="hide" style="margin-top: 10px;">
          Transfer the authority to change the token's metadata to another wallet <br>
          This should be to a wallet with coin-control, where you can label the Auth UTXO<br>
          It is recommended to use the Electron Cash pc wallet<br>
          <br>
          <span class="grouped">
            <input id="destinationAddr" placeholder="destinationAddress"> 
            <input type="button" id="transferAuth" value="Transfer Auth">
          </span>
        </div>-->
      </div>
    </fieldset>
  </div>
</template>../stores/store