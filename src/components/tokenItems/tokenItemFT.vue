<script setup lang="ts">
  import { ref, onMounted, toRefs, computed, watch } from 'vue';
  import { TokenSendRequest, type SendRequest } from "mainnet-js"
  import { decodeCashAddress } from "@bitauth/libauth"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import alertDialog from 'src/components/alertDialog.vue'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import type { TokenDataFT, BcmrTokenMetadata } from "src/interfaces/interfaces"
  import { queryTotalSupplyFT, queryReservedSupply } from "src/queryChainGraph"
  import { copyToClipboard } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import {caughtErrorToString} from 'src/utils/errorHandling'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    tokenData: TokenDataFT,
  }>()
  const { tokenData } = toRefs(props);

  const displaySendTokens = ref(false);
  const displayBurnFungibles = ref(false);
  const displayAuthTransfer = ref(false);
  const displayTokenInfo = ref(false);
  const tokenSendAmount = ref("");
  const destinationAddr = ref("");
  const burnAmountFTs = ref("");
  const reservedSupplyInput = ref("")
  const tokenMetaData = ref(undefined as (BcmrTokenMetadata | undefined));
  const totalSupplyFT = ref(undefined as bigint | undefined);
  const reservedSupply = ref(undefined as bigint | undefined);
  const showQrCodeDialog = ref(false);

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.tokenId];

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  const MAX_SUPPLY_FTS = 9_223_372_036_854_775_807n

  const httpsUrlTokenIcon = computed(() => {
    const tokenIconUri = tokenMetaData.value?.uris?.icon;
    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    return tokenMetaData.value?.name;
  })

  onMounted(() => {
    const icon = createIcon({
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

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalSupplyFT.value && tokenData.value?.amount){
      totalSupplyFT.value = await queryTotalSupplyFT(tokenData.value.tokenId, settingsStore.chaingraph);
      reservedSupply.value = await queryReservedSupply(tokenData.value.tokenId, settingsStore.chaingraph)
    }
  })
  
  function checkValidTokenInput(numberInput: string, decimals: number){
    // Validate the input format (no separting commas allowed here)
    if (!/^\d*\.?\d*$/.test(numberInput)) throw ('Invalid number format');

    // Validate if the input can be converted to a number
    const number = parseFloat(numberInput);
    if (isNaN(number) || number <= 0) throw(`Enter a valid positive amount`);

    // check number of decimal places
    const decimalPart = numberInput.split('.')[1];
    const decimalPlaces = decimalPart ? decimalPart.length : 0;
    const validInput = decimalPlaces <= decimals
    if(!validInput && !decimals) throw(`This token does not allow for decimal places`);
    if(!validInput) throw (`This token only allows up to ${decimals} decimal places`);
  }
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
  // Fungible token specific functionality
  function toAmountDecimals(amount:bigint){
    let tokenAmountDecimals: bigint|number = amount;
    const decimals = tokenMetaData.value?.token?.decimals;
    if(decimals) tokenAmountDecimals = Number(tokenAmountDecimals) / (10 ** decimals);
    return tokenAmountDecimals;
  }
  function maxTokenAmount(tokenSend:boolean){
    if(!tokenData.value?.amount) return // should never happen
    const decimals = tokenMetaData.value?.token?.decimals;
    const amountTokens = decimals ? Number(tokenData.value.amount) / (10 ** decimals) : tokenData.value.amount;
    const targetState = tokenSend? tokenSendAmount : burnAmountFTs;
    targetState.value = numberFormatter.format(amountTokens);
  }
  async function sendTokens(){
    try{
      if(!store.wallet) return;
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      if(!destinationAddr.value) throw("No destination address provided")
      if(!tokenSendAmount?.value) throw(`No valid amount provided`);
      const sanitizedInput = tokenSendAmount.value.replace(/,/g, '');
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      checkValidTokenInput(sanitizedInput, decimals)
      const amountTokensNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
      const amountTokensInt = typeof amountTokensNumber == "number" ? BigInt(Math.round(amountTokensNumber)): BigInt(amountTokensNumber)
      if(amountTokensInt > tokenData.value.amount) throw(`Insufficient token balance`);
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(`Not a Token Address (should start with z...)`);
      if(tokenData.value?.authUtxo){
        const authWarning = "You risk unintentionally sending the authority to update this token's metadata elsewhere. \nAre you sure you want to send the transaction anyways?";
        if(confirm(authWarning) != true) return;
      }
      const tokenId = tokenData.value.tokenId;
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          amount: amountTokensInt,
          tokenId: tokenId,
        }),
      ]);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-8)}`;
      const amountSentFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
      const alertMessage = tokenMetaData.value?.token?.symbol ?
        `Sent ${amountSentFormatted} ${tokenMetaData.value.token.symbol} to ${destinationAddr.value}`
        : `Sent ${amountSentFormatted} fungible tokens of category ${displayId} to ${destinationAddr.value}`
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
      tokenSendAmount.value = "";
      destinationAddr.value = "";
      displaySendTokens.value = false;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history
      store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    }
  }
  async function burnFungibles(){
    try {
      if(!store.wallet) return;
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      if(!burnAmountFTs?.value) throw(`Amount tokens to burn must be a valid integer`);
      const sanitizedInput = burnAmountFTs.value.replace(/,/g, '');
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      checkValidTokenInput(sanitizedInput, decimals)
      const amountTokensNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
      const amountTokensInt = typeof amountTokensNumber == "number" ? BigInt(Math.round(amountTokensNumber)): BigInt(amountTokensNumber)
      if(amountTokensInt > tokenData.value.amount) throw(`Insufficient token balance`);
      const tokenId = tokenData.value.tokenId;

      const burnWarning = `You are about to burn ${amountTokensInt} tokens, this can not be undone. \nAre you sure you want to burn the tokens?`;
      if (confirm(burnWarning) != true) return;

      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenBurn({
          tokenId: tokenId,
          amount: amountTokensInt,
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-8)}`;
      const amountBurntFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
      const alertMessage = tokenMetaData.value?.token?.symbol ?
        `Burned ${amountBurntFormatted} ${tokenMetaData.value.token.symbol}`
        : `Burned ${amountBurntFormatted} tokens of category ${displayId}`
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
      burnAmountFTs.value = "";
      displayBurnFungibles.value = false;
      // update utxo list
      await store.updateWalletUtxos();
    } catch (error) {
      handleTransactionError(error)
    }
  }
  async function transferAuth() {
    if(!store.wallet) return;
    if(!tokenData.value?.authUtxo) return;
    if(!reservedSupplyInput?.value) throw(`Amount tokens for reserved supply must be a valid integer`);
    const decimals = tokenMetaData.value?.token?.decimals ?? 0;
    const sanitizedInput = reservedSupplyInput.value.replace(/,/g, '');
    checkValidTokenInput(sanitizedInput, decimals)
    const reservedSupplyNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
    const reservedSupply = typeof reservedSupplyNumber == "number" ? BigInt(Math.round(reservedSupplyNumber)): BigInt(reservedSupplyNumber)
    if(reservedSupply > tokenData.value.amount) throw(`Insufficient token balance`);
    const tokenId = tokenData.value.tokenId;
    try {
      const authTransfer = !reservedSupply? {
        cashaddr: destinationAddr.value,
        value: 1000,
        unit: 'sats',
      } as SendRequest : new TokenSendRequest({
        cashaddr: destinationAddr.value,
        tokenId: tokenId,
        amount: reservedSupply
      });
      const outputs = [authTransfer];
      const changeAmount = reservedSupply? tokenData.value.amount - reservedSupply : tokenData.value.amount;
      if(changeAmount){
        const changeOutput = new TokenSendRequest({
          cashaddr: store.wallet.tokenaddr,
          tokenId: tokenId,
          amount: changeAmount
        });
        outputs.push(changeOutput)
      }
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send(outputs, { ensureUtxos: [tokenData.value.authUtxo] });
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-8)}`;
      const alertMessage = `Transferred the Auth of utxo ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
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
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history
      store.updateWalletHistory();
    } catch (error) { 
      handleTransactionError(error);
    }
  }

  function handleTransactionError(error: unknown){
    const errorMessage = caughtErrorToString(error);
    console.error(errorMessage)
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    }) 
  }
</script>

<template>
  <div :id="`id${tokenData.tokenId.slice(0, 10)}`" class="item">
    <fieldset style="position: relative;">
      <div class="tokenInfo">
        <img v-if="httpsUrlTokenIcon" class="tokenIcon" width="48" height="48" loading="lazy" :src="httpsUrlTokenIcon">
        <div v-else id="genericTokenIcon" class="tokenIcon"></div>
        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName">Name: {{ tokenName }}</div>
            <div style="word-break: break-all;">
              TokenId: 
              <span @click="copyToClipboard(tokenData.tokenId)">
                <span class="tokenId" style="cursor: pointer;">
                  {{ !isMobile ? `${tokenData.tokenId.slice(0, 20)}...${tokenData.tokenId.slice(-8)}` :  `${tokenData.tokenId.slice(0, 10)}...${tokenData.tokenId.slice(-8)}`}}
                </span>
                <img class="copyIcon" src="images/copyGrey.svg">
              </span>
            </div>
            <div style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="tokenData?.amount" class="tokenAmount">Amount: 
            {{ numberFormatter.format(toAmountDecimals(tokenData?.amount)) }} {{ tokenMetaData?.token?.symbol }}
          </div>
        </div>
        <span @click="store.toggleFavorite(tokenData.tokenId)" class="boxStarIcon">
          <img :src="settingsStore.featuredTokens.includes(tokenData.tokenId) ? 'images/star-full.svg' : 
            settingsStore.darkMode? 'images/star-empty-grey.svg' : 'images/star-empty.svg'">
        </span>
      </div>

      <div class="tokenActions">
        <div class="actionBar">
          <span @click="displaySendTokens = !displaySendTokens" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> send </span>
          <span @click="displayTokenInfo = !displayTokenInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> info
          </span>
          <span v-if="settingsStore.showCauldronSwap && store.wallet?.network == 'mainnet'" style="white-space: nowrap;">
            <a :href="`https://app.cauldron.quest/swap/${tokenData.tokenId}`" target="_blank" style="color: var(--font-color);">
              <img class="icon" :src="settingsStore.darkMode? 'images/cauldronLightGrey.svg' : 'images/cauldron.svg'"> swap
            </a>
          </span>
          <span v-if="settingsStore.tokenBurn && tokenData?.amount" @click="displayBurnFungibles = !displayBurnFungibles" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            burn tokens
          </span>
          <span v-if="tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/shieldLightGrey.svg' : 'images/shield.svg'">
            auth transfer
          </span>
        </div>
        <div v-if="displayTokenInfo" class="tokenAction">
          <div></div>
          <div v-if="tokenMetaData?.description" class="indentText"> Token description: {{ tokenMetaData.description }} </div>
          <div v-if="tokenData.amount && tokenMetaData">
            Number of decimals: {{ tokenMetaData?.token?.decimals ?? 0 }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            Token web link: 
            <a :href="tokenMetaData.uris.web" target="_blank">{{ tokenMetaData.uris.web }}</a>
          </div>
          <div>
            Max supply: 
            <span v-if="totalSupplyFT">
              {{ totalSupplyFT!= MAX_SUPPLY_FTS ?
                  numberFormatter.format(toAmountDecimals(totalSupplyFT)) +
                  (tokenMetaData?.token?.symbol ? " " + tokenMetaData?.token?.symbol : " tokens")
                : "open ended"
              }}
            </span><span v-else>...</span>
          </div>
          <div>
            Circulating supply: 
            <span v-if="totalSupplyFT && reservedSupply != undefined">
              {{ numberFormatter.format(toAmountDecimals(totalSupplyFT - reservedSupply)) +
                (tokenMetaData?.token?.symbol ? " " + tokenMetaData?.token?.symbol: " tokens")
              }}
              {{ totalSupplyFT!= MAX_SUPPLY_FTS ?
                `(${((Number((totalSupplyFT - reservedSupply)*1000n/totalSupplyFT))/10).toFixed(1)}%)`
                :"" 
              }}
            </span><span v-else>...</span>
          </div>
          <div>
            <a style="color: var(--font-color); cursor: pointer;" :href="'https://tokenexplorer.cash/?tokenId=' + tokenData.tokenId" target="_blank">
              See details on TokenExplorer <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
            </a>
          </div>
        </div>

        <div v-if="displaySendTokens" class="tokenAction">
          Send these tokens to
          <div class="inputGroup">
            <div class="addressInputFtSend">
              <span style="width: 100%; position: relative;">
                <input v-model="destinationAddr" name="tokenAddress" placeholder="token address">
              </span>
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <div class="sendTokenAmount">
              <span style="width: 100%; position: relative;">
                <input v-model="tokenSendAmount" placeholder="amount" name="tokenAmountInput">
                <i class="input-icon" style="width: min-content; padding-right: 15px; color: black;">
                  {{ tokenMetaData?.token?.symbol ?? "tokens" }}
                </i>
              </span>
              <button @click="maxTokenAmount(true)" style="color: black;">max</button>
            </div>
          </div>
          <input @click="sendTokens()" type="button" class="primaryButton" value="Send">
        </div>
        <div v-if="displayBurnFungibles" class="tokenAction">
          <div>Burning tokens removes them from the supply forever</div>
          <div style="display: flex">
            <span style="width: 50%; position: relative; display: flex;">
              <input v-model="burnAmountFTs" placeholder="amount tokens" name="tokenAmountInput">
              <i class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? "tokens" }}
              </i>
            </span>
            <button @click="maxTokenAmount(false)" style="color: black;">max</button>
          </div>
          <input @click="burnFungibles()" type="button" value="burn tokens" class="button error" style="margin-top: 10px;">
        </div>
        <div v-if="displayAuthTransfer" class="tokenAction">
          Transfer the authority to change the token's metadata <br>
          You can either transfer the Auth to a dedicated wallet or to the <a href="https://cashtokens.studio/" target="_blank">CashTokens Studio</a>.<br>
          Token supply kept at the Auth UTXO will be marked as reserved supply, not yet in circulation. <br>
          <span class="grouped tokenAction">
            <input v-model="destinationAddr" placeholder="destinationAddr">
            <span style="width: 100%; position: relative; display: flex; margin: 0">
              <input v-model="reservedSupplyInput" placeholder="reservedSupply" name="tokenAmountInput">
              <i class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? "tokens" }}
              </i>
            </span>
          </span>
          <input @click="transferAuth()" type="button" class="primaryButton" value="Transfer Auth"  style="margin-top: 10px;">
        </div>
      </div>
    </fieldset>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>