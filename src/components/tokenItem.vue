<script setup lang="ts">
  import { ref, onMounted, toRefs, computed, watch } from 'vue';
  import nftItem from './nftItem.vue'
  import { TokenSendRequest, TokenMintRequest, BCMR } from "mainnet-js"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import type { TokenData } from "../interfaces/interfaces"
  import { queryTotalSupplyFT, querySupplyNFTs, queryActiveMinting } from "../queryChainGraph"
  import type { IdentitySnapshot } from "mainnet-js"
  import { useStore } from '../stores/store'
  const store = useStore()

  const props = defineProps<{
    tokenData: TokenData,
  }>()
  const { tokenData } = toRefs(props);

  const displaySendTokens = ref(false);
  const displaySendNft = ref(false);
  const displaySendAllNfts = ref(false);
  const displayMintNfts = ref(false);
  const displayBurnNft = ref(false);
  const displayTokenInfo = ref(false);
  const displayChildNfts = ref(false);
  const tokenSendAmount = ref("");
  const destinationAddr = ref("");
  const tokenMetaData = ref(null as (IdentitySnapshot | null));
  const mintUniqueNfts = ref("yes" as 'yes' | 'no');
  const mintCommitment = ref("");
  const mintAmountNfts = ref(undefined as string | undefined);
  const startingNumberNFTs = ref(undefined as string | undefined);
  const totalSupplyFT = ref(undefined as bigint | undefined);
  const totalNumberNFTs = ref(undefined as number | undefined);
  const hasMintingNFT = ref(undefined as boolean | undefined);

  tokenMetaData.value = BCMR.getTokenInfo(tokenData.value.tokenId) ?? null;

  const isSingleNft = computed(() => tokenData.value.nfts?.length == 1);
  const nftMetadata = computed(() => {
    if(isSingleNft.value) return
    const nftData = tokenData.value.nfts?.[0];
    const commitment = nftData?.token?.commitment;
    return tokenMetaData?.value?.token?.nfts?.parse?.types[commitment ?? ""];
  })
  const httpsUrlTokenIcon = computed(() => {
    let tokenIconUri = tokenMetaData.value?.uris?.icon;
    if(isSingleNft.value){
      const commitment = tokenData.value.nfts?.[0].token?.commitment;
      const nftMetadata = tokenMetaData.value?.token?.nfts?.parse?.types[commitment ?? ""];
      const nftIconUri = nftMetadata?.uris?.icon;
      if(nftIconUri) tokenIconUri = nftIconUri;
    }
    if(tokenIconUri?.startsWith('ipfs://')){
      return store.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    let tokenName = tokenMetaData.value?.name;
    if(isSingleNft.value){
      const commitment = tokenData.value.nfts?.[0].token?.commitment;
      const nftMetadata = tokenMetaData?.value?.token?.nfts?.parse?.types[commitment ?? ""];
      const nftName = nftMetadata?.name;
      if(nftName) tokenName = nftName;
    }
    return tokenName;
  })

  onMounted(() => {
    let icon = createIcon({
      seed: tokenData.value.tokenId,
      size: 12,
      scale: 4,
      spotcolor: '#000'
    });
    icon.style = "display: block; border-radius: 50%;"
    const template = document.querySelector(`#id${tokenData.value.tokenId.slice(0, 10)}`);
    const iconDiv = template?.querySelector("#genericTokenIcon")
    iconDiv?.appendChild(icon);
  })

  function copyTokenId(){
    navigator.clipboard.writeText(tokenData.value.tokenId);
  }

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalSupplyFT.value && tokenData.value?.amount){
      totalSupplyFT.value = await queryTotalSupplyFT(tokenData.value.tokenId, store.chaingraph);
    }
    if(!totalNumberNFTs.value && tokenData.value?.nfts && hasMintingNFT.value == undefined){
      const supplyNFTs = await querySupplyNFTs(tokenData.value.tokenId, store.chaingraph);
      const resultHasMintingNft = await queryActiveMinting(tokenData.value.tokenId, store.chaingraph);
      totalNumberNFTs.value = supplyNFTs;
      hasMintingNFT.value = resultHasMintingNft;
    }
  })
  
  // Fungible token specific functionality
  function toAmountDecimals(amount:bigint){
    let tokenAmountDecimals: bigint|number = amount;
    const decimals = tokenMetaData.value?.token?.decimals;
    if(decimals) tokenAmountDecimals = Number(tokenAmountDecimals) / (10 ** decimals);
    return tokenAmountDecimals;
  }
  async function maxTokenAmount(){
    try{
      if(!tokenData.value?.amount) return // should never happen
      const decimals = tokenMetaData.value?.token?.decimals;
      let amountTokens = decimals ? Number(tokenData.value.amount) / (10 ** decimals) : tokenData.value.amount;
      tokenSendAmount.value = amountTokens.toString();
    } catch(error) {
      console.log(error)
    }
  }
  async function sendTokens(){
    try{
      if(!store.wallet) return;
      if(!tokenSendAmount?.value) throw(`Amount tokens to send must be a valid integer`);
      const decimals = tokenMetaData.value?.token?.decimals;
      const amountTokens = decimals ? +tokenSendAmount.value * (10 ** decimals) : +tokenSendAmount.value;
      const validInput =  Number.isInteger(amountTokens);
      if(!validInput && !decimals) throw(`Amount tokens to send must be a valid integer`);
      if(!validInput ) throw(`Amount tokens to send must only have ${decimals} decimal places`);
      const tokenId = tokenData.value.tokenId;
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          amount: amountTokens,
          tokenId: tokenId,
        }),
      ]);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      let message = `Sent ${tokenSendAmount.value} fungible tokens of category ${displayId} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`;
      alert(message);
      console.log(message);
      tokenSendAmount.value = "";
      destinationAddr.value = "";
      displaySendTokens.value = false;
      await store.updateTokenList(undefined, undefined);
    } catch(error){
      console.log(error);
      alert(error);
    }
  }
  // NFT Group specific functionality
  async function sendAllNfts(){
    try{
      if(!store.wallet) return;
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
      const { txId } = await store.wallet.send(outputArray);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      alert(`Sent all NFTs of category ${displayId} to ${destinationAddr.value}`);
      console.log(`Sent all NFTs of category ${displayId} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      destinationAddr.value = "";
      displaySendAllNfts.value = false;
    } catch(error){
      console.log(error)
    }
  }
  // single NFT specific functionality
  async function sendNft(){
    try{
      if(!store.wallet) return;
      const tokenId = tokenData.value.tokenId;
      const nftInfo = tokenData.value.nfts?.[0].token;
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
      console.log(error)
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
      // reset input fields
      displayMintNfts.value = false;
      mintCommitment.value = "";
      mintAmountNfts.value = undefined;
      startingNumberNFTs.value = undefined;
    } catch (error) { alert(error) }
  }
  async function burnNft() {
    const tokenId = tokenData.value.tokenId;
    const nftInfo = tokenData.value.nfts?.[0].token;
    let burnWarning = "You ae about to burn a minting NFT, this can not be unddone. \nAre you sure you want to burn the NFT?";
    if (confirm(burnWarning) != true) return;
    if(!store.wallet) return;
    try {
      const { txId } = await store.wallet.tokenBurn(
        {
          tokenId: tokenId,
          capability: "minting",
          commitment: nftInfo?.commitment,
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      alert(`Burned minting NFT of category ${displayId}`);
      console.log(`Burned minting NFT of category ${displayId} \n${store.explorerUrl}/tx/${txId}`);
      await store.updateTokenList(undefined, undefined);
    } catch (error) { alert(error) }
  }
</script>

<template id="token-template">
  <div :id="`id${tokenData.tokenId.slice(0, 10)}`" class="item">
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
            <div id="tokenIdBox" style="word-break: break-all;">
              TokenId: 
              <span class="tokenId">
                 {{ `${tokenData.tokenId.slice(0, 20)}...${tokenData.tokenId.slice(-10)}` }}
              </span>
              <img class="copyIcon" src="/images/copyGrey.svg" @click="copyTokenId">
            </div>
            <div id="childNftCommitment" style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="tokenData?.amount" class="tokenAmount" id="tokenAmount">Token amount: 
            {{ toAmountDecimals(tokenData?.amount) }} {{ tokenMetaData?.token?.symbol }}
          </div>
          <div v-if="(tokenData.nfts?.length ?? 0) > 1" @click="displayChildNfts = !displayChildNfts" class="showChildNfts">
            <span class="nrChildNfts" id="nrChildNfts">Number NFTs: {{ tokenData.nfts?.length }}</span>
            <span class="hide" id="showMore" style="margin-left: 10px;">
              <img class="icon" :src="store.darkMode? (displayChildNfts? '/images/chevron-square-up-lightGrey.svg':'/images/chevron-square-down-lightGrey.svg') : 
                (displayChildNfts? '/images/chevron-square-up.svg':'/images/chevron-square-down.svg')">
            </span>
          </div>

        </div>
      </div>

      <div class="actionBar">
        <span v-if="!tokenData?.nfts" @click="displaySendTokens = !displaySendTokens" style="margin-left: 10px;">
          <img id="sendIcon" class="icon" :src="store.darkMode? '/images/sendLightGrey.svg' : '/images/send.svg'"> send </span>
        <span v-if="tokenData?.nfts?.length == 1" @click="displaySendNft = !displaySendNft" style="margin-left: 10px;">
          <img id="sendIcon" class="icon" :src="store.darkMode? '/images/sendLightGrey.svg' : '/images/send.svg'"> send </span>
        <span @click="displayTokenInfo = !displayTokenInfo" id="infoButton">
          <img id="infoIcon" class="icon" :src="store.darkMode? '/images/infoLightGrey.svg' : '/images/info.svg'"> info
        </span>
        <span v-if="(tokenData.nfts?.length ?? 0) > 1" @click="displaySendAllNfts = !displaySendAllNfts" style="margin-left: 10px;">
          <img id="sendIcon" class="icon" :src="store.darkMode? '/images/sendLightGrey.svg' : '/images/send.svg'"> transfer all </span>
        <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.capability == 'minting'" @click="displayMintNfts = !displayMintNfts">
          <img id="mintIcon" class="icon" :src="store.darkMode? '/images/hammerLightGrey.svg' : '/images/hammer.svg'"> mint NFTs
        </span>
        <span v-if="isSingleNft && tokenData?.nfts?.[0]?.token?.capability == 'minting'" @click="displayBurnNft = !displayBurnNft" style="white-space: nowrap;">
          <img id="burnIcon" class="icon" :src="store.darkMode? '/images/fireLightGrey.svg' : '/images/fire.svg'">
          <span class="hidemobile">burn NFT</span>
        </span>
      </div>
        <!--<span v-if="tokenData?.auth" style="white-space: nowrap;" id="authButton">
          <img id="authIcon" class="icon" src="/images/shield.svg">
          <span class="hidemobile">auth transfer</span>
          <span class="showmobile">auth</span>
        </span>-->
      <div>
        <div v-if="displayTokenInfo" style="margin-top: 10px;">
          <div></div>
          <div v-if="tokenMetaData?.description"> {{ tokenMetaData.description }} </div>
          <div v-if="tokenData.amount && tokenMetaData">
            Number of decimals: {{ tokenMetaData?.token?.decimals ?? 0 }}
          </div>
          <div v-if="isSingleNft">
            NFT commitment: {{ tokenData.nfts?.[0].token?.commitment ? tokenData.nfts?.[0].token?.commitment : "none" }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            Token web link: <a :href="tokenMetaData?.uris?.web" target="_blank">{{ tokenMetaData?.uris?.web }}</a>
          </div>
          <div v-if="tokenData.amount">
            Genesis supply: {{ totalSupplyFT? 
              (tokenMetaData?.token?.symbol ? toAmountDecimals(totalSupplyFT) + " " + tokenMetaData?.token?.symbol
              : totalSupplyFT + " tokens") : "..."
            }}
          </div>
          <div v-if="tokenData?.nfts?.length">
            Total supply NFTs: {{ totalNumberNFTs? totalNumberNFTs: "..."}}
          </div>
          <div v-if="tokenData?.nfts?.length">
            Has active minting NFT: {{ hasMintingNFT == undefined? "..." :( hasMintingNFT? "yes": "no")}}
          </div>
          <details v-if="isSingleNft && nftMetadata?.extensions?.attributes" style="cursor:pointer;">
            <summary>NFT attributes</summary>
            <div v-for="(attributeValue, attributeKey) in nftMetadata?.extensions?.attributes" :key="((attributeValue as string) + (attributeValue as string))" style="white-space: pre-wrap;">
              {{ attributeKey }}: {{ attributeValue ? attributeValue : "none" }}
            </div>
          </details>
        </div>

        <div v-if="displaySendTokens" id="tokenSend" style="margin-top: 10px;">
          Send these tokens to
          <div class="inputGroup">
            <div class="addressInput">
              <input v-model="destinationAddr" id="tokenAddress" placeholder="token address">
            </div>
            <div style="display: flex; width: 50%;">
              <span style="width: 100%; position: relative;">
                <input v-model="tokenSendAmount" id="sendTokenAmount" placeholder="amount">
                <i id="sendUnit" class="input-icon" style="width: min-content; padding-right: 15px;">
                  {{ tokenMetaData?.token?.symbol ?? "tokens" }}
                </i>
              </span>
              <button @click="maxTokenAmount()" id="maxButton" style="color: black;">max</button>
            </div>
          </div>
          <input @click="sendTokens()" type="button" id="sendSomeButton" class="primaryButton" value="Send">
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
            <input @click="mintNfts()" type="button" id="mintNFTs" value="Mint NFTs">
          </span>
        </div>
        <div id="nftBurn" v-if="displayBurnNft" style="margin-top: 10px;">
          Burn this NFT so no new NFTs of this category can be minted
          <br>
          <input @click="burnNft()" type="button" id="burnNFT" value="burn NFT" class="button error">
        </div>
        <!--<div id="authTransfer" class="hide" style="margin-top: 10px;">
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

    <div v-if="displayChildNfts && (tokenData.nfts?.length ?? 0) > 1">
      <div v-for="(nft, index) in tokenData.nfts" :key="'nft'+tokenData.tokenId.slice(0,4) + index">
        <nftItem :nftData="nft" :tokenMetaData="tokenMetaData" :id="'nft'+tokenData.tokenId.slice(0,4) + index"/>
      </div>
    </div>
  </div>
</template>../stores/store