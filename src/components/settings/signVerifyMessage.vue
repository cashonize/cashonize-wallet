<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { SignedMessage } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { copyToClipboard } from 'src/utils/utils'
  import { normalizeCashAddressForNetwork } from 'src/utils/addressValidation'
  import { resolvePrivateKeyForAddress, verifyMessage } from 'src/utils/messageSigning'

  const store = useStore()
  const { t } = useI18n()

  const messageInput = ref("");
  const addressInput = ref(store.wallet.getDepositAddress());
  const signatureInput = ref("");
  const verifyResult = ref(undefined as undefined | boolean);

  // A verify result no longer matches the inputs once any of them change
  watch([messageInput, addressInput, signatureInput], () => {
    verifyResult.value = undefined;
  });

  // The view is kept alive across navigation, so refresh the prefilled address
  // when the user switches wallets or networks
  watch(() => store._wallet, () => {
    if (store._wallet) addressInput.value = store._wallet.getDepositAddress();
  });

  function normalizeAddressInput() {
    const expectedPrefix = store.network === 'mainnet' ? 'bitcoincash' : 'bchtest';
    return normalizeCashAddressForNetwork(addressInput.value, expectedPrefix, {
      invalidAddress: t('signVerifyMessage.errors.invalidAddress'),
      wrongNetwork: t('signVerifyMessage.errors.wrongNetworkAddress'),
    }).address;
  }

  function signMessage() {
    try {
      const address = normalizeAddressInput();
      const privateKey = resolvePrivateKeyForAddress(store.wallet, address);
      if (!privateKey) throw new Error(t('signVerifyMessage.errors.addressNotInWallet'));
      signatureInput.value = SignedMessage.sign(messageInput.value, privateKey).signature;
    } catch (error) {
      displayAndLogError(error);
    }
  }

  function verifySignature() {
    try {
      const address = normalizeAddressInput();
      verifyResult.value = verifyMessage(messageInput.value, address, signatureInput.value.trim());
    } catch (error) {
      displayAndLogError(error);
    }
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('signVerifyMessage.title') }}</legend>

    {{ t('signVerifyMessage.description') }}

    <div style="margin-top: 15px;">
      <label>{{ t('signVerifyMessage.messageLabel') }}</label>
      <textarea
        v-model="messageInput"
        rows="3"
        :placeholder="t('signVerifyMessage.messagePlaceholder')"
        style="width: 100%;"
      ></textarea>
    </div>

    <div style="margin-top: 8px;">
      <label>{{ t('signVerifyMessage.addressLabel') }}</label>
      <input
        v-model="addressInput"
        type="text"
        :placeholder="t('signVerifyMessage.addressPlaceholder')"
        style="width: 100%;"
      >
    </div>

    <div style="margin-top: 8px;">
      <label>{{ t('signVerifyMessage.signatureLabel') }}</label>
      <textarea
        v-model="signatureInput"
        rows="2"
        :placeholder="t('signVerifyMessage.signaturePlaceholder')"
        style="width: 100%;"
      ></textarea>
    </div>

    <div class="sign-button-row">
      <input
        @click="signMessage()"
        type="button"
        class="primaryButton"
        :value="t('signVerifyMessage.signButton')"
        :disabled="!messageInput || !addressInput"
      >
      <input
        @click="verifySignature()"
        type="button"
        class="button"
        :value="t('signVerifyMessage.verifyButton')"
        :disabled="!messageInput || !addressInput || !signatureInput"
      >
      <input
        v-if="signatureInput"
        @click="copyToClipboard(signatureInput)"
        type="button"
        class="button"
        :value="t('signVerifyMessage.copyButton')"
      >
    </div>

    <div v-if="verifyResult === true" style="margin-top: 12px; color: var(--color-primary);">
      {{ t('signVerifyMessage.validSignature') }}
    </div>
    <div v-if="verifyResult === false" style="margin-top: 12px; color: red;">
      {{ t('signVerifyMessage.invalidSignature') }}
    </div>
  </fieldset>
</template>

<style scoped>
.sign-button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 12px;
  flex-wrap: wrap;
}
</style>
