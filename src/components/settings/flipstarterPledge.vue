<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import { copyToClipboard, formatFiatAmount, formatTimeUntil, satsToBch } from 'src/utils/utils'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { resolvePrivateKeyForAddress } from 'src/utils/tools/messageSigning'
  import { outpointOf } from 'src/utils/wallet/reservedUtxos'
  import {
    decodeFlipstarterTemplate,
    createPledgeCommitment,
    templateOutputTotal,
    isTemplateExpired,
  } from 'src/utils/tools/flipstarter'
  import {
    loadPledges,
    savePledge,
    deletePledge,
    pledgeStatus,
    type FlipstarterPledges,
  } from 'src/utils/tools/flipstarterPledges'
  import type { FlipstarterTemplate } from 'src/utils/zodValidation'
  import { secp256k1 } from '@bitauth/libauth'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t, locale } = useI18n()

  const templateInput = ref("");
  const template = ref<FlipstarterTemplate | undefined>(undefined);
  const alias = ref("");
  const comment = ref("");
  const signedPledge = ref("");
  const isPledging = ref(false);
  const pledges = ref<FlipstarterPledges>({});
  const cancellingOutpoint = ref<string | undefined>(undefined);

  // Making a pledge and reviewing past ones are separate jobs, split the way sign and verify are.
  // Pledging stays the default: the signed pledge appears in that half and is the point of the page.
  const mode = ref<'new' | 'yours'>('new');

  const maxAliasLength = 50;
  const maxCommentLength = 200;

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const bchDisplayUnit = computed(() => store.network === 'mainnet' ? 'BCH' : 'tBCH');

  function reloadPledges() {
    if (!store._wallet) return;
    pledges.value = loadPledges(store.network, store.wallet.name);
  }
  reloadPledges();

  // The view is kept alive across navigation, so a different wallet's pledges must not linger
  watch(() => store._wallet, () => {
    reloadPledges();
    templateInput.value = "";
    template.value = undefined;
    signedPledge.value = "";
  });

  // A pledge is listed for as long as the wallet still holds its coin, and disappears when it does
  // not. Nothing here records a pledge that was completed, cancelled elsewhere or spent away: the
  // wallet cannot tell those apart, so it says nothing about them.
  const pledgeRows = computed(() => {
    const walletOutpoints = store.walletUtxos?.map(outpointOf) ?? [];
    return Object.entries(pledges.value)
      .filter(([outpoint]) => walletOutpoints.includes(outpoint))
      .map(([outpoint, pledge]) => ({
        outpoint,
        pledge,
        status: pledgeStatus(pledge, nowSeconds()),
      }));
  });

  // Each step closes as the next one opens, so the page reads forwards. Reaching the review means
  // the request is settled, and signing means the coin is paid for and held, after which editing
  // what it was signed against would only produce a request that no longer matches it.
  const templateRead = computed(() => !!template.value);
  const pledgeMade = computed(() => !!signedPledge.value);

  // A closed step still has to be reopenable, or a request pasted by mistake strands the page.
  // Anything already pledged is kept in the pledge list, so nothing is lost by clearing the form.
  function startOver() {
    templateInput.value = "";
    template.value = undefined;
    signedPledge.value = "";
  }

  const outputTotal = computed(() => template.value ? templateOutputTotal(template.value) : 0n);
  const pledgeShare = computed(() => {
    if (!template.value || outputTotal.value === 0n) return 0;
    return Number(template.value.donation.amount * 10_000n / outputTotal.value) / 100;
  });
  const expired = computed(() => !!template.value && isTemplateExpired(template.value, nowSeconds()));
  const expiryDate = (expires: number) => new Date(expires * 1000).toLocaleString();
  // A date alone leaves the reader working out how long they have, the way the history does
  const expiryRelative = (expires: number) => formatTimeUntil(expires, locale.value);
  const notEnoughFunds = computed(() => {
    if (!template.value || store.spendableBalance === undefined) return false;
    return store.spendableBalance < template.value.donation.amount;
  });
  // A recipient that is one of this wallet's own addresses is worth saying out loud
  const ownRecipients = computed(() => {
    if (!template.value) return [];
    return template.value.outputs.filter(output => store.walletHasAddress(output.address));
  });

  const fiatOf = (satoshis: bigint) => {
    if (store.exchangeRate === undefined) return undefined;
    return formatFiatAmount(satsToBch(satoshis) * store.exchangeRate, settingsStore.currency);
  };
  const bchOf = (satoshis: bigint) => `${satsToBch(satoshis)} ${bchDisplayUnit.value}`;
  const truncateAddress = (address: string) => `${address.slice(0, 22)}...${address.slice(-8)}`;

  function readTemplate() {
    signedPledge.value = "";
    template.value = undefined;
    if (!templateInput.value.trim()) return;
    try {
      template.value = decodeFlipstarterTemplate(templateInput.value);
      alias.value = template.value.data.alias.slice(0, maxAliasLength);
      comment.value = template.value.data.comment.slice(0, maxCommentLength);
    } catch (error) {
      displayAndLogError(error);
    }
  }

  async function makePledge() {
    const pledgeTemplate = template.value;
    if (isPledging.value || !pledgeTemplate) return;
    isPledging.value = true;
    try {
      // Not the expired computed, which only recalculates when the template changes: the page
      // can sit open past the deadline
      if (isTemplateExpired(pledgeTemplate, nowSeconds())) throw new Error(t('flipstarter.errors.campaignExpired'));

      const donationAmount = pledgeTemplate.donation.amount;
      const confirmed = await confirmDialog(
        t('flipstarter.confirm.title'),
        t('flipstarter.confirm.message', { amount: bchOf(donationAmount) }),
        t('flipstarter.confirm.button')
      );
      if (!confirmed) return;
      // The dialog can sit open past the deadline as well
      if (isTemplateExpired(pledgeTemplate, nowSeconds())) throw new Error(t('flipstarter.errors.campaignExpired'));

      // The preparation transaction: a coin of exactly the donation amount, paid to this wallet.
      // It is a real transaction with its own fee, paid whether or not the campaign ever fills.
      notifySending(t('flipstarter.preparingCoin'));
      const pledgeAddress = store.currentDepositAddress;
      const { txId } = await store.spend.send([{ cashaddr: pledgeAddress, value: donationAmount }]);
      if (!txId) throw new Error(t('flipstarter.errors.noBroadcastTxid'));

      // Not read from the wallet's utxo set, which trails a send. Output 0 relies on mainnet-js's
      // fixed ordering: requested outputs first in request order, change appended after them.
      // Note: update if/when mainnet-js randomizes output order
      const pledgeUtxo = { txid: txId, vout: 0, satoshis: donationAmount, address: pledgeAddress };

      // Reserved before signing, so nothing can spend the coin from the moment it exists
      await store.reserveUtxo(pledgeUtxo, 'pledge');
      await store.updateWalletUtxos();

      signedPledge.value = signPledge(pledgeTemplate, pledgeUtxo);

      pledges.value = savePledge(store.network, store.wallet.name, outpointOf(pledgeUtxo), {
        satoshis: donationAmount.toString(),
        outputs: pledgeTemplate.outputs.map(output => ({
          address: output.address,
          satoshis: output.value.toString(),
        })),
        expires: pledgeTemplate.expires,
        pledgedAt: nowSeconds(),
        alias: alias.value,
        comment: comment.value,
        signedPledge: signedPledge.value,
      });

      await handleTransactionBroadcastSuccess(
        t('flipstarter.alerts.pledgePrepared'), txId, t('flipstarter.alerts.pledgePreparedTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isPledging.value = false;
    }
  }

  function signPledge(pledgeTemplate: FlipstarterTemplate, pledgeUtxo: Utxo) {
    const privateKey = resolvePrivateKeyForAddress(store.wallet, pledgeUtxo.address);
    if (!privateKey) throw new Error(t('flipstarter.errors.noPrivateKey'));
    const pubkeyCompressed = secp256k1.derivePublicKeyCompressed(privateKey);
    if (typeof pubkeyCompressed === "string") throw new Error(t('flipstarter.errors.noPrivateKey'));
    return createPledgeCommitment(
      pledgeTemplate,
      pledgeUtxo,
      { privateKey, pubkeyCompressed },
      { alias: alias.value, comment: comment.value },
    );
  }

  // Cancelling is spending the pledge coin back to this wallet before the campaign completes.
  // Once broadcast the signed pledge the campaign holds can no longer be used.
  async function cancelPledge(outpoint: string) {
    if (cancellingOutpoint.value) return;
    // a row only exists while its coin does, so this is the coin the row was built from
    const pledgeUtxo = store.walletUtxos?.find(utxo => outpointOf(utxo) === outpoint);
    if (!pledgeUtxo) return;
    const confirmed = await confirmDialog(
      t('flipstarter.cancel.title'),
      t('flipstarter.cancel.message'),
      t('flipstarter.cancel.button')
    );
    if (!confirmed) return;
    cancellingOutpoint.value = outpoint;
    try {
      notifySending(t('flipstarter.cancel.sending'));
      const { txId } = await store.spend.releaseReservedCoin(pledgeUtxo);
      pledges.value = deletePledge(store.network, store.wallet.name, outpoint);
      await handleTransactionBroadcastSuccess(
        t('flipstarter.cancel.done'), txId, t('flipstarter.cancel.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      cancellingOutpoint.value = undefined;
    }
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('flipstarter.title') }}</legend>

    <div class="type-filter" style="margin-top: 10px;">
      <button :class="{ active: mode === 'new' }" @click="mode = 'new'">
        {{ t('flipstarter.newPledgeMode') }}
      </button>
      <button :class="{ active: mode === 'yours' }" @click="mode = 'yours'">
        {{ t('flipstarter.pledges.title') }}
        <span v-if="pledgeRows.length">({{ pledgeRows.length }})</span>
      </button>
    </div>

    <template v-if="mode === 'new'">
    <div style="margin-top: 15px;">
      {{ t('flipstarter.description') }}
      <InfoPopup>
        <div style="max-width: 300px;">{{ t('flipstarter.whatIsAPledge') }}</div>
        <div class="info-popup-note" style="max-width: 300px;">{{ t('flipstarter.whatIsAPledgeNote') }}</div>
      </InfoPopup>
    </div>

    <div style="margin-top: 10px;">{{ t('flipstarter.warnings.notAPayment') }}</div>

    <!-- What pledging from this wallet costs elsewhere. Not spending the coin from another
         device is only actionable once a pledge exists, so that one lives on the pledge list -->
    <div class="warning-box" style="margin-top: 12px;">
      <q-icon name="warning" size="20px" class="warning-box-icon" />
      <div>
        {{ t('flipstarter.warnings.dappActions') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('flipstarter.warnings.dappActionsDetail') }}</div>
        </InfoPopup>
      </div>
    </div>

    <!-- Template input -->
    <div style="margin-top: 15px;">
      <div class="description">{{ t('flipstarter.step', { current: 1, total: 3 }) }}</div>
      <label>{{ t('flipstarter.templateLabel') }}</label>
      <textarea
        v-model="templateInput"
        rows="4"
        style="width: 100%; margin-top: 5px;"
        :placeholder="t('flipstarter.templatePlaceholder')"
        :disabled="templateRead"
      ></textarea>
      <!-- Where on a campaign page the request comes from, said at the point of asking for it -->
      <div class="description" style="margin-top: 5px;">
        {{ t('flipstarter.ecPluginCompatible') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('flipstarter.ecPluginCompatibleDetail') }}</div>
        </InfoPopup>
      </div>
      <input
        @click="readTemplate()"
        type="button"
        class="primaryButton"
        :value="t('flipstarter.readTemplate')"
        :disabled="templateRead || !templateInput.trim()"
        style="margin-top: 8px;"
      >
      <!-- The way back out of a step that has closed, for a request pasted by mistake -->
      <input
        v-if="templateRead"
        @click="startOver()"
        type="button"
        :value="t('flipstarter.startOver')"
        style="margin-top: 8px; margin-left: 8px;"
      >
    </div>

    <!-- What the template actually says -->
    <template v-if="template">
      <div class="section divided" style="margin-top: 18px;">
        <div class="description">{{ t('flipstarter.step', { current: 2, total: 3 }) }}</div>
        <div><strong>{{ t('flipstarter.review.title') }}</strong></div>
        <div class="description">{{ t('flipstarter.review.noCampaignIdentity') }}</div>
        <div class="description" style="margin-top: 10px;">{{ t('flipstarter.recipientCount', template.outputs.length) }}</div>

        <!-- An address is too long to sit in a column beside anything, so each recipient is a
             block with the amount above the address it pays -->
        <div v-for="output in template.outputs" :key="output.address + output.value" class="recipient">
          <div class="mono">
            {{ bchOf(output.value) }}
            <span class="description">{{ t('flipstarter.review.recipient') }}</span>
          </div>
          <div class="mono muted full-address" @click="copyToClipboard(output.address)">
            {{ output.address }}
          </div>
        </div>

        <div style="margin-top: 10px;">
          {{ t('flipstarter.review.campaignTotal', { amount: bchOf(outputTotal) }) }}
        </div>
        <div>
          {{ t('flipstarter.review.yourPledge', {
            amount: bchOf(template.donation.amount),
            fiat: fiatOf(template.donation.amount) ?? '',
            share: pledgeShare,
          }) }}
        </div>
        <div :style="expired ? 'color: red;' : ''">
          {{ t('flipstarter.expires', { date: expiryDate(template.expires) }) }} ({{ expiryRelative(template.expires) }})
          <span v-if="expired">{{ t('flipstarter.review.alreadyExpired') }}</span>
        </div>

        <div v-if="ownRecipients.length" style="margin-top: 8px; color: orange;">
          {{ t('flipstarter.review.ownAddressRecipient') }}
        </div>
      </div>

      <!-- Published alongside the pledge on the campaign page -->
      <div style="margin-top: 15px;">
        <label>{{ t('flipstarter.aliasLabel') }}</label>
        <input v-model="alias" :maxlength="maxAliasLength" style="width: 100%;" :placeholder="t('flipstarter.aliasPlaceholder')" :disabled="pledgeMade">
        <label style="margin-top: 8px; display: block;">{{ t('flipstarter.commentLabel') }}</label>
        <input v-model="comment" :maxlength="maxCommentLength" style="width: 100%;" :placeholder="t('flipstarter.commentPlaceholder')" :disabled="pledgeMade">
        <div class="description" style="margin-top: 5px;">{{ t('flipstarter.dataPublished') }}</div>
      </div>

      <div v-if="notEnoughFunds" style="margin-top: 10px; color: red;">
        {{ t('flipstarter.errors.notEnoughSpendable') }}
      </div>

      <input
        @click="makePledge()"
        type="button"
        class="primaryButton"
        :value="isPledging ? t('flipstarter.pledgingButton') : t('flipstarter.pledgeButton')"
        :disabled="pledgeMade || isPledging || expired || notEnoughFunds"
        style="margin-top: 12px;"
      >
    </template>

    <!-- The signed pledge to hand back to the campaign -->
    <div v-if="signedPledge" class="section divided" style="margin-top: 18px;">
      <div class="description">{{ t('flipstarter.step', { current: 3, total: 3 }) }}</div>
      <div><strong>{{ t('flipstarter.signedPledge.title') }}</strong></div>
      <div class="description">
        {{ t('flipstarter.signedPledge.instructions') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('flipstarter.signedPledge.detail') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('flipstarter.signedPledge.detailNote') }}</div>
        </InfoPopup>
      </div>
      <textarea readonly rows="4" style="width: 100%; margin-top: 8px;" :value="signedPledge"></textarea>
      <input
        @click="copyToClipboard(signedPledge)"
        type="button"
        class="primaryButton"
        :value="t('flipstarter.signedPledge.copy')"
        style="margin-top: 8px;"
      >
    </div>
    </template>

    <!-- Pledges this wallet has made -->
    <template v-else>
    <div style="margin-top: 15px;">
      <!-- The first thing on this half, so it reads as the page speaking rather than as an aside -->
      <div>
        {{ t('flipstarter.pledges.cannotConfirm') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('flipstarter.pledges.cannotConfirmDetail') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('flipstarter.pledges.cannotConfirmRecovery') }}</div>
        </InfoPopup>
      </div>

      <!-- The one warning that stays live for as long as a pledge does -->
      <div v-if="pledgeRows.length" class="warning-box" style="margin-top: 12px;">
        <q-icon name="warning" size="20px" class="warning-box-icon" />
        <div>
          {{ t('flipstarter.warnings.otherDevices') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('flipstarter.warnings.otherDevicesDetail') }}</div>
          </InfoPopup>
        </div>
      </div>

      <div v-if="!pledgeRows.length && store.walletUtxos" class="description" style="margin-top: 12px;">{{ t('flipstarter.pledges.empty') }}</div>

      <div v-for="row in pledgeRows" :key="row.outpoint" class="section" style="margin-top: 10px;">
        <div class="pledge-summary">
          <strong>{{ bchOf(BigInt(row.pledge.satoshis)) }}</strong>
          <span class="muted">{{ t('flipstarter.pledges.recipientCount', row.pledge.outputs.length) }}</span>
        </div>
        <div class="muted">{{ t('flipstarter.pledges.status.' + row.status) }}</div>
        <div class="mono muted" :title="row.outpoint">{{ truncateAddress(row.outpoint) }}</div>
        <div class="muted">
          {{ t('flipstarter.expires', { date: expiryDate(row.pledge.expires) }) }} ({{ expiryRelative(row.pledge.expires) }})
        </div>
        <div style="margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap;">
          <input
            @click="copyToClipboard(row.pledge.signedPledge)"
            type="button"
            :value="t('flipstarter.signedPledge.copy')"
          >
          <input
            @click="cancelPledge(row.outpoint)"
            type="button"
            :value="cancellingOutpoint === row.outpoint ? t('flipstarter.cancel.cancelling') : t('flipstarter.cancel.button')"
            :disabled="cancellingOutpoint !== undefined"
          >
        </div>
      </div>
    </div>
    </template>
  </fieldset>
</template>

<style scoped>
.description {
  color: grey;
}
.muted {
  color: grey;
}
.mono {
  font-family: monospace;
}
.recipient {
  margin-top: 10px;
}
/* spacing between the amount and the recipient count, rather than a literal space in markup */
.pledge-summary {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}
/* shown whole rather than shortened: this is the one thing in the request that says where the
   money goes, and there is nothing else in the request to check it against */
.full-address {
  word-break: break-all;
  cursor: pointer;
}
</style>
