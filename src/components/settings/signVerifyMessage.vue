<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { HDWallet, SignedMessage } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { copyToClipboard } from 'src/utils/utils'
  import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation'
  import { resolvePrivateKeyForAddress, verifyMessage } from 'src/utils/messageSigning'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import HdAddressSelectDialog from 'src/components/general/hdAddressSelectDialog.vue'

  const store = useStore()
  const $q = useQuasar()
  const { t } = useI18n()

  const isHdWallet = computed(() => store._wallet instanceof HDWallet);

  const mode = ref<'sign' | 'verify'>('sign');

  // The signing address always comes from the wallet itself: single-address wallets
  // have their one fixed address, HD wallets pick one from the address select dialog
  const messageInput = ref("");
  const signAddress = ref(isHdWallet.value ? "" : store.wallet.getDepositAddress());
  const verifyAddressInput = ref("");
  const signatureInput = ref("");
  const signatureResult = ref("");
  const verifyResult = ref(undefined as undefined | boolean);

  function openAddressSelectDialog() {
    $q.dialog({
      component: HdAddressSelectDialog,
      componentProps: {
        title: t('signVerifyMessage.selectAddress'),
        hint: t('signVerifyMessage.selectAddressHint'),
      },
    }).onOk((address: string) => {
      signAddress.value = address;
    });
  }

  // Results no longer match the inputs once any of them change
  watch([messageInput, verifyAddressInput, signatureInput, mode], () => {
    verifyResult.value = undefined;
  });
  watch([messageInput, signAddress], () => {
    signatureResult.value = "";
  });

  // The view is kept alive across navigation, so refresh the signing address
  // when the user switches wallets or networks
  watch(() => store._wallet, () => {
    if (store._wallet) signAddress.value = isHdWallet.value ? "" : store._wallet.getDepositAddress();
  });

  function signMessage() {
    try {
      const privateKey = resolvePrivateKeyForAddress(store.wallet, signAddress.value);
      if (!privateKey) throw new Error(t('signVerifyMessage.errors.addressNotInWallet'));
      signatureResult.value = SignedMessage.sign(messageInput.value, privateKey).signature;
    } catch (error) {
      displayAndLogError(error);
    }
  }

  // Verifying needs the message, address and signature, so offer them as one copyable block
  function copyAll() {
    copyToClipboard(
      `${t('signVerifyMessage.messageLabel')} ${messageInput.value}\n` +
      `${t('signVerifyMessage.addressLabel')} ${signAddress.value}\n` +
      `${t('signVerifyMessage.signatureLabel')} ${signatureResult.value}`
    );
  }

  function verifySignature() {
    try {
      const expectedPrefix = store.network === 'mainnet' ? 'bitcoincash' : 'bchtest';
      const { address } = normalizeCashAddressForNetwork(verifyAddressInput.value, expectedPrefix, {
        invalidAddress: t('signVerifyMessage.errors.invalidAddress'),
        wrongNetwork: t('signVerifyMessage.errors.wrongNetworkAddress'),
      });
      verifyResult.value = verifyMessage(messageInput.value, address, signatureInput.value.trim());
    } catch (error) {
      displayAndLogError(error);
    }
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('signVerifyMessage.title') }}</legend>

    <div class="type-filter" style="margin-top: 10px;">
      <button :class="{ active: mode === 'sign' }" @click="mode = 'sign'">
        {{ t('signVerifyMessage.signMode') }}
      </button>
      <button :class="{ active: mode === 'verify' }" @click="mode = 'verify'">
        {{ t('signVerifyMessage.verifyMode') }}
      </button>
    </div>

    <div style="margin-top: 15px;">
      <template v-if="mode === 'sign'">
        {{ t('signVerifyMessage.descriptionSign') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('signVerifyMessage.usageHint') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('signVerifyMessage.usageHintNote') }}</div>
        </InfoPopup>
      </template>
      <template v-else>
        {{ t('signVerifyMessage.descriptionVerify') }}
      </template>
    </div>

    <div style="margin-top: 15px;">
      <label>{{ t('signVerifyMessage.messageLabel') }}</label>
      <textarea
        v-model="messageInput"
        rows="3"
        :placeholder="t('signVerifyMessage.messagePlaceholder')"
        style="width: 100%;"
      ></textarea>
    </div>

    <div v-if="mode === 'sign'" style="margin-top: 8px;">
      <label>{{ t('signVerifyMessage.addressLabel') }}</label>
      <div
        class="selected-address"
        :class="{ 'no-selection': !signAddress, selectable: isHdWallet }"
        :title="isHdWallet ? t('signVerifyMessage.selectAddress') : undefined"
        @click="isHdWallet && openAddressSelectDialog()"
      >
        <span>{{ signAddress || t('signVerifyMessage.noAddressSelected') }}</span>
        <q-icon v-if="isHdWallet" name="expand_more" class="select-chevron" size="20px" />
      </div>
    </div>
    <div v-else style="margin-top: 8px;">
      <label>{{ t('signVerifyMessage.addressLabel') }}</label>
      <input
        v-model="verifyAddressInput"
        type="text"
        :placeholder="t('signVerifyMessage.addressPlaceholderVerify')"
        style="width: 100%;"
      >
    </div>

    <div v-if="mode === 'verify'" style="margin-top: 8px;">
      <label>{{ t('signVerifyMessage.signatureLabel') }}</label>
      <textarea
        v-model="signatureInput"
        rows="2"
        :placeholder="t('signVerifyMessage.signaturePlaceholderVerify')"
        style="width: 100%;"
      ></textarea>
    </div>

    <div v-if="mode === 'sign'">
      <div class="sign-button-row">
        <input
          @click="signMessage()"
          type="button"
          class="primaryButton"
          :value="t('signVerifyMessage.signButton')"
          :disabled="!messageInput || !signAddress"
        >
      </div>
      <div style="font-size: smaller; color: grey; margin-top: 8px;">
        {{ t('signVerifyMessage.safetyHint') }}
      </div>
      <div v-if="signatureResult" style="margin-top: 12px;">
        <label>{{ t('signVerifyMessage.signatureLabel') }}</label>
        <div class="signature-result">{{ signatureResult }}</div>
        <div class="sign-button-row">
          <input
            @click="copyToClipboard(signatureResult)"
            type="button"
            class="button"
            :value="t('signVerifyMessage.copyButton')"
          >
          <input
            @click="copyAll()"
            type="button"
            class="button"
            :value="t('signVerifyMessage.copyAllButton')"
          >
        </div>
        <div style="font-size: smaller; color: grey; margin-top: 8px;">
          {{ t('signVerifyMessage.shareHint') }}
        </div>
      </div>
    </div>
    <div v-else>
      <div class="sign-button-row">
        <input
          @click="verifySignature()"
          type="button"
          class="primaryButton"
          :value="t('signVerifyMessage.verifyButton')"
          :disabled="!messageInput || !verifyAddressInput || !signatureInput"
        >
      </div>
      <div v-if="verifyResult === true" style="margin-top: 12px; color: var(--color-primary);">
        {{ t('signVerifyMessage.validSignature') }}
      </div>
      <div v-if="verifyResult === false" style="margin-top: 12px; color: red;">
        {{ t('signVerifyMessage.invalidSignature') }}
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.selected-address {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: monospace;
  word-break: break-all;
}
.selected-address.no-selection {
  font-family: inherit;
  color: grey;
}
.selected-address.selectable {
  cursor: pointer;
  transition: background-color 0.2s;
}
.selected-address.selectable:hover {
  background-color: rgba(128, 128, 128, 0.14);
}
.select-chevron {
  flex: none;
  margin-left: auto;
}
.sign-button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 12px;
  flex-wrap: wrap;
}
.signature-result {
  border: 1px solid rgba(128, 128, 128, 0.2);
  background-color: rgba(128, 128, 128, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: monospace;
  word-break: break-all;
}
</style>
