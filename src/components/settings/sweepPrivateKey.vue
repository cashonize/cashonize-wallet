<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { TestNetWallet, Wallet, TokenSendRequest, convert } from 'mainnet-js';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { displayAndLogError } from 'src/utils/errorHandling';
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import { useI18n } from 'vue-i18n'
  import { getTokenUtxos, getBalanceFromUtxos, convertToCurrency, formatFiatAmount } from 'src/utils/utils'
  import { tokenListFromUtxos } from 'src/stores/storeUtils'
  import type { TokenList } from 'src/interfaces/interfaces'
  import type { BcmrTokenResponse } from 'src/utils/zodValidation'

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    wif: string | undefined
  }>()

  const privateKeyToSweep = ref(props.wif ?? "");
  const showQrCodeDialog = ref(false);
  const isSweeping = ref(false);
  const isLoading = ref(false);
  const previewReady = ref(false);
  const isEmpty = ref(false);
  const bchBalanceSats = ref(0n);
  const previewTokenList = ref<TokenList>([]);
  const unverifiedTokenMetadata = ref<Record<string, BcmrTokenResponse>>({});

  const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
  const fiatBalance = ref<string | undefined>(undefined);

  const bchDisplayUnit = computed(() => {
    if (store.network == 'mainnet') return settingsStore.bchUnit == 'bch' ? 'BCH' : 'sats';
    return settingsStore.bchUnit == 'bch' ? 'tBCH' : 'tsats';
  });

  const balanceInBchUnit = computed(() => {
    const sats = Number(bchBalanceSats.value);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });

  const balanceMaxFractionDigits = computed(() => {
    return settingsStore.bchUnit === 'sat' ? 0 : 8;
  });

  const fungibleTokens = computed(() => previewTokenList.value.filter(item => 'amount' in item));
  const nftTokens = computed(() => previewTokenList.value.filter(item => 'nfts' in item));

  // Reset preview when WIF input changes
  watch(privateKeyToSweep, () => {
    previewReady.value = false;
    isEmpty.value = false;
    bchBalanceSats.value = 0n;
    fiatBalance.value = undefined;
    previewTokenList.value = [];
    unverifiedTokenMetadata.value = {};
  });

  function createTempWallet(wif: string) {
    const walletClass = (store.network == 'mainnet') ? Wallet : TestNetWallet;
    return walletClass.fromWIF(wif);
  }

  function getWifToSweep() {
    if (!privateKeyToSweep.value) {
      throw new Error(t('sweepPrivateKey.notifications.noWifProvided'));
    }
    let wif = privateKeyToSweep.value;
    if (wif.startsWith('bch-wif:')) wif = wif.slice(8);
    return wif;
  }

  async function fetchUnverifiedTokenInfo(categoryHex: string) {
    try {
      const tokenInfo = await store.fetchTokenInfo(categoryHex);
      unverifiedTokenMetadata.value = { ...unverifiedTokenMetadata.value, [categoryHex]: tokenInfo };
    } catch (error) {
      console.error(`Failed to fetch metadata for ${categoryHex}:`, error);
    }
  }

  function getTokenMetadata(categoryHex: string): BcmrTokenResponse | undefined {
    return store.bcmrRegistries?.[categoryHex] ?? unverifiedTokenMetadata.value[categoryHex];
  }

  function isUnverifiedToken(categoryHex: string): boolean {
    const userOwnsToken = store.tokenList?.some(t => t.category === categoryHex);
    return !userOwnsToken && categoryHex in unverifiedTokenMetadata.value;
  }

  function toAmountDecimals(amount: bigint, category: string) {
    const decimals = getTokenMetadata(category)?.token?.decimals;
    if (decimals) return Number(amount) / (10 ** decimals);
    return amount;
  }

  function tokenName(categoryHex: string): string {
    const truncatedId = `${categoryHex.slice(0, 8)}...${categoryHex.slice(-4)}`;
    return getTokenMetadata(categoryHex)?.name ?? truncatedId;
  }

  function getTokenIconUrl(tokenId: string): string | undefined {
    const tokenIconUri = getTokenMetadata(tokenId)?.uris?.icon;
    if (!tokenIconUri) return undefined;
    if (tokenIconUri.startsWith('ipfs://')) {
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  }

  async function preview() {
    if (isLoading.value) return;
    isLoading.value = true;
    previewReady.value = false;
    isEmpty.value = false;
    try {
      const wif = getWifToSweep();
      const tempWallet = await createTempWallet(wif);
      const utxos = await tempWallet.getUtxos();

      bchBalanceSats.value = getBalanceFromUtxos(utxos);
      const tokenUtxos = getTokenUtxos(utxos);

      // Fetch fiat value for BCH balance
      if (bchBalanceSats.value > 0n) {
        try {
          const exchangeRate = await convert(1, 'bch', settingsStore.currency);
          const fiatValue = convertToCurrency(bchBalanceSats.value, exchangeRate);
          fiatBalance.value = formatFiatAmount(fiatValue, settingsStore.currency);
        } catch {
          // Non-critical: fiat display is optional
        }
      }

      if (bchBalanceSats.value === 0n && tokenUtxos.length === 0) {
        isEmpty.value = true;
        previewReady.value = true;
        return;
      }

      previewTokenList.value = tokenListFromUtxos(utxos);

      // Fetch BCMR metadata for tokens not already in the store's registries
      if (previewTokenList.value.length > 0) {
        const fetchPromises = previewTokenList.value
          .filter(token => !store.bcmrRegistries?.[token.category])
          .map(token => fetchUnverifiedTokenInfo(token.category));
        await Promise.all(fetchPromises);
      }

      previewReady.value = true;
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isLoading.value = false;
    }
  }

  async function sweep() {
    if (isSweeping.value) return;
    isSweeping.value = true;
    try {
      const wif = getWifToSweep();
      const tempWallet = await createTempWallet(wif);
      const tokenAwareAddress = store.wallet.getTokenDepositAddress();

      // If no preview was done, fetch UTXOs to check for tokens
      let tokensToSweep = previewTokenList.value;
      if (!previewReady.value) {
        const utxos = await tempWallet.getUtxos();
        tokensToSweep = tokenListFromUtxos(utxos);
      }

      // Sweep fungible tokens first (one tx per category)
      const ftsToSweep = tokensToSweep.filter(item => 'amount' in item);
      if (ftsToSweep.length > 0) {
        $q.notify({
          spinner: true,
          message: t('sweepPrivateKey.notifications.sweepingTokens'),
          color: 'grey-5',
          timeout: 1000
        });
        for (const token of ftsToSweep) {
          if (!('amount' in token)) continue;
          await tempWallet.send([
            new TokenSendRequest({
              cashaddr: tokenAwareAddress,
              amount: token.amount,
              category: token.category,
            }),
          ]);
        }
      }

      // Sweep NFTs (one tx per category, all NFTs of that category together)
      const nftsToSweep = tokensToSweep.filter(item => 'nfts' in item);
      if (nftsToSweep.length > 0) {
        $q.notify({
          spinner: true,
          message: t('sweepPrivateKey.notifications.sweepingNfts'),
          color: 'grey-5',
          timeout: 1000
        });
        for (const token of nftsToSweep) {
          if (!('nfts' in token)) continue;
          const nftOutputs = token.nfts.map(nftUtxo => {
            const nftInfo = nftUtxo.token!.nft!;
            return new TokenSendRequest({
              cashaddr: tokenAwareAddress,
              category: token.category,
              nft: {
                commitment: nftInfo.commitment,
                capability: nftInfo.capability,
              },
            });
          });
          await tempWallet.send(nftOutputs);
        }
      }

      // Sweep remaining BCH
      $q.notify({
        spinner: true,
        message: t('sweepPrivateKey.notifications.sweepingBch'),
        color: 'grey-5',
        timeout: 1000
      });
      await tempWallet.sendMax(tokenAwareAddress);

      $q.notify({
        type: 'positive',
        message: t('sweepPrivateKey.notifications.success')
      });

      // Reset state
      privateKeyToSweep.value = "";
      previewReady.value = false;
      isEmpty.value = false;
      previewTokenList.value = [];
      unverifiedTokenMetadata.value = {};
      bchBalanceSats.value = 0n;
      fiatBalance.value = undefined;

      // Update main wallet
      await store.updateWalletUtxos();
      void store.updateWalletHistory();
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isSweeping.value = false;
    }
  }

  const qrDecode = (content: string) => {
    const decodedContent = content.startsWith('bch-wif:') ? content.slice(8) : content
    privateKeyToSweep.value = decodedContent;
  }
  const qrFilter = (content: string) => {
    // see https://documentation.cash/protocol/blockchain/encoding/base58check.html#version-bytes
    const mainnetWifEncoding = content.startsWith('bch-wif:') || content.startsWith('K') || content.startsWith('L') || content.startsWith('5')
    const chipnetWifEncoding = content.startsWith('c') || content.startsWith('9')
    if(!mainnetWifEncoding && !chipnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notWif');
    }
    if(store.network === 'mainnet' && !mainnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notMainnetWif');
    }
    if(store.network === 'chipnet' && !chipnetWifEncoding) {
      return t('sweepPrivateKey.qrErrors.notChipnetWif');
    }
    return true;
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('sweepPrivateKey.title') }}</legend>

    {{ t('sweepPrivateKey.description') }}
    <div class="sweep-input-row">
      <input
        v-model="privateKeyToSweep"
        @keyup.enter="() => preview()"
        type="text"
        :placeholder="t('sweepPrivateKey.placeholder')"
      />
      <button
        v-if="settingsStore.qrScan"
        @click="() => showQrCodeDialog = true"
        style="padding: 12px"
      >
        <img src="images/qrscan.svg" />
      </button>
    </div>
    <div class="sweep-input-row" style="margin-top: 8px;">
      <input
        @click="preview()"
        type="button"
        class="button"
        style="color: black;"
        :value="isLoading ? t('sweepPrivateKey.loadingButton') : t('sweepPrivateKey.previewButton')"
        :disabled="isLoading || isSweeping || !privateKeyToSweep"
      >
      <input
        @click="sweep()"
        type="button"
        class="primaryButton"
        :value="isSweeping ? t('sweepPrivateKey.sweepingButton') : t('sweepPrivateKey.sweepButton')"
        :disabled="isSweeping || isLoading || !privateKeyToSweep"
      >
    </div>

    <!-- Empty state -->
    <div v-if="previewReady && isEmpty" style="margin-top: 12px; color: grey;">
      {{ t('sweepPrivateKey.emptyWallet') }}
    </div>

    <!-- Preview section -->
    <div v-if="previewReady && !isEmpty" style="margin-top: 12px;">
      <!-- BCH balance -->
      <div style="margin-bottom: 8px;">
        <b>{{ t('sweepPrivateKey.preview.bchBalance') }}</b>
        {{ balanceInBchUnit.toLocaleString('en-US', { maximumFractionDigits: balanceMaxFractionDigits }) }}
        {{ bchDisplayUnit }}
        <span v-if="fiatBalance" style="color: grey;"> ({{ fiatBalance }})</span>
      </div>

      <!-- Fungible tokens -->
      <div v-if="fungibleTokens.length > 0">
        <b>{{ t('sweepPrivateKey.preview.tokens') }}</b>
        <div
          v-for="token in fungibleTokens"
          :key="token.category"
          class="sweep-token-row"
        >
          <TokenIcon
            :token-id="token.category"
            :icon-url="!settingsStore.disableTokenIcons ? getTokenIconUrl(token.category) : undefined"
            :size="28"
          />
          <span>
            {{ tokenName(token.category) }}
            <span v-if="isUnverifiedToken(token.category)">*</span>
          </span>
          <span class="sweep-token-amount">
            {{ 'amount' in token ? numberFormatter.format(toAmountDecimals(token.amount, token.category)) : '' }}
            {{ getTokenMetadata(token.category)?.token?.symbol ?? '' }}
          </span>
        </div>
      </div>

      <!-- NFTs -->
      <div v-if="nftTokens.length > 0">
        <b>{{ t('sweepPrivateKey.preview.nfts') }}</b>
        <div
          v-for="token in nftTokens"
          :key="token.category"
          class="sweep-token-row"
        >
          <TokenIcon
            :token-id="token.category"
            :icon-url="!settingsStore.disableTokenIcons ? getTokenIconUrl(token.category) : undefined"
            :size="28"
          />
          <span>
            {{ tokenName(token.category) }}
            <span v-if="isUnverifiedToken(token.category)">*</span>
          </span>
          <span v-if="'nfts' in token" class="sweep-token-amount">
            {{ token.nfts.length }} NFT{{ token.nfts.length > 1 ? 's' : '' }}
          </span>
        </div>
      </div>

      <!-- No tokens message -->
      <div v-if="previewTokenList.length === 0" style="color: grey;">
        {{ t('sweepPrivateKey.preview.noTokens') }}
      </div>
    </div>
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
.sweep-input-row {
  display: flex;
  gap: 0.5rem;
}
.sweep-token-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  padding: 4px 0;
}
.sweep-token-amount {
  margin-left: auto;
  white-space: nowrap;
}
</style>
