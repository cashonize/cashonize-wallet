<script setup lang="ts">
  // The receive page: the wallet's address as a code, and the fields that turn it into a payment
  // request for an amount.
  import BackRow from 'src/components/general/BackRow.vue'
  import { ref, computed, watch, shallowRef, onActivated } from 'vue'
  import { HDWallet, convert } from '@cashonize/bch-wallet-lib'
  import { CurrencyShortNames, type Currency } from 'src/interfaces/interfaces'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { copyToClipboard, fiatToTypedAmount, formatTokenAmount, parseTokenAmountToBigInt, readTypedSatoshis, satoshisToTypedAmount } from 'src/utils/utils'
  import { readTypedAmount, typedAmountMessage } from 'src/utils/numberFormat'
  import { buildPaymentRequestUri } from 'src/utils/payments/paymentRequest'
  import { toTokenAddress } from 'src/utils/addressValidation'
  import CharCounter from 'src/components/general/CharCounter.vue'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import HdAddressSelectDialog from 'src/components/general/hdAddressSelectDialog.vue'
  import TokenSelectDialog from 'src/components/general/tokenSelectDialog.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import QrCode from 'src/components/general/qrCode.vue'
  import QrFullscreenDialog from 'src/components/general/qrFullscreenDialog.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const { t } = useI18n()

  // The message travels in the qr code, so keep it to a line of text
  const maxRequestMessageLength = 100;

  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  // Which of the wallet's two address forms is shown, the plain one or the token-aware one
  const mode = ref<'bch' | 'token'>('bch');
  // The amount, token and message that turn the address into a payment request stay folded away
  // until asked for: most of the time the address is all that is wanted
  const showRequestFields = ref(false);
  const showFullscreenQr = ref(false);
  // A shallowRef, so returning to this kept-alive view does not re-activate deep reactivity
  // over the code's component
  const qrCodeRef = shallowRef<InstanceType<typeof QrCode> | null>(null);

  // The bch amount is typed in the user's display unit, like the send page's
  const requestAmount = ref("");
  const currencyAmount = ref("");
  const tokenAmountInput = ref("");
  const selectedCategory = ref("");
  const requestMessage = ref("");
  // Empty means "follow the wallet's own receive address", so marking an address used or
  // receiving a payment moves the request along to the next one. Set when the user picks
  // an address by hand.
  const pinnedAddress = ref("");

  const requestAddress = computed(() => pinnedAddress.value || store.currentDepositAddress);

  // Token requests have to name a token-aware address
  const effectiveAddress = computed(() => {
    if (mode.value === 'bch' || !requestAddress.value) return requestAddress.value;
    return toTokenAddress(requestAddress.value);
  });

  // Marking starts on the addresses page; a wallet that uses it gets the action here too
  const showMarkUsedAction = computed(() => isHdWallet.value && store.addressMarks.length > 0);

  const bchDisplayNetwork = computed(() => store.network == "mainnet" ? 'BCH' : 'tBCH');
  const bchDisplayUnit = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " sats"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " tsats"
  });
  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  });
  // The currency the amount is typed in, for this request only: someone can ask for 20 USD while
  // their own wallet counts in EUR. The request itself carries the BCH amount either way.
  const requestCurrency = ref<Currency>(settingsStore.currency);
  const currencies = Object.keys(CurrencyShortNames) as Currency[];
  const currencyPrefix = computed(() => store.network == "mainnet" ? "" : "t");
  const currencyDisplayShortName = computed(() => {
    return currencyPrefix.value + CurrencyShortNames[requestCurrency.value];
  });

  const tokenMetadata = computed(() => store.bcmrRegistries?.[selectedCategory.value]);
  const tokenDecimals = computed(() => tokenMetadata.value?.token?.decimals ?? 0);
  const tokenSymbol = computed(() => tokenMetadata.value?.token?.symbol ?? "");
  const shortCategory = computed(() =>
    `${selectedCategory.value.slice(0, 8)}...${selectedCategory.value.slice(-8)}`
  );
  // Token names are not unique, so the id is shown next to the name of the picked token.
  // Without metadata the id is all there is to show.
  const tokenName = computed(() => {
    if (!selectedCategory.value) return undefined;
    return tokenMetadata.value?.name ?? shortCategory.value;
  });

  const typedBch = computed(() => readTypedSatoshis(requestAmount.value, settingsStore.bchUnit));
  const requestSatoshis = computed(() => 'satoshis' in typedBch.value ? typedBch.value.satoshis : undefined);
  const typedCurrency = computed(() => readTypedAmount(currencyAmount.value));
  // a refused amount in either field, said under the fields rather than by an empty request
  const amountError = computed(() => {
    if (requestAmount.value.trim() && 'error' in typedBch.value) return typedBch.value.error;
    if (currencyAmount.value.trim() && 'problem' in typedCurrency.value) return typedAmountMessage(typedCurrency.value.problem);
    return undefined;
  });

  // Amounts are requested in whole tokens and travel in base units, an amount with more
  // decimals than the token has is rejected rather than silently left out of the request
  const parsedTokenAmount = computed<{ baseUnits?: bigint, error?: string }>(() => {
    const input = tokenAmountInput.value.trim();
    if (!input) return {};
    try {
      return { baseUnits: parseTokenAmountToBigInt(input, tokenDecimals.value) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  const requestUri = computed(() => {
    const message = requestMessage.value.trim();
    if (mode.value === 'token') {
      return buildPaymentRequestUri({
        address: effectiveAddress.value,
        category: selectedCategory.value,
        fungibleAmount: parsedTokenAmount.value.baseUnits,
        message,
      });
    }
    return buildPaymentRequestUri({ address: effectiveAddress.value, satoshis: requestSatoshis.value, message });
  });

  // Without an amount, token or message the code is the plain address
  const isRequest = computed(() => requestUri.value !== effectiveAddress.value);
  const qrLabel = computed(() => {
    if (isRequest.value) return t('qrCode.paymentRequest');
    return t(mode.value === 'bch' ? 'qrCode.bchAddress' : 'qrCode.tokenAddress');
  });
  const qrIconSrc = computed(() => mode.value === 'bch' ? 'images/bch-icon.svg' : 'images/tokenicon.svg');

  // What the request actually asks for, restated at the moment the code is handed over
  const requestedAmountDisplay = computed(() => {
    if (mode.value === 'token') {
      const baseUnits = parsedTokenAmount.value.baseUnits;
      if (baseUnits === undefined) return undefined;
      return `${formatTokenAmount(baseUnits, tokenDecimals.value)} ${tokenSymbol.value || tokenName.value}`;
    }
    if(requestSatoshis.value === undefined) return undefined;
    return formatTokenAmount(requestSatoshis.value, settingsStore.bchUnit === 'sat' ? 0 : 8) + displayUnitLong.value;
  });

  // Nothing to request yet, the qr code is still the plain receive address
  const emptyRequestHint = computed(() => {
    if (mode.value === 'token' && !selectedCategory.value) return t('requestPayment.selectTokenPrompt');
    return t('requestPayment.enterAmountHint');
  });

  // Which of the two amounts was typed, the other being derived from it: a change of currency
  // keeps the typed one, so 20 stays 20 when its unit goes from EUR to USD
  let fiatTyped = false;
  // A conversion waits on the exchange rate, so one started for a currency since changed is dropped
  async function setCurrencyAmount() {
    const satoshis = requestSatoshis.value;
    if(satoshis === undefined){
      currencyAmount.value = ""
      return
    }
    const currency = requestCurrency.value;
    const newCurrencyValue = await convert(Number(satoshis), "sat", currency);
    if (currency !== requestCurrency.value) return;
    currencyAmount.value = fiatToTypedAmount(newCurrencyValue);
  }
  async function setBchAmount() {
    if('problem' in typedCurrency.value){
      requestAmount.value = ""
      return
    }
    const currency = requestCurrency.value;
    const newSatsValue = await convert(Number(typedCurrency.value.amount), currency, "sat");
    if (currency !== requestCurrency.value) return;
    requestAmount.value = satoshisToTypedAmount(BigInt(Math.round(newSatsValue)), settingsStore.bchUnit);
  }
  function onBchTyped() {
    fiatTyped = false;
    void setCurrencyAmount();
  }
  function onFiatTyped() {
    fiatTyped = true;
    void setBchAmount();
  }

  // The intro animation plays once per visit and per address form, from the code's 'rendered' event
  function animateQrCode() {
    if (qrCodeRef.value && !settingsStore.hasPlayedAnimation && settingsStore.qrAnimation != 'None') {
      qrCodeRef.value.animate();
      settingsStore.hasPlayedAnimation = true;
    }
  }
  function setMode(newMode: 'bch' | 'token') {
    if (mode.value === newMode) return;
    mode.value = newMode;
    settingsStore.hasPlayedAnimation = false;
  }
  // 'rendered' does not fire for a changed animation setting, and the view is kept alive
  watch(() => settingsStore.qrAnimation, () => {
    if(!settingsStore.hasPlayedAnimation) animateQrCode()
  })

  function openAddressSelectDialog() {
    $q.dialog({
      component: HdAddressSelectDialog,
      componentProps: {
        title: t('requestPayment.selectAddress'),
        hint: t('requestPayment.selectAddressHint'),
        // a request is handed out, so only receive addresses
        allowChangeAddresses: false,
      },
    }).onOk((address: string) => {
      pinnedAddress.value = address;
    });
  }

  function openTokenSelectDialog() {
    $q.dialog({
      component: TokenSelectDialog,
      componentProps: {
        title: t('requestPayment.selectToken'),
        hint: t('requestPayment.selectTokenHint'),
      },
    }).onOk((category: string) => {
      selectedCategory.value = category;
    });
  }

  function markAddressUsed() {
    store.markAddressUsed(requestAddress.value);
    // handing an address out is what a request is for, so the next one starts fresh
    pinnedAddress.value = "";
  }

  // The view is kept alive across navigation, a pinned address and a selected token belong
  // to the wallet and network they were picked on
  watch(() => store._wallet, () => {
    pinnedAddress.value = "";
    selectedCategory.value = "";
    requestAmount.value = "";
    currencyAmount.value = "";
    tokenAmountInput.value = "";
    requestMessage.value = "";
  });
  // A request made earlier is still in the code on a return to this page, so its fields show
  // rather than stay folded over it
  onActivated(() => {
    if (isRequest.value) showRequestFields.value = true;
    // Receive is opened on purpose, so the code's intro plays on every visit
    settingsStore.hasPlayedAnimation = false;
    animateQrCode();
  });

  // Both bch amounts are entered by hand, so they need a nudge when the units they are
  // expressed in change while the view sits in the background
  watch(() => settingsStore.currency, (currency) => { requestCurrency.value = currency });
  watch(requestCurrency, () => void (fiatTyped ? setBchAmount() : setCurrencyAmount()));
  watch(() => settingsStore.bchUnit, (newUnit, previousUnit) => {
    const typed = readTypedSatoshis(requestAmount.value, previousUnit);
    if ('satoshis' in typed) requestAmount.value = satoshisToTypedAmount(typed.satoshis, newUnit);
  });
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('receive.title') }}</legend>
    <BackRow @click="store.goBack()" />

    <div style="text-align: center;">
      <div class="type-filter">
        <button :class="{ active: mode === 'bch' }" @click="setMode('bch')">
          {{ bchDisplayNetwork }}
        </button>
        <button :class="{ active: mode === 'token' }" @click="setMode('token')">
          {{ t('requestPayment.tokensMode') }}
        </button>
      </div>
      <div class="addressHint">{{ t(mode === 'bch' ? 'receive.bchAddressHint' : 'receive.tokenAddressHint') }}</div>
    </div>

    <div class="qrArea">
      <div class="qr-frame">
        <QrCode
          ref="qrCodeRef"
          :contents="requestUri"
          :animation="settingsStore.qrAnimation"
          :label="qrLabel"
          @click="copyToClipboard(requestUri)"
          @rendered="animateQrCode"
          class="qr-code"
        >
          <img :src="qrIconSrc" alt="" />
        </QrCode>
      </div>
      <button
        type="button"
        class="enlarge-qr"
        :title="t('qrCode.enlarge')"
        :aria-label="t('qrCode.enlarge')"
        @click="showFullscreenQr = true"
      >
        <q-icon name="open_in_full" size="20px" />
      </button>
    </div>

    <div v-if="requestedAmountDisplay" class="requestSummary">
      {{ t('requestPayment.requesting', { amount: requestedAmountDisplay }) }}
    </div>

    <div class="selected-item mono" style="margin-top: 12px;">
      <span @click="copyToClipboard(effectiveAddress)" style="cursor: pointer;">
        <span class="depositAddr">{{ effectiveAddress }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
      <button
        v-if="isHdWallet"
        type="button"
        class="selectAddress"
        :title="t('requestPayment.selectAddress')"
        :aria-label="t('requestPayment.selectAddress')"
        @click="openAddressSelectDialog()"
      >
        <q-icon name="expand_more" size="20px" />
      </button>
    </div>

    <div class="requestButtonRow">
      <input
        @click="copyToClipboard(requestUri)"
        type="button"
        class="primaryButton"
        :value="isRequest ? t('requestPayment.copyButton') : t('receive.copyAddress')"
      >
      <input
        v-if="showMarkUsedAction"
        @click="markAddressUsed()"
        type="button"
        class="button"
        :value="t('addressManagement.markAddressUsedAction')"
      >
    </div>

    <button type="button" class="requestToggle" :aria-expanded="showRequestFields" @click="showRequestFields = !showRequestFields">
      {{ t('receive.requestAmount') }}
      <q-icon :name="showRequestFields ? 'keyboard_arrow_up' : 'keyboard_arrow_down'" size="20px" />
    </button>

    <div v-if="showRequestFields">
      <div style="margin-top: 10px;">
        <template v-if="mode === 'bch'">
          {{ t('requestPayment.description') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('requestPayment.bip21Hint') }}</div>
          </InfoPopup>
        </template>
        <template v-else>
          {{ t('requestPayment.descriptionToken') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('requestPayment.tokenStandardHint') }}</div>
            <div class="info-popup-note" style="max-width: 300px;">{{ t('requestPayment.tokenStandardHintNote') }}</div>
          </InfoPopup>
        </template>
      </div>

      <div v-if="mode === 'token'" style="margin-top: 15px;">
        <label>{{ t('requestPayment.tokenLabel') }}</label>
        <button type="button" class="selected-item selectable plain-button" aria-haspopup="dialog" :title="t('requestPayment.selectToken')" @click="openTokenSelectDialog()">
          <TokenIcon
            v-if="selectedCategory"
            :token-id="selectedCategory"
            :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(selectedCategory) : undefined"
            :size="24"
          />
          <span :class="{ 'no-selection': !selectedCategory }">{{ tokenName ?? t('requestPayment.noTokenSelected') }}</span>
          <span v-if="tokenMetadata?.name" class="token-id">{{ shortCategory }}</span>
          <q-icon name="expand_more" class="select-chevron" size="20px" />
        </button>
      </div>

      <div style="margin-top: 15px;">
        <label>{{ t('requestPayment.amountLabel') }}</label>
        <template v-if="mode === 'bch'">
          <div class="amountRow">
            <span class="amountField">
              <input
                v-model="requestAmount"
                @input="onBchTyped()"
                type="text"
                inputmode="decimal"
                :placeholder="t('requestPayment.amountPlaceholder')"
                name="bchAmountInput" autocomplete="off"
              >
              <i class="input-icon">{{ bchDisplayUnit }}</i>
            </span>
            <span class="approxSign">≈</span>
            <span class="amountField">
              <input
                v-model="currencyAmount"
                @input="onFiatTyped()"
                type="text"
                inputmode="decimal"
                :placeholder="t('requestPayment.amountPlaceholder')"
                name="currencyInput" autocomplete="off"
              >
              <select v-model="requestCurrency" class="currencySelect" :aria-label="t('settings.localization.currency')">
                <option v-for="currency in currencies" :key="currency" :value="currency">
                  {{ currencyPrefix + CurrencyShortNames[currency] }}
                </option>
              </select>
            </span>
          </div>
          <div v-if="amountError" style="color: red; margin-top: 6px;">{{ amountError }}</div>
          <div class="amountNote">
            {{ t('requestPayment.amountNote', { network: bchDisplayNetwork, currency: currencyDisplayShortName }) }}
          </div>
        </template>
        <template v-else>
          <div class="amountRow">
            <span class="amountField">
              <input
                v-model="tokenAmountInput"
                inputmode="decimal"
                :disabled="!selectedCategory"
                :placeholder="t('requestPayment.amountPlaceholder')"
                name="tokenAmountInput" autocomplete="off"
              >
              <i v-if="tokenSymbol" class="input-icon">{{ tokenSymbol }}</i>
            </span>
          </div>
          <div v-if="parsedTokenAmount.error" style="color: red; margin-top: 6px;">{{ parsedTokenAmount.error }}</div>
          <div class="warning-box" style="margin-top: 12px;">
            <q-icon name="warning" size="20px" class="warning-box-icon" />
            <div><b>{{ t('common.attention') }}</b> {{ t('requestPayment.tokenSupportWarning') }}</div>
          </div>
        </template>
      </div>

      <div style="margin-top: 15px;">
        <label>
          {{ t('requestPayment.messageLabel') }}
          <CharCounter :length="requestMessage.length" :max-length="maxRequestMessageLength" />
        </label>
        <input
          v-model="requestMessage"
          type="text"
          :maxlength="maxRequestMessageLength"
          :placeholder="t('requestPayment.messagePlaceholder')"
        >
      </div>

      <div v-if="isRequest" class="requestUri" @click="copyToClipboard(requestUri)">{{ requestUri }}</div>
      <div v-else class="requestHint">{{ emptyRequestHint }}</div>
    </div>
  </fieldset>

  <QrFullscreenDialog
    v-model="showFullscreenQr"
    :contents="requestUri"
    :label="qrLabel"
    :icon-src="qrIconSrc"
    :caption="requestedAmountDisplay && t('requestPayment.requesting', { amount: requestedAmountDisplay })"
    :address="effectiveAddress"
  />
</template>

<style scoped>
.amountRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
/* the fields share the row evenly, the icon inside them needs the positioning context */
.amountField {
  position: relative;
  flex: 1 1 0;
  min-width: 110px;
}
/* the fiat field's unit, which is also the choice of it: sits inside the field like the other
   fields' unit labels, without the frame of a form control */
.currencySelect {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  width: auto;
  margin: 0;
  /* room for chota's caret, which this places in the padding instead of over the text */
  padding: 2px 18px 2px 4px;
  border: none;
  background-color: transparent;
  background-origin: padding-box;
  background-position: right 4px center;
  color: var(--font-color);
  cursor: pointer;
}
/* the list the browser opens takes its colours from the options, and the select itself is see-through */
body.dark .currencySelect option {
  background-color: var(--bg-secondary-color);
  color: #fff;
}
/* the typed amount stops short of the unit */
.amountField input {
  padding-right: 62px;
}
/* marks the currency field as the derived one, the request itself is in bch */
.approxSign {
  flex: none;
  color: grey;
}
.amountNote {
  font-size: smaller;
  color: grey;
  margin-top: 6px;
}
/* same treatment as the address row in the sign / verify message tool */
.selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--surface-line);
  background-color: var(--surface-faint);
  border-radius: 6px;
  padding: 8px 10px;
  word-break: break-all;
}
.selected-item.mono {
  font-family: monospace;
}
.selected-item .no-selection {
  color: grey;
}
/* the name is a claim, the id is the token, so it travels along with the name */
.token-id {
  font-family: monospace;
  font-size: 0.85em;
  opacity: 0.65;
}
.selected-item.selectable {
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}
.selected-item.selectable:hover {
  background-color: var(--surface-strong);
}
.select-chevron {
  flex: none;
  margin-left: auto;
}
/* the frame's size, background and dark mode crop are shared with the address dialog, see
   app.css; it clips what overflows, so the enlarge button hangs off this wrapper instead */
.qrArea {
  position: relative;
  width: fit-content;
  margin: 12px auto 0 auto;
}
/* opens the code over the whole screen, from beside the frame's top corner */
.enlarge-qr {
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 6px;
}
/* the chevron that opens the wallet's other addresses, at the end of the address row */
.selectAddress {
  flex: none;
  margin: 0 0 0 auto;
  padding: 2px;
  border: none;
  background: none;
  color: var(--font-color);
}
.addressHint {
  margin-top: 8px;
  font-size: smaller;
  color: grey;
}
/* a quiet row that unfolds the request fields, not chota's grey button */
.requestToggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 18px 0 0 -6px;
  padding: 6px;
  border: none;
  background: none;
  color: var(--font-color);
  font-weight: 500;
}
.requestToggle:hover {
  opacity: 1;
  background: var(--surface-strong);
}
.requestSummary {
  margin-top: 12px;
  text-align: center;
  font-size: 1.1em;
}
.requestHint {
  margin-top: 12px;
  text-align: center;
  font-size: smaller;
  color: grey;
}
.requestUri {
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid var(--surface-line);
  background-color: var(--surface-faint);
  border-radius: 6px;
  font-family: monospace;
  font-size: smaller;
  word-break: break-all;
  cursor: pointer;
}
.requestButtonRow {
  display: flex;
  gap: 0.5rem;
  margin-top: 12px;
  flex-wrap: wrap;
}
</style>
