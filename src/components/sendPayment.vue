<script setup lang="ts">
  // The send page: BCH, or one of the fungible tokens the wallet holds. NFTs are sent from their
  // own rows on the Tokens tab.
  import { ref, computed, watch } from 'vue'
  import { convert } from '@cashonize/bch-wallet-lib'
  import { CurrencySymbols, CurrencyShortNames } from 'src/interfaces/interfaces'
  import { formatFiatAmount, formatNumber, formatTokenAmount, formatTokenAmountFromBigInt, convertToCurrency, fiatToTypedAmount, readTypedSatoshis, satoshisToTypedAmount, hiddenAmount } from 'src/utils/utils';
  import { readTypedAmount, toTypedAmount, typedAmountMessage } from 'src/utils/numberFormat';
  import { parseBip21Uri, isBip21Uri } from 'src/utils/payments/bip21';
  import { getCashAddressScanError } from 'src/utils/payments/recipientAddress';
  import { parsePayProParams, getPaymentRequestValidationError } from 'src/utils/payments/paymentRequest';
  import { sendFungibleTokens, sendableFungibleTokens } from 'src/utils/payments/sendFungibleTokens';
  import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmSend, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import BackRow from './general/BackRow.vue';
  import TokenIcon from './general/TokenIcon.vue';
  import TokenFiatValue from './general/TokenFiatValue.vue';
  import TokenSelectDialog from './general/tokenSelectDialog.vue';
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';
  import QrScanButton from './qr/qrScanButton.vue';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    // an address or payment request the wallet was handed: a deep link, or the general scanner
    bchSendRequest: string | undefined
  }>()

  // What is being sent: a token's category, or empty for BCH
  const selectedCategory = ref("");
  const bchSendAmount = ref("");
  const currencySendAmount = ref("");
  const tokenSendAmount = ref("");
  const destinationAddr = ref("");
  const showQrCodeDialog = ref(false);
  const isSending = ref(false);

  const bchDisplayUnit = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " sats"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " tsats"
  })
  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  })
  const currencyDisplayShortName = computed(() => {
    return (store.network == "mainnet" ? "" : "t") + CurrencyShortNames[settingsStore.currency];
  });
  const satsInBchUnit = (sats: bigint) => settingsStore.bchUnit === 'sat' ? Number(sats) : Number(sats) / 100_000_000;
  // The balance is a page away from this form, so what can be sent is said here, with the part of
  // the balance that is held back when there is one
  const availableDisplay = computed(() => {
    if (selectedCategory.value) {
      const amount = settingsStore.hideBalances ? hiddenAmount : formatTokenAmount(tokenBalance.value, tokenDecimals.value);
      return `${amount} ${tokenSymbol.value}`;
    }
    if (store.maxAmountToSend === undefined) return undefined;
    if (settingsStore.hideBalances) return hiddenAmount + displayUnitLong.value;
    return formatNumber(satsInBchUnit(store.maxAmountToSend), 8) + displayUnitLong.value;
  });
  const reservedInBchUnit = computed(() => store.reservedBalance ? satsInBchUnit(store.reservedBalance) : undefined);
  const typedBch = computed(() => readTypedSatoshis(bchSendAmount.value, settingsStore.bchUnit));
  const typedCurrency = computed(() => readTypedAmount(currencySendAmount.value));
  // the bch field empties when the fiat one is refused, so the reason shows under the fields
  const currencyError = computed(() => {
    if (!currencySendAmount.value.trim() || !('problem' in typedCurrency.value)) return undefined;
    return typedAmountMessage(typedCurrency.value.problem);
  });

  // The choice of what to send only shows to a wallet that has one to make
  const sendableTokens = computed(() => sendableFungibleTokens());
  const tokenMetadata = computed(() => store.bcmrRegistries?.[selectedCategory.value]);
  const tokenDecimals = computed(() => tokenMetadata.value?.token?.decimals ?? 0);
  const shortCategory = computed(() => `${selectedCategory.value.slice(0, 8)}...${selectedCategory.value.slice(-8)}`);
  // Token names are not unique, so the id is shown next to the name of the picked token
  const tokenName = computed(() => tokenMetadata.value?.name ?? shortCategory.value);
  const tokenSymbol = computed(() => tokenMetadata.value?.token?.symbol ?? t('tokenItem.tokens'));
  const tokenBalance = computed(() =>
    sendableTokens.value.find(tokenData => tokenData.category === selectedCategory.value)?.amount ?? 0n
  );
  function selectAsset(category: string) {
    if (category === selectedCategory.value) return;
    selectedCategory.value = category;
    // an amount typed for one asset means nothing for the next
    bchSendAmount.value = "";
    currencySendAmount.value = "";
    tokenSendAmount.value = "";
  }
  function openAssetSelectDialog() {
    $q.dialog({
      component: TokenSelectDialog,
      componentProps: { title: t('wallet.selectAsset'), hint: t('wallet.selectAssetHint'), forSending: true },
    }).onOk((category: string) => selectAsset(category));
  }
  // The view is kept alive, and a picked token belongs to the wallet and network it was picked on
  watch(() => store._wallet, () => selectAsset(""));

  // declared before the first request is taken below, which may already need them
  const tokenDataLoaded = computed(() => store.tokenList !== null && store.tokenMetadataLoaded);
  let waitingRequest: string | undefined;
  watch(tokenDataLoaded, (loaded) => {
    if (!loaded || waitingRequest === undefined) return;
    const request = waitingRequest;
    waitingRequest = undefined;
    // unless the field was changed in the meantime
    if (destinationAddr.value === request) parseAddrParams();
  });

  function takeSendRequest() {
    if (!props.bchSendRequest) return;
    destinationAddr.value = props.bchSendRequest;
    parseAddrParams();
  }
  takeSendRequest();
  // The view is kept alive, so setup runs once: a later request only changes the prop
  watch(props, takeSendRequest);

  function parseAddrParams(){
    const addressInput = destinationAddr.value;
    if(!isBip21Uri(addressInput) || !addressInput.includes("?")) return;

    // Parse BIP21 URIs with query params (e.g. bitcoincash:qz...?amount=1&label=Shop)
    try {
      const parsed = parseBip21Uri(addressInput);

      const validationError = getPaymentRequestValidationError(parsed);
      if (validationError) {
        $q.notify({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // A request says what it asks for, so the form follows it whatever was picked before
      const { category: requestedCategory, satoshis: requestedSatoshis, fungibleAmount } = parsePayProParams(parsed);
      if(requestedCategory){
        // Before the token list and its metadata have loaded, as for a request that opens the app,
        // the wallet cannot tell whether it holds the token: the request is read again then
        if(!tokenDataLoaded.value){
          waitingRequest = addressInput;
          return;
        }
        // only fungible tokens are sent from here; an NFT, or a token the wallet has none of to
        // spend, gets pointed at instead
        if(!sendableTokens.value.some(tokenData => tokenData.category === requestedCategory)){
          notifyTokenPaymentRequest(requestedCategory);
          return;
        }
        selectAsset(requestedCategory);
        destinationAddr.value = parsed.address;
        // The amount travels in base units and the field takes whole tokens, so it is only filled
        // in with the token's decimals known: metadata landing later would make the same digits
        // mean another amount
        if(fungibleAmount !== undefined && tokenMetadata.value){
          tokenSendAmount.value = toTypedAmount(formatTokenAmountFromBigInt(fungibleAmount, tokenDecimals.value));
        }
        return;
      }

      // Set the address (without query params)
      selectAsset("");
      destinationAddr.value = parsed.address;

      // Set the amount if present
      if(requestedSatoshis !== undefined){
        bchSendAmount.value = satoshisToTypedAmount(requestedSatoshis, settingsStore.bchUnit);
        void setCurrencyAmount();
      }
    } catch {
      // If parsing fails, leave the input as-is for manual handling
    }
  }
  // A token payment request this form cannot pay, so point at the token it asks for. The wallet
  // only knows a name for tokens it holds or has held.
  function notifyTokenPaymentRequest(category: string){
    const requestedName = store.bcmrRegistries?.[category]?.name;
    const displayName = requestedName ?? `${category.slice(0, 10)}...${category.slice(-8)}`;
    const holdsToken = store.tokenList?.some(tokenData => tokenData.category === category);
    if(!holdsToken){
      $q.notify({
        message: t('wallet.errors.tokenPaymentRequestNotHeld', { token: displayName }),
        icon: 'warning',
        color: "grey-7"
      });
      return;
    }
    $q.notify({
      message: t('wallet.errors.tokenPaymentRequest', { token: displayName }),
      icon: 'info',
      color: "grey-7",
      actions: [{
        label: t('wallet.openInTokens'),
        color: 'white',
        handler: () => {
          store.pendingTokenSearch = category;
          store.changeView(2);
        }
      }]
    });
  }

  async function setCurrencyAmount() {
    if(!('satoshis' in typedBch.value)){
      currencySendAmount.value = ""
      return
    }
    const newCurrencyValue = await convert(Number(typedBch.value.satoshis), "sat", settingsStore.currency);
    currencySendAmount.value = fiatToTypedAmount(newCurrencyValue);
  }
  async function setBchAmount() {
    if('problem' in typedCurrency.value){
      bchSendAmount.value = ""
      return
    }
    const newSatsValue = await convert(Number(typedCurrency.value.amount), settingsStore.currency, "sat");
    bchSendAmount.value = satoshisToTypedAmount(BigInt(Math.round(newSatsValue)), settingsStore.bchUnit);
  }
  function useMaxAmount() {
    if(selectedCategory.value){
      tokenSendAmount.value = toTypedAmount(formatTokenAmountFromBigInt(tokenBalance.value, tokenDecimals.value));
      return;
    }
    if(store.maxAmountToSend && store.balance){
      bchSendAmount.value = satoshisToTypedAmount(store.maxAmountToSend, settingsStore.bchUnit);
      // update currency balance & set currency amount
      if (store.exchangeRate !== undefined) {
        currencySendAmount.value = fiatToTypedAmount(convertToCurrency(store.maxAmountToSend, store.exchangeRate));
      }
    }
    else{
      $q.notify({
        message: t('wallet.errors.noBalance'),
        icon: 'warning',
        color: "grey-7"
      })
    }
  }
  // back to where the form was opened from, the wallet page as a rule, unless the user already moved on
  function returnToWallet() {
    if (store.displayView === 23) store.goBack();
  }
  async function send(){
    if (isSending.value) return;
    isSending.value = true;
    try{
      if(selectedCategory.value) await sendTokens();
      else await sendBch();
    } catch(error){
      displayAndLogError(error)
    } finally {
      isSending.value = false;
    }
  }
  async function sendTokens(){
    await sendFungibleTokens(selectedCategory.value, destinationAddr.value, tokenSendAmount.value, () => {
      tokenSendAmount.value = "";
      destinationAddr.value = "";
      returnToWallet();
    });
  }
  async function sendBch(){
    // check for valid inputs
    if(!destinationAddr.value) throw new Error(t('wallet.errors.noDestination'))
    if(currencyError.value) throw new Error(currencyError.value)
    if(!bchSendAmount.value.trim()) throw new Error(t('wallet.errors.noAmount'))
    if('error' in typedBch.value) throw new Error(typedBch.value.error)
    const amountSats = typedBch.value.satoshis
    if(amountSats > (store.maxAmountToSend ?? 0n)) throw new Error(t('wallet.errors.insufficientFunds'))
    const { address } = normalizeCashAddressForNetwork(destinationAddr.value, store.wallet.networkPrefix, {
      invalidAddress: t('wallet.errors.invalidAddress'),
      wrongNetwork: t('wallet.errors.notCashaddress'),
      legacyAddress: t('wallet.errors.legacyAddress'),
    });
    // the address as checked here is the one sent to: the field can change while the confirmation
    // is open, when a payment link arrives
    destinationAddr.value = address;

    const formattedAmount = formatTokenAmount(amountSats, settingsStore.bchUnit === 'sat' ? 0 : 8)
    const sendInfo = {
      recipient: address,
      amount: formattedAmount,
      unit: bchDisplayUnit.value.trim(),
      fiat: 'amount' in typedCurrency.value ? formatFiatAmount(Number(typedCurrency.value.amount), settingsStore.currency) : undefined,
    }
    // confirm payment if setting is enabled
    if (settingsStore.confirmBeforeSending && !await confirmSend(sendInfo)) return

    const sendBchOutput = { cashaddr: address, value:amountSats } ;
    notifySending(t('wallet.sendingTransaction'));
    const { txId } = await store.spend.send([ sendBchOutput ]);
    const alertMessage = t('wallet.sent', { amount: formattedAmount + displayUnitLong.value, address })
    // reset fields
    bchSendAmount.value = "";
    currencySendAmount.value = "";
    destinationAddr.value = "";
    returnToWallet();
    await handleTransactionBroadcastSuccess(alertMessage, txId, t('wallet.transactionSuccess'), sendInfo);
  }

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams()
  }
  const qrFilter = (content: string) => getCashAddressScanError(content, store.wallet.networkPrefix) ?? true

  // The view is kept alive, so a unit or currency changed in the settings re-expresses the typed amount
  watch(() => settingsStore.bchUnit, (newUnit, previousUnit) => {
    const typed = readTypedSatoshis(bchSendAmount.value, previousUnit);
    if ('satoshis' in typed) bchSendAmount.value = satoshisToTypedAmount(typed.satoshis, newUnit);
  });
  watch(() => settingsStore.currency, () => void setCurrencyAmount());
</script>

<template>
  <fieldset class="item" style="padding-bottom: 2rem;">
    <legend>{{ t('common.actions.send') }}</legend>
    <BackRow @click="store.goBack()" />
    <div
      v-if="sendableTokens.length || selectedCategory"
      class="selectedAsset"
      role="button"
      :title="t('wallet.selectAsset')"
      @click="openAssetSelectDialog()"
    >
      <template v-if="selectedCategory">
        <TokenIcon
          :token-id="selectedCategory"
          :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(selectedCategory) : undefined"
          :size="24"
        />
        <span>{{ tokenName }}</span>
        <span v-if="tokenMetadata?.name" class="assetId">{{ shortCategory }}</span>
      </template>
      <template v-else>
        <img src="images/bch-icon.svg" alt="" class="assetBchIcon">
        <span>Bitcoin Cash</span>
      </template>
      <q-icon name="expand_more" class="assetChevron" size="20px" />
    </div>
    <div style="display: flex; gap: 0.5rem;">
      <input
        v-model="destinationAddr" @input="parseAddrParams()" name="addressInput" autocomplete="off"
        :placeholder="selectedCategory ? t('tokenItem.sendTokens.addressPlaceholder') : t('wallet.addressPlaceholder')"
      >
      <QrScanButton @click="showQrCodeDialog = true" />
    </div>
    <span v-if="selectedCategory" class="sendAmountGroup">
      <span style="position: relative; width: 100%;">
        <input v-model="tokenSendAmount" type="text" inputmode="decimal" :placeholder="t('wallet.amountPlaceholder')" name="tokenAmountInput" autocomplete="off">
        <i class="input-icon" style="width: min-content; padding-right: 15px;">{{ tokenSymbol }}</i>
      </span>
    </span>
    <span v-else class="sendAmountGroup">
      <span style="position: relative; flex: 1;">
        <input v-model="bchSendAmount" @input="setCurrencyAmount()" type="text" inputmode="decimal" :placeholder="t('wallet.amountPlaceholder')" name="currencyInput" autocomplete="off">
        <i class="input-icon">{{ bchDisplayUnit }}</i>
      </span>
      <span class="sendCurrencyInput">
        <input v-model="currencySendAmount" @input="setBchAmount()" type="text" inputmode="decimal" :placeholder="t('wallet.amountPlaceholder')" name="bchAmountInput" autocomplete="off">
        <i class="input-icon">
          {{`${currencyDisplayShortName} ${CurrencySymbols[settingsStore.currency]}`}}
        </i>
      </span>
    </span>
    <TokenFiatValue v-if="selectedCategory" :category="selectedCategory" :typed-amount="tokenSendAmount" class="sendTokenValue" />
    <template v-if="!selectedCategory">
      <div v-if="'satoshis' in typedBch && typedBch.satoshis > (store.maxAmountToSend ?? 0n)" style="color: red;">{{ t('wallet.notEnoughBch') }}</div>
      <div v-if="currencyError" style="color: red;">{{ currencyError }}</div>
    </template>
    <!-- what the form accepts at most, which fills the amount in when clicked: for BCH less than
         the balance, by the fee and by what is held back -->
    <button v-if="availableDisplay" type="button" class="availableRow" @click="useMaxAmount()">
      {{ t('wallet.available', { amount: availableDisplay }) }}
      <span class="useMax">{{ t('wallet.useMax') }}</span>
    </button>
    <div v-if="!selectedCategory && reservedInBchUnit && !settingsStore.hideBalances" class="sendReserved">
      {{ t('wallet.reservedBalance', { amount: formatNumber(reservedInBchUnit, 8) + displayUnitLong }) }}
    </div>
    <input @click="send()" type="button" class="primaryButton" :value="isSending ? t('common.status.sending') : t('common.actions.send')" :disabled="isSending" style="margin-top: 8px;">
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
/* its own gap above, like the row of what is available, which then follows it closely */
.sendTokenValue {
  margin-top: 8px;
}
.sendTokenValue + .availableRow {
  margin-top: 2px;
}
/* same treatment as the token row of the receive page */
.selectedAsset {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  border: 1px solid var(--surface-line);
  background-color: var(--surface-faint);
  border-radius: 6px;
  padding: 8px 10px;
  word-break: break-all;
  cursor: pointer;
  transition: background-color 0.2s;
}
.selectedAsset:hover {
  background-color: var(--surface-strong);
}
.assetBchIcon {
  flex: none;
  width: 24px;
  height: 24px;
}
/* the name is a claim, the id is the token, so it travels along with the name */
.assetId {
  font-family: monospace;
  font-size: 0.85em;
  opacity: 0.65;
}
.assetChevron {
  flex: none;
  margin-left: auto;
}
/* a line of text that is also the way to send everything, not chota's grey button */
.availableRow {
  display: block;
  margin: 8px 0 0;
  padding: 0;
  border: none;
  background: none;
  color: grey;
  font-size: smaller;
  line-height: inherit;
  text-align: left;
}
.availableRow:hover {
  opacity: 1;
}
.useMax {
  margin-left: 6px;
  color: var(--color-primary);
  font-weight: 500;
}
.availableRow:hover .useMax {
  text-decoration: underline;
}
.sendReserved {
  color: grey;
  font-size: smaller;
}
</style>
