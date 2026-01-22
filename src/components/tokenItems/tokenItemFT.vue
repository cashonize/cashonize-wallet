<script setup lang="ts">
  import { ref, toRefs, computed, watch } from 'vue';
  import { TokenSendRequest, type SendRequest } from "mainnet-js"
  import { decodeCashAddress } from "@bitauth/libauth"
  import alertDialog from 'src/components/general/alertDialog.vue'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import type { TokenDataFT, BcmrTokenMetadata } from "src/interfaces/interfaces"
  import { queryTotalSupplyFT, queryReservedSupply } from "src/queryChainGraph"
  import { copyToClipboard } from 'src/utils/utils';
  import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { caughtErrorToString } from 'src/utils/errorHandling'
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
  const activeAction = ref<'sending' | 'burning' | 'transferAuth' | null>(null);

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.tokenId];

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  const MAX_SUPPLY_FTS = 9_223_372_036_854_775_807n

  const tokenName = computed(() => {
    return tokenMetaData.value?.name;
  })

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalSupplyFT.value && tokenData.value?.amount){
      try {
        const [totalSupply, reserved] = await Promise.all([
          queryTotalSupplyFT(tokenData.value.tokenId, settingsStore.chaingraph),
          queryReservedSupply(tokenData.value.tokenId, settingsStore.chaingraph)
        ]);
        totalSupplyFT.value = totalSupply;
        reservedSupply.value = reserved;
      } catch (error) {
        console.error("Failed to fetch token supply stats:", error);
      }
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
    parseAddrParams();
  }
  
  function parseAddrParams(){
    if(!isBip21Uri(destinationAddr.value) || !destinationAddr.value.includes("?")) return;

    // Parse BIP21 URIs with query params
    try {
      const parsed = parseBip21Uri(destinationAddr.value);

      const validationError = getBip21ValidationError(parsed);
      if (validationError) {
        $q.notify({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // Check if c= is for a different token
      if(parsed.otherParams?.c && parsed.otherParams.c !== tokenData.value.tokenId){
        const message = "This payment request is for a different token";
        $q.notify({ message, icon: 'warning', color: "grey-7" });
        return;
      }

      // Set the address (without query params)
      destinationAddr.value = parsed.address;

      // Auto-fill fungible token amount if c= matches this token
      // Supports both ft= (spec proposal) and f= (Paytaca) - they are equivalent
      // Amount is in base token units, so apply the decimals from token metadata
      // e.g. ft=10000 with 2 decimals = 100 tokens displayed to user
      const ftParam = parsed.otherParams?.ft ?? parsed.otherParams?.f;
      if(parsed.otherParams?.c === tokenData.value.tokenId && ftParam){
        const decimals = tokenMetaData.value?.token?.decimals ?? 0;
        const ftBaseUnits = parseInt(ftParam, 10);
        if (!isNaN(ftBaseUnits) && ftBaseUnits >= 0) {
          const humanReadable = decimals ? ftBaseUnits / (10 ** decimals) : ftBaseUnits;
          tokenSendAmount.value = String(humanReadable);
        }
      }
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
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      if((store.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      if(!destinationAddr.value) throw("No destination address provided")
      if(!tokenSendAmount?.value) throw(`No valid amount provided`);
      const sanitizedInput = tokenSendAmount.value.replace(/,/g, '');
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      checkValidTokenInput(sanitizedInput, decimals)
      const amountTokensNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
      const amountTokensInt = typeof amountTokensNumber == "number" ? BigInt(Math.round(amountTokensNumber)): BigInt(amountTokensNumber)
      const amountSentFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
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
        const authConfirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: 'Auth Warning',
            message: 'You risk unintentionally sending the authority to update this token\'s metadata elsewhere.<br>Are you sure you want to send the transaction anyways?',
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: 'Continue', color: 'red', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!authConfirmed) return
      }

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? tokenData.value.tokenId.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: 'Confirm Token Send',
            message: `Send ${amountSentFormatted} ${tokenSymbol} to<br>${truncatedAddr}`,
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: 'Confirm', color: 'primary', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!confirmed) return
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
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    }catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function burnFungibles(){
    if (activeAction.value) return;
    activeAction.value = 'burning';
    try {
      if((store.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      if(!burnAmountFTs?.value) throw(`Amount tokens to burn must be a valid integer`);
      const sanitizedInput = burnAmountFTs.value.replace(/,/g, '');
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      checkValidTokenInput(sanitizedInput, decimals)
      const amountTokensNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
      const amountTokensInt = typeof amountTokensNumber == "number" ? BigInt(Math.round(amountTokensNumber)): BigInt(amountTokensNumber)
      if(amountTokensInt > tokenData.value.amount) throw(`Insufficient token balance`);
      const tokenId = tokenData.value.tokenId;

      const amountBurnFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
      const tokenSymbol = tokenMetaData.value?.token?.symbol ?? 'tokens'
      const confirmed = await new Promise<boolean>((resolve) => {
        $q.dialog({
          title: 'Burn Tokens',
          message: `You are about to burn ${amountBurnFormatted} ${tokenSymbol}, this cannot be undone.<br>Are you sure you want to burn the tokens?`,
          html: true,
          cancel: { flat: true, color: 'dark' },
          ok: { label: 'Burn', color: 'red', textColor: 'white' },
          persistent: true
        }).onOk(() => resolve(true))
          .onCancel(() => resolve(false))
      })
      if (!confirmed) return

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
    } finally {
      activeAction.value = null;
    }
  }
  async function transferAuth() {
    if (activeAction.value) return;
    if(!tokenData.value?.authUtxo) return;
    if(!reservedSupplyInput?.value) throw(`Amount tokens for reserved supply must be a valid integer`);
    const decimals = tokenMetaData.value?.token?.decimals ?? 0;
    const sanitizedInput = reservedSupplyInput.value.replace(/,/g, '');
    checkValidTokenInput(sanitizedInput, decimals)
    const reservedSupplyNumber = decimals ? +sanitizedInput * (10 ** decimals) : sanitizedInput;
    const reservedSupply = typeof reservedSupplyNumber == "number" ? BigInt(Math.round(reservedSupplyNumber)): BigInt(reservedSupplyNumber)
    if(reservedSupply > tokenData.value.amount) throw(`Insufficient token balance`);
    const tokenId = tokenData.value.tokenId;
    activeAction.value = 'transferAuth';
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
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch (error) {
      handleTransactionError(error);
    } finally {
      activeAction.value = null;
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
  <div class="item">
    <fieldset style="position: relative;">
      <div class="tokenInfo">
        <TokenIcon
          v-if="settingsStore.loadTokenIcons"
          class="tokenIcon"
          :token-id="tokenData.tokenId"
          :icon-url="store.tokenIconUrl(tokenData.tokenId)"
          :size="48"
        />
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
        <span v-if="settingsStore.showTokenVisibilityToggle" @click="store.toggleHidden(tokenData.tokenId)" class="boxStarIcon" :title="settingsStore.hiddenTokens.includes(tokenData.tokenId) ? 'Unhide token' : 'Hide token'">
          <img :src="settingsStore.hiddenTokens.includes(tokenData.tokenId)
            ? (settingsStore.darkMode ? 'images/eye-off-outline-lightGrey.svg' : 'images/eye-off-outline.svg')
            : (settingsStore.darkMode ? 'images/eye-outline-lightGrey.svg' : 'images/eye-outline.svg')">
        </span>
        <span @click="store.toggleFavorite(tokenData.tokenId)" class="boxStarIcon" :title="settingsStore.featuredTokens.includes(tokenData.tokenId) ? 'Unfavorite token' : 'Favorite token'">
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
          <span v-if="settingsStore.showCauldronSwap && store.wallet.network == 'mainnet'" style="white-space: nowrap;">
            <a :href="`https://app.cauldron.quest/swap/${tokenData.tokenId}`" target="_blank" style="color: var(--font-color);">
              <img class="icon" :src="settingsStore.darkMode? 'images/cauldronLightGrey.svg' : 'images/cauldron.svg'"> swap
            </a>
          </span>
          <span v-if="settingsStore.tokenBurn && tokenData?.amount" @click="displayBurnFungibles = !displayBurnFungibles" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            burn tokens
          </span>
          <span v-if="settingsStore.authchains && tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;">
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
                <input v-model="destinationAddr" @input="parseAddrParams()" name="tokenAddress" placeholder="token address">
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
          <input @click="sendTokens()" type="button" class="primaryButton" :value="activeAction === 'sending' ? 'Sending...' : 'Send'" :disabled="activeAction !== null">
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
          <input @click="burnFungibles()" type="button" :value="activeAction === 'burning' ? 'Burning...' : 'burn tokens'" class="button error" style="margin-top: 10px;" :disabled="activeAction !== null">
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
          <input @click="transferAuth()" type="button" class="primaryButton" :value="activeAction === 'transferAuth' ? 'Transferring Auth...' : 'Transfer Auth'" style="margin-top: 10px;" :disabled="activeAction !== null">
        </div>
      </div>
    </fieldset>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>