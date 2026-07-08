<script setup lang="ts">
  import { ref, toRefs, computed, watch } from 'vue';
  import { TokenSendRequest, convert } from "mainnet-js"
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import type { TokenDataFT, BcmrTokenMetadata, TokenActionType } from "src/interfaces/interfaces"
  import { copyToClipboard, formatFiatAmount, sanitizeUrl, parseTokenAmountToBigInt } from 'src/utils/utils';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { parseTokenRecipientRequest, getCashAddressScanError, validateTokenRecipientAddress } from 'src/utils/tokenRecipientUtils'
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { calculateTokenFiatValue } from 'src/utils/cauldronApi'
  import { useI18n } from 'vue-i18n'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  import { useWindowSize } from 'src/utils/composables'
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
  const showQrCodeDialog = ref(false);
  const burnAmountFTs = ref("");
  const reservedSupplyInput = ref("")
  const tokenMetaData = ref(undefined as (BcmrTokenMetadata | undefined));
  const activeAction = ref<TokenActionType | null>(null);

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.category];

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  const tokenName = computed(() => {
    return tokenMetaData.value?.name;
  })

  // Fiat value of fungible token holdings using Cauldron DEX price data
  const holdingsFiatValue = ref<number | null>(null);

  // Watch for changes in the relevant data and recalculate fiat value
  // Note: could be a computed if BCH exchange rate was available synchronously
  watch(
    [() => settingsStore.showCauldronFTValue, () => store.cauldronPrices, () => tokenData.value.amount, () => settingsStore.currency],
    async () => {
      if (!settingsStore.showCauldronFTValue || store.network !== 'mainnet') {
        holdingsFiatValue.value = null;
        return;
      }

      const poolPriceData = store.cauldronPrices?.[tokenData.value.category];
      if (!poolPriceData?.hasSufficientLiquidity) {
        holdingsFiatValue.value = null;
        return;
      }

      try {
        const bchRate = await convert(1, 'bch', settingsStore.currency);
        holdingsFiatValue.value = calculateTokenFiatValue(tokenData.value.amount, poolPriceData, bchRate);
      } catch {
        holdingsFiatValue.value = null;
      }
    },
    { immediate: true }
  );

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
  function parseAddrParams(){
    const parsed = parseTokenRecipientRequest(destinationAddr.value, tokenData.value.category);
    if(!parsed) return;
    destinationAddr.value = parsed.address;

    // Auto-fill fungible token amount from token payment requests.
    const fungibleAmountParam = parsed.otherParams?.ft ?? parsed.otherParams?.f;
    if(parsed.otherParams?.c === tokenData.value.category && fungibleAmountParam){
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      const amountBaseUnits = parseInt(fungibleAmountParam, 10);
      if (!isNaN(amountBaseUnits) && amountBaseUnits >= 0) {
        const humanReadableAmount = decimals ? amountBaseUnits / (10 ** decimals) : amountBaseUnits;
        tokenSendAmount.value = String(humanReadableAmount);
      }
    }
  }
  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams();
  }
  const qrFilter = (content: string) => getCashAddressScanError(content, store.wallet.networkPrefix) ?? true;
  async function sendTokens(){
    if (activeAction.value) return;
    activeAction.value = 'sending';
    try{
      if((store.balance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));
      destinationAddr.value = validateTokenRecipientAddress(destinationAddr.value, store.wallet.networkPrefix, { requireTokenSupport: true });
      if(!tokenSendAmount?.value) throw new Error(t('tokenItem.errors.noValidAmount'));
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      const amountTokensInt = parseTokenAmountToBigInt(tokenSendAmount.value, decimals);
      const amountSentFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
      if(amountTokensInt > tokenData.value.amount) throw new Error(t('tokenItem.errors.insufficientBalance'));
      if(tokenData.value?.authUtxo){
        const authConfirmed = await confirmDialog(
          t('tokenItem.dialogs.authWarning.title'),
          t('tokenItem.dialogs.authWarning.message'),
          t('tokenItem.dialogs.authWarning.continueButton'),
          'red'
        )
        if (!authConfirmed) return
      }

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const tokenSymbol = tokenMetaData.value?.token?.symbol ?? tokenData.value.category.slice(0, 8)
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const confirmed = await confirmDialog(
          t('tokenItem.dialogs.confirmTokenSend.title'),
          t('tokenItem.dialogs.confirmTokenSend.message', { amount: amountSentFormatted, symbol: tokenSymbol, address: truncatedAddr }),
          t('tokenItem.dialogs.confirmButton')
        )
        if (!confirmed) return
      }

      const category = tokenData.value.category;
      notifySending();
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          amount: amountTokensInt,
          category: category,
        }),
      ]);
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      let alertMessage = t('tokenItem.alerts.sentTokensNoSymbol', { amount: amountSentFormatted, tokenId: displayId, address: destinationAddr.value });
      if (tokenMetaData.value?.token?.symbol) {
        alertMessage = t('tokenItem.alerts.sentTokens', { amount: amountSentFormatted, symbol: tokenMetaData.value.token.symbol, address: destinationAddr.value });
      }
      tokenSendAmount.value = "";
      destinationAddr.value = "";
      displaySendTokens.value = false;
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.transactionSent'));
    }catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function burnFungibles(){
    if (activeAction.value) return;
    activeAction.value = 'burning';
    try {
      if((store.balance ?? 0n) < 550n) throw new Error(t('tokenItem.errors.needBchForFee'));
      if(!burnAmountFTs?.value) throw new Error(t('tokenItem.errors.amountMustBeInteger'));
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      const amountTokensInt = parseTokenAmountToBigInt(burnAmountFTs.value, decimals);
      if(amountTokensInt > tokenData.value.amount) throw new Error(t('tokenItem.errors.insufficientBalance'));
      const category = tokenData.value.category;

      const amountBurnFormatted = numberFormatter.format(toAmountDecimals(amountTokensInt))
      const tokenSymbol = tokenMetaData.value?.token?.symbol ?? t('tokenItem.tokens')
      const confirmed = await confirmDialog(
        t('tokenItem.dialogs.burnTokens.title'),
        t('tokenItem.dialogs.burnTokens.message', { amount: amountBurnFormatted, symbol: tokenSymbol }),
        t('tokenItem.dialogs.burnTokens.burnButton'),
        'red'
      )
      if (!confirmed) return

      notifySending();
      const { txId } = await store.wallet.tokenBurn({
          category: category,
          amount: amountTokensInt,
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      let alertMessage = t('tokenItem.alerts.burnedTokensNoSymbol', { amount: amountBurnFormatted, category: displayId });
      if (tokenMetaData.value?.token?.symbol) {
        alertMessage = t('tokenItem.alerts.burnedTokens', { amount: amountBurnFormatted, symbol: tokenMetaData.value.token.symbol });
      }
      burnAmountFTs.value = "";
      displayBurnFungibles.value = false;
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.burnSuccessful'));
    } catch (error) {
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function transferAuth() {
    if (activeAction.value) return;
    if(!tokenData.value?.authUtxo) return;
    activeAction.value = 'transferAuth';
    try {
      if(!reservedSupplyInput?.value) throw new Error(t('tokenItem.errors.reservedSupplyInvalid'));
      const decimals = tokenMetaData.value?.token?.decimals ?? 0;
      const reservedSupply = parseTokenAmountToBigInt(reservedSupplyInput.value, decimals);
      if(reservedSupply > tokenData.value.amount) throw new Error(t('tokenItem.errors.insufficientBalance'));
      const category = tokenData.value.category;
      destinationAddr.value = validateTokenRecipientAddress(destinationAddr.value, store.wallet.networkPrefix);
      const authTransfer = !reservedSupply? {
        cashaddr: destinationAddr.value,
        value: 1000n,
      } : new TokenSendRequest({
        cashaddr: destinationAddr.value,
        category: category,
        amount: reservedSupply
      });
      const outputs = [authTransfer];
      const changeAmount = reservedSupply? tokenData.value.amount - reservedSupply : tokenData.value.amount;
      if(changeAmount){
        const changeOutput = new TokenSendRequest({
          cashaddr: store.wallet.getTokenDepositAddress(),
          category: category,
          amount: changeAmount
        });
        outputs.push(changeOutput)
      }
      notifySending();
      const { txId } = await store.wallet.send(outputs, { ensureUtxos: [tokenData.value.authUtxo] });
      const displayId = `${category.slice(0, 20)}...${category.slice(-8)}`;
      const alertMessage = t('tokenItem.alerts.transferredAuth', { category: displayId, address: destinationAddr.value });
      displayAuthTransfer.value = false;
      destinationAddr.value = "";
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('tokenItem.success.authTransferSuccessful'));
    } catch (error) {
      displayAndLogError(error);
    } finally {
      activeAction.value = null;
    }
  }
</script>

<template>
  <div class="item">
    <fieldset style="position: relative;">
      <div class="tokenInfo">
        <TokenIcon
          class="tokenIcon"
          :token-id="tokenData.category"
          :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(tokenData.category) : undefined"
          :size="48"
        />
        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName">{{ t('tokenItem.name') }} {{ tokenName }}</div>
            <div style="word-break: break-all;">
              {{ t('tokenItem.tokenId') }}
              <span @click="copyToClipboard(tokenData.category)">
                <span class="category" style="cursor: pointer;">
                  {{ !isMobile ? `${tokenData.category.slice(0, 20)}...${tokenData.category.slice(-8)}` :  `${tokenData.category.slice(0, 10)}...${tokenData.category.slice(-8)}`}}
                </span>
                <img class="copyIcon" src="images/copyGrey.svg">
              </span>
            </div>
            <div style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="tokenData?.amount" class="tokenAmount">{{ t('tokenItem.amount') }}
            {{ numberFormatter.format(toAmountDecimals(tokenData?.amount)) }} {{ tokenMetaData?.token?.symbol }}
            <span v-if="holdingsFiatValue !== null" style="font-size: smaller; color: grey; white-space: nowrap;">
              ≈ {{ formatFiatAmount(holdingsFiatValue, settingsStore.currency) }}
            </span>
          </div>
        </div>
        <span v-if="settingsStore.showTokenVisibilityToggle" @click="store.toggleHidden(tokenData.category)" class="boxStarIcon" :title="settingsStore.hiddenTokens.includes(tokenData.category) ? t('tokenItem.visibility.unhideToken') : t('tokenItem.visibility.hideToken')">
          <img :src="settingsStore.hiddenTokens.includes(tokenData.category)
            ? (settingsStore.darkMode ? 'images/eye-off-outline-lightGrey.svg' : 'images/eye-off-outline.svg')
            : (settingsStore.darkMode ? 'images/eye-outline-lightGrey.svg' : 'images/eye-outline.svg')">
        </span>
        <span @click="store.toggleFavorite(tokenData.category)" class="boxStarIcon" :title="settingsStore.featuredTokens.includes(tokenData.category) ? t('tokenItem.visibility.unfavoriteToken') : t('tokenItem.visibility.favoriteToken')">
          <img :src="settingsStore.featuredTokens.includes(tokenData.category) ? 'images/star-full.svg' :
            settingsStore.darkMode? 'images/star-empty-grey.svg' : 'images/star-empty.svg'">
        </span>
      </div>

      <div class="tokenActions">
        <div class="actionBar">
          <span @click="displaySendTokens = !displaySendTokens" style="margin-left: 10px;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> {{ t('tokenItem.actions.send') }} </span>
          <span @click="displayTokenInfo = !displayTokenInfo">
            <img class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> {{ t('tokenItem.actions.info') }}
          </span>
          <span v-if="settingsStore.showCauldronSwap && store.wallet.network == 'mainnet'" style="white-space: nowrap;">
            <a :href="`https://app.cauldron.quest/swap/${tokenData.category}`" target="_blank" style="color: var(--font-color);">
              <img class="icon" :src="settingsStore.darkMode? 'images/cauldronLightGrey.svg' : 'images/cauldron.svg'"> {{ t('tokenItem.actions.swap') }}
            </a>
          </span>
          <span v-if="settingsStore.tokenBurn && tokenData?.amount" @click="displayBurnFungibles = !displayBurnFungibles" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            {{ t('tokenItem.actions.burnTokens') }}
          </span>
          <span v-if="settingsStore.authchains && tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/shieldLightGrey.svg' : 'images/shield.svg'">
            {{ t('tokenItem.actions.authTransfer') }}
          </span>
        </div>
        <div v-if="displayTokenInfo" class="tokenAction">
          <div></div>
          <div v-if="tokenMetaData?.description" class="indentText"> {{ t('tokenItem.info.tokenDescription') }} {{ tokenMetaData.description }} </div>
          <div v-if="tokenMetaData?.token?.symbol">
            {{ t('tokenItem.info.tokenSymbol') }} {{ tokenMetaData.token.symbol }}
          </div>
          <div v-if="tokenData.amount && tokenMetaData">
            {{ t('tokenItem.info.numberOfDecimals') }} {{ tokenMetaData?.token?.decimals ?? 0 }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            {{ t('tokenItem.info.tokenWebLink') }}
            <a v-if="sanitizeUrl(tokenMetaData.uris.web)" :href="sanitizeUrl(tokenMetaData.uris.web)" target="_blank">{{ tokenMetaData.uris.web }}</a>
            <span v-else style="color: var(--color-error);">{{ t('common.unsafeUrl') }}</span>
          </div>
          <div>
            <a style="color: var(--font-color); cursor: pointer;" :href="'https://tokenexplorer.cash/?tokenId=' + tokenData.category" target="_blank">
              {{ t('tokenItem.info.seeDetailsOnExplorer') }} <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;"/>
            </a>
          </div>
        </div>

        <div v-if="displaySendTokens" class="tokenAction">
          {{ t('tokenItem.sendTokens.title') }}
          <div class="inputGroup">
            <div class="addressInputFtSend">
              <span style="width: 100%; position: relative;">
                <input v-model="destinationAddr" @input="parseAddrParams()" name="tokenAddress" :placeholder="t('tokenItem.sendTokens.addressPlaceholder')">
              </span>
              <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
                <img src="images/qrscan.svg" />
              </button>
            </div>
            <div class="sendTokenAmount">
              <span style="width: 100%; position: relative;">
                <input v-model="tokenSendAmount" :placeholder="t('tokenItem.sendTokens.amountPlaceholder')" name="tokenAmountInput">
                <i class="input-icon" style="width: min-content; padding-right: 15px; color: black;">
                  {{ tokenMetaData?.token?.symbol ?? t('tokenItem.tokens') }}
                </i>
              </span>
              <button @click="maxTokenAmount(true)" style="color: black;">{{ t('tokenItem.actions.max') }}</button>
            </div>
          </div>
          <input @click="sendTokens()" type="button" class="primaryButton" :value="activeAction === 'sending' ? t('tokenItem.sendTokens.sendingButton') : t('tokenItem.sendTokens.sendButton')" :disabled="activeAction !== null">
        </div>
        <div v-if="displayBurnFungibles" class="tokenAction">
          <div>{{ t('tokenItem.burn.description') }}</div>
          <div style="display: flex">
            <span style="width: 50%; position: relative; display: flex;">
              <input v-model="burnAmountFTs" :placeholder="t('tokenItem.sendTokens.amountTokensPlaceholder')" name="tokenAmountInput">
              <i class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? t('tokenItem.tokens') }}
              </i>
            </span>
            <button @click="maxTokenAmount(false)" style="color: black;">{{ t('tokenItem.actions.max') }}</button>
          </div>
          <input @click="burnFungibles()" type="button" :value="activeAction === 'burning' ? t('tokenItem.burn.burningButton') : t('tokenItem.burn.burnButton')" class="button error" style="margin-top: 10px;" :disabled="activeAction !== null">
        </div>
        <div v-if="displayAuthTransfer" class="tokenAction">
          {{ t('tokenItem.authTransfer.description') }} <br>
          <i18n-t keypath="tokenItem.authTransfer.dedicatedWalletNote" tag="span">
            <template #link>
              <a href="https://cashtokens.studio/" target="_blank">CashTokens Studio</a>
            </template>
          </i18n-t><br>
          {{ t('tokenItem.authTransfer.reservedSupplyNote') }} <br>
          <span class="grouped tokenAction">
            <input v-model="destinationAddr" :placeholder="t('tokenItem.authTransfer.destinationPlaceholder')">
            <span style="width: 100%; position: relative; display: flex; margin: 0">
              <input v-model="reservedSupplyInput" :placeholder="t('tokenItem.authTransfer.reservedSupplyPlaceholder')" name="tokenAmountInput">
              <i class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? t('tokenItem.tokens') }}
              </i>
            </span>
          </span>
          <input @click="transferAuth()" type="button" class="primaryButton" :value="activeAction === 'transferAuth' ? t('tokenItem.authTransfer.transferringButton') : t('tokenItem.authTransfer.transferButton')" style="margin-top: 10px;" :disabled="activeAction !== null">
        </div>
      </div>
    </fieldset>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>
