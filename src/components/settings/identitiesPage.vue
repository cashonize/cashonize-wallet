<script setup lang="ts">
  import { computed, onActivated, ref, watch } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import { copyToClipboard, formatBchAmount } from 'src/utils/utils'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { validateRecipientAddress } from 'src/utils/payments/recipientAddress'
  import { isTokenCategory, type IdentityState } from 'src/utils/tools/authchainIdentity'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const categoryInput = ref("");
  const isAdding = ref(false);
  // The destination of an open transfer form, keyed by category so each card keeps its own
  const destinationInputs = ref<Record<string, string>>({});
  const transferringCategory = ref<string | undefined>(undefined);

  const bchDisplayUnit = computed(() => store.network === 'mainnet' ? 'BCH' : 'tBCH');
  const truncateHash = (hash: string) => `${hash.slice(0, 16)}...${hash.slice(-8)}`;

  const identities = computed(() => store.identities ?? []);
  const heldCount = computed(() => identities.value.filter(identity => identity.status === 'held').length);

  const identityName = (category: string) => store.bcmrRegistries?.[category]?.name;
  const identityIconUrl = (category: string) => {
    if (settingsStore.disableTokenIcons) return undefined;
    return store.tokenIconUrl(category);
  };

  // The metadata of a manually added identity is not in the registries yet: the wallet holds its
  // authhead rather than its token, so nothing else fetched it
  async function fetchMissingMetadata() {
    const missing = identities.value
      .filter(identity => !store.bcmrRegistries?.[identity.category])
      .map(identity => ({ category: identity.category, amount: 0n }));
    if (!missing.length) return;
    await store.fetchTokenMetadata(missing, false);
  }

  // Re-resolving on every visit is the point of the page: the authhead moves whenever the identity's
  // metadata is updated elsewhere, and the reservations are rewritten from what comes back
  async function reloadIdentities() {
    await store.refreshIdentities();
    await fetchMissingMetadata();
  }

  onActivated(() => { void reloadIdentities() });
  // The view is kept alive across navigation, so a different wallet's form input must not linger
  watch(() => store._wallet, () => {
    categoryInput.value = "";
    destinationInputs.value = {};
  });

  async function addIdentity() {
    if (isAdding.value) return;
    const category = categoryInput.value.trim().toLowerCase();
    if (!isTokenCategory(category)) {
      displayAndLogError(new Error(t('identities.errors.invalidCategory')));
      return;
    }
    if (store.identityCategories.includes(category)) {
      displayAndLogError(new Error(t('identities.errors.alreadyListed')));
      return;
    }
    isAdding.value = true;
    try {
      await store.addIdentity(category);
      await fetchMissingMetadata();
      categoryInput.value = "";
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isAdding.value = false;
    }
  }

  async function removeIdentity(identity: IdentityState) {
    const confirmed = await confirmDialog(
      t('identities.remove.title'),
      identity.status === 'held' ? t('identities.remove.messageHeld') : t('identities.remove.message'),
      t('identities.remove.button')
    );
    if (!confirmed) return;
    try {
      await store.removeIdentity(identity.category);
    } catch (error) {
      displayAndLogError(error);
    }
  }

  // The authhead coin is sent whole, so the transaction is one input and one output and the
  // authchain continues at output 0 of it. What the recipient gets is the coin minus the fee.
  async function transferIdentity(identity: IdentityState) {
    if (transferringCategory.value) return;
    const authUtxo = identity.authUtxo;
    if (!authUtxo) return;
    let destination: string;
    try {
      destination = validateRecipientAddress(
        destinationInputs.value[identity.category] ?? "", store.wallet.networkPrefix
      );
    } catch (error) {
      displayAndLogError(error);
      return;
    }
    const confirmed = await confirmDialog(
      t('identities.transfer.confirmTitle'),
      t('identities.transfer.confirmMessage', {
        amount: `${formatBchAmount(Number(authUtxo.satoshis), false, 8)} ${bchDisplayUnit.value}`,
        address: destination,
      }),
      t('identities.transfer.confirmButton')
    );
    if (!confirmed) return;
    transferringCategory.value = identity.category;
    try {
      notifySending();
      const { txId } = await store.spend.sendUtxo(authUtxo, destination);
      destinationInputs.value[identity.category] = "";
      // The identity is now somebody else's to update, so it leaves this wallet's list
      await store.removeIdentity(identity.category);
      await handleTransactionBroadcastSuccess(
        t('identities.transfer.done', { address: destination }),
        txId,
        t('identities.transfer.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      transferringCategory.value = undefined;
    }
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('identities.title') }}</legend>

    <div>
      {{ t('identities.description') }}
      <InfoPopup>
        <div style="max-width: 300px;">{{ t('identities.whatIsAnIdentity') }}</div>
        <div class="info-popup-note" style="max-width: 300px;">{{ t('identities.whatIsAnIdentityNote') }}</div>
      </InfoPopup>
    </div>
    <div class="description" style="margin-top: 6px;">{{ t('identities.updatedElsewhere') }}</div>
    <div class="description" style="margin-top: 6px;">{{ t('identities.reserveNote') }}</div>

    <div class="section">
      <div>{{ t('identities.add.label') }}</div>
      <div class="add-identity">
        <input v-model="categoryInput" :placeholder="t('identities.add.placeholder')" @keyup.enter="addIdentity()">
        <input
          @click="addIdentity()"
          type="button"
          :value="isAdding ? t('identities.add.addingButton') : t('identities.add.button')"
          :disabled="isAdding || !categoryInput"
        >
      </div>
      <div class="description" style="margin-top: 6px;">{{ t('identities.add.hint') }}</div>
    </div>

    <div class="section">
      <div v-if="store.identitiesResolving || !store.identities" class="description">{{ t('identities.resolving') }}</div>
      <div v-else-if="!identities.length" class="description">{{ t('identities.empty') }}</div>
      <div v-else class="description">{{ t('identities.heldCount', heldCount) }}</div>

      <div v-for="identity in identities" :key="identity.category" class="section identity-card">
        <div class="identity-header">
          <TokenIcon
            :token-id="identity.category"
            :icon-url="identityIconUrl(identity.category)"
            :size="40"
          />
          <div class="identity-title">
            <div>{{ identityName(identity.category) ?? t('identities.unnamedIdentity') }}</div>
            <div class="identity-status" :class="identity.status">
              <q-icon v-if="identity.status === 'held'" name="lock" size="15px" />
              {{ t('identities.status.' + identity.status) }}
            </div>
          </div>
        </div>

        <div class="copy-target" :title="identity.category" @click="copyToClipboard(identity.category)">
          <span class="description">{{ t('identities.categoryLabel') }}</span>
          <span class="mono">{{ truncateHash(identity.category) }}</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
        <div
          v-if="identity.authheadTxid"
          class="copy-target"
          :title="`${identity.authheadTxid}:0`"
          @click="copyToClipboard(`${identity.authheadTxid}:0`)"
        >
          <span class="description">{{ t('identities.authheadLabel') }}</span>
          <span class="mono">{{ truncateHash(identity.authheadTxid) }}:0</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
        <div v-if="identity.authUtxo" class="description">
          {{ t('identities.authheadAmount', {
            amount: `${formatBchAmount(Number(identity.authUtxo.satoshis), false, 8)} ${bchDisplayUnit}`
          }) }}
        </div>

        <div v-if="identity.status === 'carriesTokens'" class="warning-box" style="margin-top: 10px;">
          <q-icon name="warning" size="20px" class="warning-box-icon" />
          <div>{{ t('identities.carriesTokensWarning') }}</div>
        </div>

        <div v-if="identity.status === 'held'" class="section">
          <div>{{ t('identities.transfer.label') }}</div>
          <div class="description" style="margin-top: 4px;">{{ t('identities.transfer.hint') }}</div>
          <div class="transfer-identity">
            <input
              v-model="destinationInputs[identity.category]"
              :placeholder="t('identities.transfer.destinationPlaceholder')"
            >
            <input
              @click="transferIdentity(identity)"
              type="button"
              :value="transferringCategory === identity.category
                ? t('identities.transfer.transferringButton')
                : t('identities.transfer.button')"
              :disabled="transferringCategory !== undefined || !destinationInputs[identity.category]"
            >
          </div>
        </div>

        <div class="identity-links">
          <a :href="`https://tokenexplorer.cash/?tokenId=${identity.category}`" target="_blank">
            {{ t('identities.viewOnExplorer') }}
            <img :src="settingsStore.darkMode? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;">
          </a>
          <span class="remove-identity" @click="removeIdentity(identity)">{{ t('identities.remove.button') }}</span>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.description {
  color: grey;
}
.mono {
  font-family: monospace;
}
.section {
  margin-top: 20px;
}
/* the input takes the room the button does not, on one line where the screen allows it */
.add-identity,
.transfer-identity {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.add-identity input:not([type="button"]),
.transfer-identity input:not([type="button"]) {
  flex: 1 1 260px;
  margin: 0;
}
.add-identity input[type="button"],
.transfer-identity input[type="button"] {
  margin: 0;
}
.identity-card {
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}
.dark .identity-card {
  border-color: #333;
}
.identity-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.identity-title {
  min-width: 0;
}
.identity-status {
  color: grey;
}
.identity-status.held {
  color: var(--color-primary);
}
.identity-status.carriesTokens,
.identity-status.unresolved {
  color: orange;
}
.copy-target {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.identity-links {
  margin-top: 12px;
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
}
.remove-identity {
  cursor: pointer;
  color: grey;
}
</style>
