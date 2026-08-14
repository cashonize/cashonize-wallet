<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { HDWallet, convert } from 'mainnet-js'
  import { CurrencySymbols, CurrencyShortNames } from 'src/interfaces/interfaces'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { copyToClipboard, formatNumber, parseTokenAmountToBigInt } from 'src/utils/utils'
  import { buildBip21Uri } from 'src/utils/payments/bip21'
  import { toTokenAddress } from 'src/utils/addressValidation'
  import CharCounter from 'src/components/general/CharCounter.vue'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import HdAddressSelectDialog from 'src/components/general/hdAddressSelectDialog.vue'
  import TokenSelectDialog from 'src/components/general/tokenSelectDialog.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const { t } = useI18n()

  // The message travels in the qr code, so keep it to a line of text
  const maxRequestMessageLength = 100;

  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  const mode = ref<'bch' | 'token'>('bch');

  // The bch amount is held in the user's display unit, like the send form on the wallet page.
  // The token amount stays a string, so its decimals are parsed with string math.
  const requestAmount = ref(undefined as number | undefined);
  const currencyAmount = ref(undefined as number | undefined);
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

  const showMarkUsedAction = computed(() => settingsStore.enableAddressMarking && isHdWallet.value);

  const bchDisplayNetwork = computed(() => store.network == "mainnet" ? 'BCH' : 'tBCH');
  const bchDisplayUnit = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " sats"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " tsats"
  });
  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  });
  const currencyDisplayShortName = computed(() => {
    return (store.network == "mainnet" ? "" : "t") + CurrencyShortNames[settingsStore.currency];
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

  const requestSatoshis = computed(() => {
    const amount = requestAmount.value;
    if(typeof amount != 'number' || !(amount > 0)) return undefined;
    const satoshis = settingsStore.bchUnit == "sat" ? amount : amount * 100_000_000;
    return BigInt(Math.round(satoshis));
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
      return buildBip21Uri({
        address: effectiveAddress.value,
        category: selectedCategory.value,
        fungibleAmount: parsedTokenAmount.value.baseUnits,
        message,
      });
    }
    return buildBip21Uri({ address: effectiveAddress.value, satoshis: requestSatoshis.value, message });
  });

  // What the request actually asks for, restated at the moment the code is handed over
  const requestedAmountDisplay = computed(() => {
    if (mode.value === 'token') {
      const baseUnits = parsedTokenAmount.value.baseUnits;
      if (baseUnits === undefined) return undefined;
      const amountInTokens = tokenDecimals.value ? Number(baseUnits) / (10 ** tokenDecimals.value) : Number(baseUnits);
      return `${formatNumber(amountInTokens, tokenDecimals.value)} ${tokenSymbol.value || tokenName.value}`;
    }
    if(requestSatoshis.value === undefined || requestAmount.value === undefined) return undefined;
    return formatNumber(requestAmount.value, 8) + displayUnitLong.value;
  });

  // Nothing to request yet, the qr code is still the plain receive address
  const emptyRequestHint = computed(() => {
    if (mode.value === 'token' && !selectedCategory.value) return t('requestPayment.selectTokenPrompt');
    return t('requestPayment.enterAmountHint');
  });

  async function setCurrencyAmount() {
    if(typeof requestAmount.value != 'number'){
      currencyAmount.value = undefined
      return
    }
    const newCurrencyValue = await convert(requestAmount.value, settingsStore.bchUnit, settingsStore.currency);
    currencyAmount.value = Number(newCurrencyValue.toFixed(2));
  }
  async function setBchAmount() {
    if(typeof currencyAmount.value != 'number'){
      requestAmount.value = undefined
      return
    }
    const newBchValue = await convert(currencyAmount.value, settingsStore.currency, settingsStore.bchUnit);
    requestAmount.value = Number(newBchValue);
  }

  function openAddressSelectDialog() {
    $q.dialog({
      component: HdAddressSelectDialog,
      componentProps: {
        title: t('requestPayment.selectAddress'),
        hint: t('requestPayment.selectAddressHint'),
        // a request is handed out, so only receive addresses, and the unused ones
        // are the point of picking rather than something to filter away
        allowChangeAddresses: false,
        hideZeroBalancesDefault: false,
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
  });

  // Both bch amounts are entered by hand, so they need a nudge when the units they are
  // expressed in change while the view sits in the background
  watch(() => settingsStore.currency, () => void setCurrencyAmount());
  watch(() => settingsStore.bchUnit, async (newUnit, previousUnit) => {
    if(typeof requestAmount.value != 'number') return;
    requestAmount.value = Number(await convert(requestAmount.value, previousUnit, newUnit));
  });
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('requestPayment.title') }}</legend>

    <div class="type-filter" style="margin-top: 10px;">
      <button :class="{ active: mode === 'bch' }" @click="mode = 'bch'">
        {{ bchDisplayNetwork }}
      </button>
      <button :class="{ active: mode === 'token' }" @click="mode = 'token'">
        {{ t('requestPayment.tokensMode') }}
      </button>
    </div>

    <div style="margin-top: 15px;">
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
      <div class="selected-item selectable" :title="t('requestPayment.selectToken')" @click="openTokenSelectDialog()">
        <TokenIcon
          v-if="selectedCategory"
          :token-id="selectedCategory"
          :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(selectedCategory) : undefined"
          :size="24"
        />
        <span :class="{ 'no-selection': !selectedCategory }">{{ tokenName ?? t('requestPayment.noTokenSelected') }}</span>
        <span v-if="tokenMetadata?.name" class="token-id">{{ shortCategory }}</span>
        <q-icon name="expand_more" class="select-chevron" size="20px" />
      </div>
    </div>

    <div style="margin-top: 15px;">
      <label>{{ t('requestPayment.amountLabel') }}</label>
      <template v-if="mode === 'bch'">
        <div class="amountRow">
          <span class="amountField">
            <input
              v-model="requestAmount"
              @input="setCurrencyAmount()"
              type="number"
              :placeholder="t('requestPayment.amountPlaceholder')"
              name="bchAmountInput"
            >
            <i class="input-icon">{{ bchDisplayUnit }}</i>
          </span>
          <span class="approxSign">≈</span>
          <span class="amountField">
            <input
              v-model="currencyAmount"
              @input="setBchAmount()"
              type="number"
              :placeholder="t('requestPayment.amountPlaceholder')"
              name="currencyInput"
            >
            <i class="input-icon">
              {{ `${currencyDisplayShortName} ${CurrencySymbols[settingsStore.currency]}` }}
            </i>
          </span>
        </div>
        <div class="amountNote">
          {{ t('requestPayment.amountNote', { network: bchDisplayNetwork, currency: currencyDisplayShortName }) }}
        </div>
      </template>
      <template v-else>
        <div class="amountRow">
          <span class="amountField">
            <input
              v-model="tokenAmountInput"
              :disabled="!selectedCategory"
              :placeholder="t('requestPayment.amountPlaceholder')"
              name="tokenAmountInput"
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

    <div style="margin-top: 15px;">
      <label>{{ t('requestPayment.payToLabel') }}</label>
      <div
        class="selected-item mono"
        :class="{ selectable: isHdWallet }"
        :title="isHdWallet ? t('requestPayment.selectAddress') : undefined"
        @click="isHdWallet && openAddressSelectDialog()"
      >
        <span>{{ effectiveAddress }}</span>
        <q-icon v-if="isHdWallet" name="expand_more" class="select-chevron" size="20px" />
      </div>
    </div>

    <div class="qr-frame">
      <qr-code :contents="requestUri" @click="copyToClipboard(requestUri)" class="qr-code">
        <img :src="mode === 'bch' ? 'images/bch-icon.png' : 'images/tokenicon.png'" slot="icon" /> <!-- eslint-disable-line -->
      </qr-code>
    </div>

    <div v-if="requestedAmountDisplay" class="requestSummary">
      {{ t('requestPayment.requesting', { amount: requestedAmountDisplay }) }}
    </div>
    <div v-else class="requestHint">{{ emptyRequestHint }}</div>

    <div class="requestUri" @click="copyToClipboard(requestUri)">{{ requestUri }}</div>

    <div class="requestButtonRow">
      <input
        @click="copyToClipboard(requestUri)"
        type="button"
        class="primaryButton"
        :value="t('requestPayment.copyButton')"
      >
      <input
        v-if="showMarkUsedAction"
        @click="markAddressUsed()"
        type="button"
        class="button"
        :value="t('addressManagement.markAddressUsedAction')"
      >
    </div>
  </fieldset>
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
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
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
  cursor: pointer;
  transition: background-color 0.2s;
}
.selected-item.selectable:hover {
  background-color: rgba(128, 128, 128, 0.14);
}
.select-chevron {
  flex: none;
  margin-left: auto;
}
/* size, background and dark mode crop are shared with the wallet page, see app.css */
.qr-frame {
  margin: 20px auto 0 auto;
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
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
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
