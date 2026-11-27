<script setup lang="ts">
  import { ref, computed, nextTick, watch } from 'vue'
  import { CurrencyShortNames } from 'src/interfaces/interfaces'
  import { formatFiatAmount, formatNumber, convertToCurrency, hiddenAmount } from 'src/utils/utils';
  import { routeScannedCode } from 'src/utils/scanRouting';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { type QMenu } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { switchWalletWithNotice, maxWallets } from 'src/utils/wallet/walletUtils'
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';
  import portfolioIcon from './portfolio/portfolioIcon.vue';
  import NetworkBadge from './general/networkBadge.vue';
  import RecentActivity from './history/recentActivity.vue';
  import BackupReminder from './wallets/backupReminder.vue';

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // a code from the general scanner, which the page routes to the view it belongs to
  const emit = defineEmits<{ scanned: [content: string] }>()

  const showQrCodeDialog = ref(false);

  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  })
  // The balance settles into place when it arrives where the placeholder was. Set from here and
  // not left on: the view is kept alive, and a return to it would replay a class that stays.
  const balanceArrived = ref(false);
  watch(() => store.balance, (balance, previous) => {
    if (previous === undefined && balance !== undefined) balanceArrived.value = true;
  });
  const displayCurrencyBalance = computed(() => {
    if (store.exchangeRate === undefined || store.balance === undefined) return '';
    const balance = convertToCurrency(store.balance, store.exchangeRate);
    return formatFiatAmount(balance, settingsStore.currency);
  });
  const currencyDisplayShortName = computed(() => {
    return (store.network == "mainnet" ? "" : "t") + CurrencyShortNames[settingsStore.currency];
  });
  const balanceInBchUnit = computed(() => {
    if (store.balance === undefined) return undefined;
    const sats = Number(store.balance);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });
  // The large line and the one under it. Which is which is the user's choice on mainnet; on a
  // test network the coins are worth nothing, so their amount leads whatever was chosen.
  const balanceLines = computed(() => {
    let fiatLine, bchLine;
    if (displayCurrencyBalance.value) fiatLine = { amount: displayCurrencyBalance.value, unit: currencyDisplayShortName.value };
    if (balanceInBchUnit.value !== undefined) bchLine = { amount: formatNumber(balanceInBchUnit.value, 8), unit: displayUnitLong.value.trim() };
    if (settingsStore.hideBalances) {
      if (fiatLine) fiatLine.amount = hiddenAmount;
      if (bchLine) bchLine.amount = hiddenAmount;
    }
    const bchFirst = settingsStore.primaryBalance === 'bch' || store.network !== 'mainnet';
    return bchFirst ? [bchLine, fiatLine] : [fiatLine, bchLine];
  });
  const eyeShown = ref(false);
  let eyeTimer: ReturnType<typeof setTimeout> | undefined;
  function toggleHideBalances() {
    settingsStore.setHideBalances(!settingsStore.hideBalances);
    eyeShown.value = true;
    clearTimeout(eyeTimer);
    eyeTimer = setTimeout(() => { eyeShown.value = false }, 2500);
  }
  const hideLabel = computed(() => settingsStore.hideBalances ? t('wallet.showBalances') : t('wallet.hideBalances'));
  // Part of the balance above, not a separate amount: shown so the balance and the lower figure
  // the send form will accept do not silently disagree
  const reservedInBchUnit = computed(() => {
    if (!store.reservedBalance) return undefined;
    const sats = Number(store.reservedBalance);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });

  // Leaving the view while the wallet menu animates closed takes away its anchor, so the menu
  // jumps to the screen's left edge on the way out. For add wallet it closes without the
  // animation instead, and the view changes as soon as it is gone.
  const walletMenu = ref<QMenu | null>(null);
  const defaultMenuTransitionMs = 300;
  const walletMenuTransitionMs = ref(defaultMenuTransitionMs);
  let addWalletAfterMenu = false;
  function addWalletFromMenu() {
    addWalletAfterMenu = true;
    walletMenuTransitionMs.value = 0;
    // the 0ms duration has to reach the menu before it starts hiding
    void nextTick(() => walletMenu.value?.hide());
  }
  function onWalletMenuHide() {
    walletMenuTransitionMs.value = defaultMenuTransitionMs;
    if (!addWalletAfterMenu) return;
    addWalletAfterMenu = false;
    store.changeView(9);
  }

  // The scanner stays open on a code the wallet has no use for, with the reason shown
  const qrFilter = (content: string) => {
    const route = routeScannedCode(content, store.network, store.wallet.networkPrefix);
    return 'error' in route ? route.error : true;
  }
</script>


<template>
  <fieldset class="wallet-fieldset">
    <!-- the wallet's name on the box's border, with a menu to switch or add -->
    <legend class="walletName" role="button" :aria-label="t('settings.currentWallet')">
      <span class="walletNameText">{{ store.activeWalletName }}</span>
      <q-icon name="expand_more" size="20px" class="walletNameChevron" />
      <!-- stops the click here, so the badge opens its own popup and not the wallet menu -->
      <span class="walletNetworkBadge" @click.stop><NetworkBadge /></span>
      <q-menu ref="walletMenu" anchor="bottom left" self="top left" :transition-duration="walletMenuTransitionMs" @hide="onWalletMenuHide">
        <q-list dense style="min-width: 180px">
          <q-item v-for="wallet in store.availableWallets" :key="wallet.name" clickable v-close-popup @click="switchWalletWithNotice(wallet.name)">
            <q-item-section>{{ wallet.name }}</q-item-section>
            <q-item-section side><q-icon v-if="wallet.name === store.activeWalletName" name="check" size="18px" color="primary" /></q-item-section>
          </q-item>
          <template v-if="store.availableWallets.length < maxWallets">
            <q-separator />
            <q-item clickable @click="addWalletFromMenu">
              <q-item-section>{{ t('addWallet.title') }}</q-item-section>
              <q-item-section side><q-icon name="add_circle" size="18px" /></q-item-section>
            </q-item>
          </template>
        </q-list>
      </q-menu>
    </legend>
    <!-- named by a label too: on a phone the pill shows only its icon -->
    <button type="button" class="portfolioLink plain-button" :aria-label="t('portfolio.title')" @click="store.changeView(12)">
      <portfolioIcon :sizePx="20" />
      <span>{{ t('portfolio.title') }}</span>
    </button>
    <div class="balance">
      <!-- The two amounts are the switch that hides what the wallet holds, and no wider than they
           are: the room beside them is not. The eye says so on hover, and for a moment after a
           switch, which is all a touch screen sees of it. -->
      <!-- both lines keep their place while they load, so the page does not shift when they arrive -->
      <div
        class="balanceLines" :class="{ eyeShown, arrived: balanceArrived }"
        @animationend="balanceArrived = false" role="button" tabindex="0" :title="hideLabel" :aria-label="hideLabel"
        @click="toggleHideBalances()"
        @keydown.enter="toggleHideBalances()"
      >
        <div class="balanceMain" :class="{ masked: settingsStore.hideBalances }">
          <template v-if="balanceLines[0]">
            {{ balanceLines[0].amount }} <span class="balanceUnit">{{ balanceLines[0].unit }}</span>
          </template>
          <span v-else class="placeholder-bar" style="width: 5em;"></span>
        </div>
        <div class="balanceSecondary">
          <template v-if="balanceLines[1]">{{ balanceLines[1].amount }} {{ balanceLines[1].unit }}</template>
          <span v-else class="placeholder-bar" style="width: 7em;"></span>
        </div>
        <q-icon :name="settingsStore.hideBalances ? 'sym_o_visibility_off' : 'sym_o_visibility'" size="22px" class="balanceEye" />
      </div>
      <div v-if="reservedInBchUnit && !settingsStore.hideBalances" class="balanceReserved">
        {{ t('wallet.reservedBalance', {
          amount: formatNumber(reservedInBchUnit, 8) + displayUnitLong
        }) }}
      </div>
    </div>
    <div class="walletActions" :class="{ green: settingsStore.greenActionButtons }">
      <button type="button" class="walletAction" @click="store.changeView(17)">
        <span class="walletActionIcon"><q-icon name="arrow_downward" size="22px" /></span>
        {{ t('receive.title') }}
      </button>
      <!-- scanning is a user option, off by default where there is no camera to expect -->
      <button v-if="settingsStore.qrScan" type="button" class="walletAction" @click="showQrCodeDialog = true">
        <span class="walletActionIcon"><q-icon name="qr_code_scanner" size="22px" /></span>
        {{ t('qrScanner.scan') }}
      </button>
      <button type="button" class="walletAction" @click="store.changeView(23)">
        <span class="walletActionIcon"><q-icon name="arrow_upward" size="22px" /></span>
        {{ t('common.actions.send') }}
      </button>
    </div>
    <BackupReminder />
    <RecentActivity />
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="(content: string) => emit('scanned', content)" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
/* the view's frame, also the positioning context for the absolute portfolioLink */
/* the legend's lower half already spaces the content from the border line, so the padding and the
   portfolio pill's offset are that much smaller than they would be without it */
.wallet-fieldset {
  position: relative;
  margin: 0 10px;
  padding-top: 8px;
  padding-bottom: 1.5rem;
  max-width: 75rem;
}
/* a legend, but the name shows as typed: wallet names can differ only in case */
.walletName {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100% - 140px);
  padding: 0 10px;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 700;
  font-size: 1.25em;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
}
.walletName:hover {
  color: var(--color-primary);
}
.walletNameChevron {
  opacity: 0.6;
}
.walletNetworkBadge {
  flex-shrink: 0;
  margin-left: 4px;
}
/* only a comment node is left while the badge is hidden, so no gap is kept for it */
.walletNetworkBadge:empty {
  display: none;
}
.walletNameText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.balance {
  margin: 24px 0 28px;
  text-align: center;
}
/* as wide as the longer of the two lines, so the eye sits beside them, halfway down the pair it
   hides, without taking part in their centring */
.balanceLines {
  position: relative;
  display: inline-block;
  /* the same on both sides to stay centred, the right one holding the eye */
  padding: 0 32px;
  cursor: pointer;
  user-select: none;
}
.balanceEye {
  position: absolute;
  right: 4px;
  /* where the two lines meet, which is below the middle: the upper line is the taller one */
  top: 64%;
  transform: translateY(-50%);
  color: var(--font-color);
  opacity: 0;
  transition: opacity 0.2s;
}
.eyeShown .balanceEye {
  opacity: 0.6;
}
@media (hover: hover) {
  .balanceLines:hover .balanceEye {
    opacity: 0.6;
  }
}
.balanceMain {
  min-height: 1.3em;
  font-size: 2.4em;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-primary);
  overflow-wrap: anywhere;
}
/* dots sit halfway up their line where digits stand on it, so beside them the smaller unit is
   centred on the line too rather than left on the baseline */
.balanceMain.masked {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.25em;
}
.balanceUnit {
  font-size: 0.45em;
  font-weight: 500;
}
.balanceSecondary {
  min-height: 1.5em;
  font-size: 1.1em;
  line-height: 1.5;
}
.balanceReserved {
  color: grey;
}
@media (prefers-reduced-motion: no-preference) {
  .arrived {
    animation: balanceArrive 0.25s ease-out;
  }
}
@keyframes balanceArrive {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
.walletActions {
  display: flex;
  justify-content: center;
  gap: clamp(16px, 8vw, 40px);
  /* The labels under the circles would otherwise sit close on the heading below. This margin and
     the heading's own top one collapse into the larger of the two, so this is the whole gap. */
  margin-bottom: 34px;
}
/* On a phone an icon in an outlined circle over its label, not chota's grey button. Outlined in
   the text's colour rather than tinted green: a green circle with an arrow is what marks a
   received transaction in the list below. */
.walletAction {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 72px;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--font-color);
  font-weight: 500;
}
.walletActionIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1.5px solid var(--font-color);
  border-radius: 50%;
  transition: background-color 0.2s;
}
.walletAction:hover {
  opacity: 1;
}
.walletAction:hover .walletActionIcon {
  background-color: var(--surface-strong);
}
/* the user's choice of the accent green for them, tinted as a received transaction's mark is */
.green .walletActionIcon {
  border-color: transparent;
  background-color: rgba(10, 193, 143, 0.15);
  color: var(--color-primary);
}
.green .walletAction:hover .walletActionIcon {
  background-color: var(--color-primary);
  color: white;
}
/* with room to spare the circle would sit lost in the box: there each action is one pill, the
   icon beside its label */
@media (min-width: 600px) {
  .walletActions {
    gap: 12px;
    margin-bottom: 4px;
  }
  .walletAction {
    flex-direction: row;
    justify-content: center;
    gap: 8px;
    min-width: 150px;
    padding: 9px 20px;
    border: 1.5px solid var(--font-color);
    border-radius: 999px;
    transition: background-color 0.2s;
  }
  .walletAction:hover {
    background-color: var(--surface-strong);
  }
  .walletActionIcon,
  .walletAction:hover .walletActionIcon {
    width: auto;
    height: auto;
    border: none;
    background: none;
  }
  .green .walletAction {
    border-color: rgba(10, 193, 143, 0.45);
    background-color: rgba(10, 193, 143, 0.1);
  }
  .green .walletAction:hover {
    border-color: var(--color-primary);
    background-color: rgba(10, 193, 143, 0.2);
  }
  .green .walletActionIcon,
  .green .walletAction:hover .walletActionIcon {
    background: none;
    color: var(--color-primary);
  }
}
.portfolioLink {
  position: absolute;
  top: 0;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid var(--color-lightGrey);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: border-color 0.2s;
}
body.dark .portfolioLink {
  border-color: var(--color-strongOutline);
}
.portfolioLink:hover {
  border-color: var(--color-primary);
}
/* icon-only pill on small screens, the "Portfolio" label takes too much width */
@media (max-width: 450px) {
  .portfolioLink span {
    display: none;
  }
  .portfolioLink {
    padding: 5px 9px;
  }
  .walletName {
    max-width: calc(100% - 60px);
    font-size: 1.05em;
  }
  /* a BCH amount with all its decimals and its unit on one line, with the eye's room beside it */
  .balanceMain {
    font-size: 2em;
  }
  .balanceLines {
    padding: 0 28px;
  }
}
</style>
