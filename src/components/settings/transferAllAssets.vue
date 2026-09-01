<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { HDWallet } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmDialog } from 'src/utils/txHelpers'
  import { satsToBch, formatFiatAmount } from 'src/utils/utils'
  import { addressFromUri } from 'src/utils/payments/bip21'
  import { validateRecipientAddress, validateTokenRecipientAddress, getCashAddressScanError } from 'src/utils/payments/recipientAddress'
  import { toPlainAddress } from 'src/utils/addressValidation'
  import { transferAllAssets, type TransferPhase, type TransferProgress } from 'src/utils/tools/transferAssets'
  import { tokenListFromUtxos } from 'src/stores/storeUtils'
  import QrCodeDialog from '../qr/qrCodeScanDialog.vue'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const destinationInput = ref("");
  const showQrCodeDialog = ref(false);
  const isTransferring = ref(false);
  const transferFailed = ref(false);
  const activePhase = ref(undefined as undefined | TransferPhase);
  // A phase gets its entry when it first reports, so the ones ahead of it read as pending
  const phaseProgress = ref(undefined as undefined | Partial<Record<TransferPhase, { completed: number, total: number }>>);

  const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
  const transferPhases: TransferPhase[] = ["fungibleTokens", "nfts", "bch"];
  // Wallets can hold hundreds of categories, past this many the group starts out collapsed
  const groupCollapseThreshold = 5;
  type AssetGroup = "fungibleTokens" | "nfts";
  const groupCollapseOverride = ref({} as Partial<Record<AssetGroup, boolean>>);

  const isHdWallet = computed(() => store._wallet instanceof HDWallet);
  const networkPrefix = computed(() => store.network === 'mainnet' ? 'bitcoincash' : 'bchtest');

  // Built from the spendable coins rather than the wallet's token list, which counts the held
  // back coins too: this transfer leaves those behind, so they belong in neither the list of what
  // moves nor the count of transactions it takes.
  const transferableTokens = computed(() => tokenListFromUtxos(store.spendableUtxos ?? []));
  const fungibleTokens = computed(() => transferableTokens.value.filter(item => 'amount' in item));
  const nftTokens = computed(() => transferableTokens.value.filter(item => 'nfts' in item));
  const hasTokens = computed(() => transferableTokens.value.length > 0);
  const transactionCount = computed(() => fungibleTokens.value.length + nftTokens.value.length + 1);
  // Only 'empty' once the utxos have actually loaded
  const isEmpty = computed(() => store.spendableUtxos !== undefined && store.spendableUtxos.length === 0);
  const heldBackCount = computed(() => store.reservedWalletUtxos?.length ?? 0);

  const bchDisplayUnit = computed(() => {
    if (store.network == 'mainnet') return settingsStore.bchUnit == 'bch' ? 'BCH' : 'sats';
    return settingsStore.bchUnit == 'bch' ? 'tBCH' : 'tsats';
  });
  const balanceInBchUnit = computed(() => {
    const sats = Number(store.spendableBalance ?? 0n);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });
  const fiatBalance = computed(() => {
    if (!store.spendableBalance || store.exchangeRate === undefined) return undefined;
    return formatFiatAmount(satsToBch(store.spendableBalance) * store.exchangeRate, settingsStore.currency);
  });

  const assetGroups = computed(() => {
    const groups = [];
    if (fungibleTokens.value.length) {
      groups.push({ key: "fungibleTokens" as const, label: t('transferAllAssets.phases.fungibleTokens'), tokens: fungibleTokens.value });
    }
    if (nftTokens.value.length) {
      groups.push({ key: "nfts" as const, label: t('transferAllAssets.phases.nfts'), tokens: nftTokens.value });
    }
    return groups;
  });

  // The token list loads asynchronously, so the collapse default is read from the current
  // count each time and only replaced once the user has expanded or collapsed the group
  function isGroupCollapsed(group: AssetGroup) {
    const override = groupCollapseOverride.value[group];
    if (override !== undefined) return override;
    const tokenCount = group === "fungibleTokens" ? fungibleTokens.value.length : nftTokens.value.length;
    return tokenCount >= groupCollapseThreshold;
  }
  function toggleGroup(group: AssetGroup) {
    groupCollapseOverride.value[group] = !isGroupCollapsed(group);
  }

  function tokenName(categoryHex: string): string {
    const truncatedId = `${categoryHex.slice(0, 8)}...${categoryHex.slice(-4)}`;
    return store.bcmrRegistries?.[categoryHex]?.name ?? truncatedId;
  }
  function toAmountDecimals(amount: bigint, category: string) {
    const decimals = store.bcmrRegistries?.[category]?.token?.decimals;
    if (decimals) return Number(amount) / (10 ** decimals);
    return amount;
  }

  // The view is kept alive across navigation, so without this a finished transfer keeps
  // showing its result after switching to another wallet, which holds different assets
  watch(() => store._wallet, () => {
    phaseProgress.value = undefined;
    activePhase.value = undefined;
    transferFailed.value = false;
    groupCollapseOverride.value = {};
  });

  function phaseStatus(phase: TransferPhase) {
    const phaseState = phaseProgress.value?.[phase];
    if (!phaseState) return 'pending';
    if (transferFailed.value && activePhase.value === phase) return 'failed';
    if (phaseState.total === 0) return 'skipped';
    if (phaseState.completed === phaseState.total) return 'done';
    if (activePhase.value === phase) return 'active';
    return 'pending';
  }

  function onTransferProgress(update: TransferProgress) {
    activePhase.value = update.phase;
    if (phaseProgress.value) {
      phaseProgress.value[update.phase] = { completed: update.completed, total: update.total };
    }
  }

  function getDestinationAddress() {
    const destination = hasTokens.value
      ? validateTokenRecipientAddress(destinationInput.value, networkPrefix.value)
      : validateRecipientAddress(destinationInput.value, networkPrefix.value);
    // Covers every address of an HD wallet, not just the one currently handed out
    if (store.walletHasAddress(toPlainAddress(destination))) {
      throw new Error(t('transferAllAssets.errors.ownAddress'));
    }
    return destination;
  }

  async function startTransfer() {
    if (isTransferring.value) return;
    let destination: string;
    try {
      destination = getDestinationAddress();
    } catch (error) {
      displayAndLogError(error);
      return;
    }

    // Always confirmed, whatever the confirmBeforeSending setting says: this empties the wallet
    // and the dialog is where the destination address gets its last look
    const confirmed = await confirmDialog(
      t('transferAllAssets.confirm.title'),
      `${t('transferAllAssets.confirm.message')}\n${destination}`,
      t('transferAllAssets.confirm.button')
    );
    if (!confirmed) return;

    isTransferring.value = true;
    transferFailed.value = false;
    activePhase.value = undefined;
    phaseProgress.value = {};
    try {
      await transferAllAssets(store.wallet, destination, store.reservedUtxos, onTransferProgress);
      destinationInput.value = "";
      $q.notify({ type: 'positive', message: t('transferAllAssets.notifications.success') });
    } catch (error) {
      transferFailed.value = true;
      displayAndLogError(error);
    } finally {
      isTransferring.value = false;
      // Also runs after a failure, where the wallet holds whatever did not get transferred
      await store.updateWalletUtxos();
      void store.updateWalletHistory();
    }
  }

  const qrDecode = (content: string) => {
    destinationInput.value = addressFromUri(content);
  }
  const qrFilter = (content: string) => {
    return getCashAddressScanError(content, networkPrefix.value) ?? true;
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('transferAllAssets.title') }}</legend>

    {{ t('transferAllAssets.description') }}
    <InfoPopup>
      <div style="max-width: 300px;">{{ t('transferAllAssets.usageHint') }}</div>
      <div class="info-popup-note" style="max-width: 300px;">{{ t('transferAllAssets.usageHintNote') }}</div>
    </InfoPopup>

    <div v-if="isHdWallet" class="warning-box" style="margin-top: 15px;">
      <q-icon name="warning" size="20px" class="warning-box-icon" />
      <div><b>{{ t('common.attention') }}</b> {{ t('common.hdPrivacyWarning') }}</div>
    </div>

    <div v-if="isEmpty" style="margin-top: 15px; color: grey;">
      {{ t('transferAllAssets.emptyWallet') }}
    </div>

    <template v-else>
      <div style="margin-top: 15px;">
        <b>{{ t('transferAllAssets.toTransfer') }}</b>
        <div class="transfer-asset-row">
          <img src="images/bch-icon.png" class="bch-icon">
          <span>{{ t('transferAllAssets.bchBalance') }}</span>
          <span class="transfer-asset-amount">
            {{ balanceInBchUnit.toLocaleString('en-US', { maximumFractionDigits: settingsStore.bchUnit === 'sat' ? 0 : 8 }) }}
            {{ bchDisplayUnit }}
            <span v-if="fiatBalance" style="color: grey;">({{ fiatBalance }})</span>
          </span>
        </div>

        <template v-for="group in assetGroups" :key="group.key">
          <div class="asset-group-header" @click="toggleGroup(group.key)">
            {{ group.label }} ({{ group.tokens.length }})
            <q-icon name="expand_more" class="chevron" :class="{ collapsed: isGroupCollapsed(group.key) }" size="20px" />
          </div>
          <template v-if="!isGroupCollapsed(group.key)">
            <div v-for="token in group.tokens" :key="token.category" class="transfer-asset-row">
              <TokenIcon
                :token-id="token.category"
                :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(token.category) : undefined"
                :size="28"
              />
              <span>{{ tokenName(token.category) }}</span>
              <span class="transfer-asset-amount">
                <template v-if="'amount' in token">
                  {{ numberFormatter.format(toAmountDecimals(token.amount, token.category)) }}
                  {{ store.bcmrRegistries?.[token.category]?.token?.symbol ?? '' }}
                </template>
                <template v-else-if="'nfts' in token">
                  {{ t('common.nftCount', token.nfts.length) }}
                </template>
              </span>
            </div>
          </template>
        </template>

      </div>

      <div style="margin-top: 15px;">
        <label>{{ hasTokens ? t('transferAllAssets.destinationTokenLabel') : t('transferAllAssets.destinationLabel') }}</label>
        <div class="destination-input-row">
          <input
            v-model="destinationInput"
            type="text"
            :placeholder="hasTokens ? t('transferAllAssets.destinationTokenPlaceholder') : t('transferAllAssets.destinationPlaceholder')"
            :disabled="isTransferring"
          >
          <button
            v-if="settingsStore.qrScan"
            @click="() => showQrCodeDialog = true"
            style="padding: 12px"
          >
            <img :src="settingsStore.darkMode ? 'images/qrscanLightGrey.svg' : 'images/qrscan.svg'" />
          </button>
        </div>
      </div>

      <div class="transfer-transaction-count">
        {{ t('transferAllAssets.transactionCount', { count: transactionCount }) }}
        <span v-if="transactionCount > 1">{{ t('transferAllAssets.transactionCountNote') }}</span>
      </div>

      <!-- Said before the transfer rather than after: the wallet does not end up empty, and the
           coins left in it are the ones a spend never reaches for -->
      <div v-if="heldBackCount" class="description" style="margin-top: 12px;">
        {{ t('transferAllAssets.heldBack', heldBackCount) }}
      </div>

      <input
        @click="startTransfer()"
        type="button"
        class="primaryButton"
        :value="isTransferring ? t('transferAllAssets.transferringButton') : t('transferAllAssets.transferButton')"
        :disabled="isTransferring || !destinationInput"
        style="margin-top: 12px;"
      >

      <div v-if="phaseProgress" style="margin-top: 15px;">
        <div v-for="phase in transferPhases" :key="phase" class="transfer-phase-row">
          <q-spinner v-if="phaseStatus(phase) === 'active'" size="18px" />
          <q-icon v-else-if="phaseStatus(phase) === 'done'" name="check_circle" size="18px" style="color: var(--color-primary);" />
          <q-icon v-else-if="phaseStatus(phase) === 'failed'" name="error" size="18px" style="color: red;" />
          <span v-else class="transfer-phase-dot">·</span>
          <span>{{ t(`transferAllAssets.phases.${phase}`) }}</span>
          <span class="transfer-phase-status">
            <template v-if="phaseStatus(phase) === 'skipped'">{{ t('transferAllAssets.phaseStatus.none') }}</template>
            <template v-else-if="phaseStatus(phase) === 'pending'">{{ t('transferAllAssets.phaseStatus.pending') }}</template>
            <template v-else>{{ phaseProgress[phase]?.completed }} / {{ phaseProgress[phase]?.total }}</template>
          </span>
        </div>
        <div v-if="transferFailed" style="margin-top: 8px; color: orange;">
          {{ t('transferAllAssets.partialTransfer') }}
        </div>
      </div>
    </template>
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
.transfer-asset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  padding: 4px 0;
}
.transfer-transaction-count {
  margin-top: 15px;
}
.bch-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  vertical-align: middle;
}
.asset-group-header {
  margin: 10px 0 4px;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
}
.chevron {
  vertical-align: -0.25em;
  margin-left: 4px;
  transition: transform 0.2s;
}
.chevron.collapsed {
  transform: rotate(-90deg);
}
.transfer-asset-amount {
  margin-left: auto;
  white-space: nowrap;
}
.destination-input-row {
  display: flex;
  gap: 0.5rem;
}
.destination-input-row input {
  flex: 1;
  min-width: 0;
}
.transfer-phase-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.transfer-phase-dot {
  width: 18px;
  text-align: center;
  color: grey;
}
.transfer-phase-status {
  margin-left: auto;
  color: grey;
  white-space: nowrap;
}
</style>
