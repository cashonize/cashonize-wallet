<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { TestNetWallet, Wallet, convert } from 'mainnet-js';
  import { decodePrivateKeyWif, encodePrivateKeyWif } from '@bitauth/libauth';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { displayAndLogError } from 'src/utils/errorHandling';
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue';
  import TokenIcon from '../general/TokenIcon.vue';
  import InfoPopup from '../general/InfoPopup.vue';
  import { useI18n } from 'vue-i18n'
  import { convertToCurrency, formatFiatAmount } from 'src/utils/utils'
  import { tokenListFromUtxos } from 'src/stores/storeUtils'
  import { transferAllAssets, type TransferProgress } from 'src/utils/transferAssets'
  import { decryptBip38Key, isBip38Key, isUncompressedBip38Key } from 'src/utils/bip38'
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
  const bip38Passphrase = ref("");
  const showPassphrase = ref(false);
  const showQrCodeDialog = ref(false);
  const isSweeping = ref(false);
  const isLoading = ref(false);
  const isUnlocking = ref(false);
  // Unlocking is deliberately slow, so it happens once and preview and sweep use the result
  const unlockedKey = ref<{ encryptedKey: string, wif: string, address: string } | undefined>(undefined);
  const previewReady = ref(false);
  const isEmpty = ref(false);
  const insufficientFeeBch = ref(false);
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

  const keyToSweep = computed(() => {
    const input = privateKeyToSweep.value.trim();
    return input.startsWith('bch-wif:') ? input.slice(8) : input;
  });
  const isEncryptedKey = computed(() => isBip38Key(keyToSweep.value));
  // Readable from the encrypted key itself, so there is no reason to let a passphrase be typed
  // and derived first only to turn the key away afterwards
  const isUncompressedKey = computed(() => isUncompressedBip38Key(keyToSweep.value));
  // An unlock only counts for the key it was made for, so editing the input locks it again
  const isUnlocked = computed(() => unlockedKey.value?.encryptedKey === keyToSweep.value);
  const readyToSweep = computed(() => {
    if (!privateKeyToSweep.value) return false;
    if (isEncryptedKey.value && !isUnlocked.value) return false;
    return true;
  });

  const unlockButtonLabel = computed(() => {
    if (isUnlocking.value) return t('sweepPrivateKey.unlockingButton');
    return t('sweepPrivateKey.unlockButton');
  });

  function resetSweepState() {
    previewReady.value = false;
    isEmpty.value = false;
    insufficientFeeBch.value = false;
    bchBalanceSats.value = 0n;
    fiatBalance.value = undefined;
    previewTokenList.value = [];
    unverifiedTokenMetadata.value = {};
    unlockedKey.value = undefined;
    bip38Passphrase.value = "";
    showPassphrase.value = false;
  }

  // Reset when the key input changes
  watch(privateKeyToSweep, resetSweepState);

  // Reset on a network switch too: the previewed balance came from the other network, and an
  // unlocked key was encoded for it, which the wallet of the network switched to rejects
  watch(() => store.network, resetSweepState);

  function createTempWallet(wif: string) {
    const walletClass = (store.network == 'mainnet') ? Wallet : TestNetWallet;
    return walletClass.fromWIF(wif);
  }

  // mainnet-js turns these away itself, but only with a message about WIFs having to start with
  // L or K, so catch them here to say what is actually wrong. Sweeping them is not a matter of
  // getting past the check: mainnet-js derives every address from the compressed public key.
  function throwOnUncompressedKey(wif: string) {
    const decoded = decodePrivateKeyWif(wif);
    if (typeof decoded === 'string') return; // leave malformed keys to mainnet-js to report
    if (decoded.type === 'mainnetUncompressed' || decoded.type === 'testnetUncompressed') {
      throw new Error(t('sweepPrivateKey.errors.uncompressedKey'));
    }
  }

  // Decrypting takes seconds, so it is a step of its own instead of something the preview or the
  // sweep does on the way: a wrong passphrase is then answered by the action that asked for it
  async function unlockKey() {
    if (isUnlocking.value) return;
    if (!bip38Passphrase.value) {
      return displayAndLogError(new Error(t('sweepPrivateKey.errors.noPassphraseProvided')));
    }
    isUnlocking.value = true;
    try {
      const encryptedKey = keyToSweep.value;
      // Decrypting holds the main thread from here until it is done, so wait for the paint that
      // shows the button busy: after this the screen is frozen and no later change would show
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const { privateKey, compressed } = await decryptBip38Key(encryptedKey, bip38Passphrase.value);
      // A typed in uncompressed WIF is refused by mainnet-js, but this one would not be: the
      // re-encoding below always writes the compressed form, so mainnet-js would accept the key
      // and then watch and sign for an address that this key does not control
      if (!compressed) throw new Error(t('sweepPrivateKey.errors.uncompressedKey'));
      // An encrypted key holds no network of its own, it unlocks the same key on either
      const wif = encodePrivateKeyWif(privateKey, store.network == 'mainnet' ? 'mainnet' : 'testnet');
      const tempWallet = await createTempWallet(wif);
      unlockedKey.value = { encryptedKey, wif, address: tempWallet.cashaddr };
      // The passphrase has done its work, the unlocked key is what the sweep needs from here
      bip38Passphrase.value = "";
      showPassphrase.value = false;
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isUnlocking.value = false;
    }
  }

  function getWifToSweep() {
    if (!privateKeyToSweep.value) {
      throw new Error(t('sweepPrivateKey.notifications.noWifProvided'));
    }
    const wif = keyToSweep.value;
    if (isBip38Key(wif)) {
      if (unlockedKey.value?.encryptedKey !== wif) {
        throw new Error(t('sweepPrivateKey.errors.keyLocked'));
      }
      return unlockedKey.value.wif;
    }
    throwOnUncompressedKey(wif);
    return wif;
  }

  // Enter does whatever the key in the input still needs: unlock it first, preview it once open.
  // An encrypted key without its passphrase yet has nothing to do, the passphrase field is next.
  function submitKeyInput() {
    if (isEncryptedKey.value && !isUnlocked.value) {
      if (bip38Passphrase.value) void unlockKey();
      return;
    }
    void preview();
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

      // Include sats from token UTXOs since those will be recovered after sweeping the tokens
      bchBalanceSats.value = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);

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

      if (utxos.length === 0) {
        isEmpty.value = true;
        previewReady.value = true;
        return;
      }

      previewTokenList.value = tokenListFromUtxos(utxos);

      // Warn if all UTXOs are token UTXOs with at most dust-level sats (no free BCH for fees)
      const hasTokens = previewTokenList.value.length > 0;
      const allUtxosAreDustTokens = utxos.every(utxo => utxo.token !== undefined && utxo.satoshis <= 1000n);
      insufficientFeeBch.value = hasTokens && allUtxosAreDustTokens;

      // Fetch BCMR metadata for tokens not already in the store's registries
      const categories = new Set(previewTokenList.value.map(token => token.category));
      const categoriesToFetch = [...categories].filter(category => !store.bcmrRegistries?.[category]);
      const fetchPromises = categoriesToFetch.map(category => fetchUnverifiedTokenInfo(category));
      await Promise.all(fetchPromises);

      previewReady.value = true;
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isLoading.value = false;
    }
  }

  // One notification per phase, shown when a phase with something to move starts
  function notifySweepPhase(progress: TransferProgress) {
    if (progress.completed !== 0 || progress.total === 0) return;
    const phaseMessages = {
      fungibleTokens: t('sweepPrivateKey.notifications.sweepingTokens'),
      nfts: t('sweepPrivateKey.notifications.sweepingNfts'),
      bch: t('sweepPrivateKey.notifications.sweepingBch'),
    };
    $q.notify({
      spinner: true,
      message: phaseMessages[progress.phase],
      color: 'grey-5',
      timeout: 1000
    });
  }

  async function sweep() {
    if (isSweeping.value) return;
    isSweeping.value = true;
    try {
      const wif = getWifToSweep();
      const tempWallet = await createTempWallet(wif);
      const tokenAwareAddress = store.wallet.getTokenDepositAddress();

      await transferAllAssets(tempWallet, tokenAwareAddress, notifySweepPhase);

      $q.notify({
        type: 'positive',
        message: t('sweepPrivateKey.notifications.success')
      });

      // Clearing the swept key resets the preview and the unlock along with it, through the watcher
      privateKeyToSweep.value = "";
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isSweeping.value = false;
      // Also runs after a failed sweep, which may have moved part of the assets already
      await store.updateWalletUtxos();
      void store.updateWalletHistory();
    }
  }

  const qrDecode = (content: string) => {
    const decodedContent = content.startsWith('bch-wif:') ? content.slice(8) : content
    privateKeyToSweep.value = decodedContent;
  }
  const qrFilter = (content: string) => {
    // Encrypted keys are the same on both networks, so which one it is only shows after decrypting
    if (isBip38Key(content)) return true;
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
    <!-- Encrypted keys are only recognisable once entered, so say up front that they work -->
    <InfoPopup>
      <div>{{ t('sweepPrivateKey.encryptedKeySupported') }}</div>
    </InfoPopup>
    <div class="sweep-input-row">
      <input
        v-model="privateKeyToSweep"
        @keyup.enter="() => submitKeyInput()"
        type="text"
        :placeholder="t('sweepPrivateKey.placeholder')"
      />
      <button
        v-if="settingsStore.qrScan"
        @click="() => showQrCodeDialog = true"
        style="padding: 12px"
      >
        <img :src="settingsStore.darkMode ? 'images/qrscanLightGrey.svg' : 'images/qrscan.svg'" />
      </button>
    </div>
    <!-- Nothing can be swept from an uncompressed key, so say so before a passphrase is asked for -->
    <div v-if="isUncompressedKey" style="margin-top: 12px; color: orange;">
      {{ t('sweepPrivateKey.errors.uncompressedKey') }}
    </div>

    <!-- Passphrase of an encrypted (BIP38) key, until it is unlocked -->
    <div v-if="isEncryptedKey && !isUnlocked && !isUncompressedKey" style="margin-top: 12px;">
      <div style="color: grey;">
        <q-icon name="lock" size="1.1em" style="margin-right: 4px; vertical-align: text-bottom;"/>
        {{ t('sweepPrivateKey.encryptedKey') }}
      </div>
      <div class="sweep-input-row" style="margin-top: 8px;">
        <input
          v-model="bip38Passphrase"
          @keyup.enter="() => unlockKey()"
          :type="showPassphrase ? 'text' : 'password'"
          :placeholder="t('sweepPrivateKey.passphrasePlaceholder')"
        />
        <button @click="() => showPassphrase = !showPassphrase" style="padding: 12px">
          {{ showPassphrase ? t('sweepPrivateKey.hidePassphrase') : t('sweepPrivateKey.showPassphrase') }}
        </button>
      </div>
      <input
        @click="unlockKey()"
        type="button"
        class="button"
        style="margin-top: 8px;"
        :value="unlockButtonLabel"
        :disabled="isUnlocking || !bip38Passphrase"
      >
    </div>

    <!-- The address the passphrase opened, to check against the one on the paper wallet -->
    <div v-if="isEncryptedKey && isUnlocked" class="sweep-unlocked-row">
      <q-icon name="lock_open" size="1.1em"/>
      <span>{{ t('sweepPrivateKey.unlockedKey') }}</span>
      <span class="sweep-unlocked-address">{{ unlockedKey?.address }}</span>
    </div>

    <div class="sweep-input-row" style="margin-top: 8px;">
      <input
        @click="preview()"
        type="button"
        class="button"
        :value="isLoading ? t('sweepPrivateKey.loadingButton') : t('sweepPrivateKey.previewButton')"
        :disabled="isLoading || isSweeping || !readyToSweep"
      >
      <input
        @click="sweep()"
        type="button"
        class="primaryButton"
        :value="isSweeping ? t('sweepPrivateKey.sweepingButton') : t('sweepPrivateKey.sweepButton')"
        :disabled="isSweeping || isLoading || !readyToSweep || insufficientFeeBch"
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

      <!-- Warning: tokens but no free BCH for fees -->
      <div v-if="insufficientFeeBch" style="margin-bottom: 8px; color: orange;">
        {{ t('sweepPrivateKey.preview.noFreeBchWarning') }}
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
            {{ t('common.nftCount', token.nfts.length) }}
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
.sweep-unlocked-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.sweep-unlocked-address {
  color: grey;
  overflow-wrap: anywhere;
}
</style>
