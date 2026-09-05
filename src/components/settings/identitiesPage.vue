<script setup lang="ts">
  import { computed, onActivated, ref, watch } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import genesisInputPicker from './genesisInputPicker.vue'
  import identityCard from './identityCard.vue'
  import { runIdentityAction, type CardAction, type OpenAction, type Outcome } from './identityActions'
  import { preparedUtxoValue, stepLabel } from 'src/utils/tools/tokenCreation'
  import { copyToClipboard, formatBch, truncateHash } from 'src/utils/utils'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmDialog } from 'src/utils/txHelpers'
  import { CASHTOKENS_STUDIO_URL, type IdentityStatus } from 'src/utils/tools/authchainIdentity'
  import { BCMR_GENERATOR_URL, BCMR_SCHEMA_URL, BCMR_EXAMPLES_URL, BCMR_DOCS_URL } from 'src/utils/tools/registryFile'
  import { Notify } from 'quasar'

  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // Two things happen on this page: looking after the identities that are here, and getting one
  // onto it. Only the first is why anyone opens it, so the acquisition paths wait behind a pill.
  const mode = ref<'identities' | 'existing' | 'create' | 'learn'>('identities');

  const categoryInput = ref("");
  // What the wallet listed on its own and the user has not seen. Taken on opening the page and
  // cleared there, so the cards carry the mark for the visit that answers for it.
  const foundAutomatically = ref<string[]>([]);
  // A card shows what it is when closed and what can be done with it when open, one at a time:
  // the details and every operation standing open on every card was the page's real weight.
  const expandedIdentity = ref<string | undefined>(undefined);
  function toggleCard(category: string) {
    expandedIdentity.value = expandedIdentity.value === category ? undefined : category;
  }

  // One form open at a time across the whole list, and one operation in flight across the page,
  // the page's own actions included; the cards read and write both
  const openAction = ref<OpenAction | undefined>(undefined);
  const runningAction = ref<string | undefined>(undefined);
  const busy = computed(() => runningAction.value !== undefined || identitiesStore.identitiesResolving);
  async function runAction(action: 'add' | 'addUtxo' | 'remove', operate: () => Promise<Outcome | void>) {
    await runIdentityAction(runningAction, action, operate);
  }

  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);
  const identities = computed(() => identitiesStore.identities ?? []);
  const identityName = (category: string) => store.bcmrRegistries?.[category]?.name;

  // Three lists: what this wallet holds, what the user chose to watch for somebody else, and the
  // identities of the tokens it holds, followed passively. A watched identity is another wallet's,
  // so it is never counted among this one's; the followed ones are neither. Each group is there
  // when it has something in it; the third also while its lookups run, and never once the
  // following is turned off, whatever it last found.
  const tokenGroupShown = computed(() => {
    if (!settingsStore.followTokenIdentities) return false;
    return identitiesStore.tokenIdentities === undefined || identitiesStore.tokenIdentities.length > 0;
  });
  // a burned identity is nobody's now, so it is listed with the watched ones
  const notOwnedStatuses: IdentityStatus[] = ['notHeld', 'burned'];
  const identityGroups = computed(() => [
    { key: 'held' as const, identities: identities.value.filter(identity => !notOwnedStatuses.includes(identity.status)) },
    { key: 'watched' as const, identities: identities.value.filter(identity => notOwnedStatuses.includes(identity.status)) },
    { key: 'tokens' as const, identities: identitiesStore.tokenIdentities ?? [] },
  ].filter(group => group.key === 'tokens' ? tokenGroupShown.value : group.identities.length > 0));
  // The third tier follows the identities of the tokens this wallet holds, passively: folded,
  // since nobody is actively watching them, and on unless turned off in the settings
  const showTokenIdentities = ref(false);

  // The metadata of a manually added identity is not in the registries yet: the wallet holds its
  // authhead rather than its token, so nothing else fetched it
  async function fetchMissingMetadata() {
    await identitiesStore.fetchMetadataFor(identities.value.map(identity => identity.category));
  }

  // Re-resolving on every visit is the point of the page: the authhead moves whenever the identity's
  // metadata is updated elsewhere, and the reservations are rewritten from what comes back
  async function reloadIdentities() {
    try {
      await identitiesStore.refreshIdentities();
      // naming what the open pass protected but could not name reaches hosting, so it is done here
      if (await identitiesStore.nameUnnamedAuthheads()) await identitiesStore.refreshIdentities();
      // the identities of every held token, all of them on a visit rather than the new ones at open
      if (settingsStore.followTokenIdentities) await identitiesStore.followTokenIdentities('all');
      await fetchMissingMetadata();
      // after the resolving, which is what says where each publication is
      await identitiesStore.checkPublications();
    } catch (error) {
      displayAndLogError(error);
    }
  }

  onActivated(() => {
    // every way in leads here to look at an identity, including the notification trail
    mode.value = 'identities';
    foundAutomatically.value = identitiesStore.markIdentitiesSeen();
    void reloadIdentities();
  });
  // The view is kept alive across navigation, so a different wallet's form input must not linger
  watch(() => store._wallet, () => {
    categoryInput.value = "";
    openAction.value = undefined;
    showTokenIdentities.value = false;
    pickedUtxo.value = undefined;
  });

  async function addIdentity() {
    await runAction('add', async () => {
      const category = categoryInput.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(category)) throw new Error(t('identities.errors.invalidCategory'));
      if (identitiesStore.identityCategories.includes(category)) throw new Error(t('identities.errors.alreadyListed'));
      // The confirm says what was found and where it is, so the name comes first: a fetch that
      // fails leaves the id standing in for the name. The metadata also names the key of an
      // identity that adopted a guard, which the lookup reads.
      if (!store.bcmrRegistries?.[category]) {
        try {
          await store.fetchTokenMetadata([{ category, amount: 0n }], false);
        } catch (error) {
          console.error("Failed to fetch metadata before adding:", error);
        }
      }
      const found = await identitiesStore.inspectCategory(category);
      if (found.status === 'unresolved') throw new Error(t('identities.add.errors.nothingFound'));
      const name = identityName(category) ?? truncateHash(category);
      const summary: string[] = [];
      if (found.guardedBy) {
        summary.push(t('identities.add.found.guarded', { name }));
        summary.push(t(found.status === 'heldViaKey' ? 'identities.add.found.keyHeld' : 'identities.add.found.keyWatched'));
      } else {
        summary.push(t(found.status === 'held' ? 'identities.add.found.held' : 'identities.add.found.watched', { name }));
      }
      const confirmed = await confirmDialog(
        t('identities.add.found.title'),
        summary.join('\n'),
        t('identities.add.found.button')
      );
      if (!confirmed) return;
      await identitiesStore.addIdentity(category);
      await fetchMissingMetadata();
      categoryInput.value = "";
    });
  }

  // A new identity that is not a token starts from any UTXO at output 0, picked or prepared the
  // way the create page picks a genesis input: its txid is the id and the UTXO its authhead, held
  // back from here on. Naming waits for a publication that names it. Two steps, the pick closing
  // to one line before the add, so what is about to be listed is read before it is.
  const pickedUtxo = ref<Utxo | undefined>(undefined);
  const pickStepOpen = ref(true);
  const addStepTitle = (title: 'pick' | 'add') => t(`identities.create.steps.${title}`);
  async function addIdentityFromUtxo() {
    await runAction('addUtxo', async () => {
      const picked = pickedUtxo.value;
      if (!picked) return;
      if (identitiesStore.identityCategories.includes(picked.txid)) throw new Error(t('identities.errors.alreadyListed'));
      const confirmed = await confirmDialog(
        t('identities.create.confirmTitle'),
        t('identities.create.confirmMessage', { outpoint: `${truncateHash(picked.txid)}:0`, amount: bchOf(picked.satoshis) }),
        t('identities.create.confirmButton')
      );
      if (!confirmed) return;
      await identitiesStore.listCreatedIdentity(picked.txid, picked.txid);
      pickedUtxo.value = undefined;
      // The add ends where the naming begins: on the new card with its publish form open, since
      // the steps that give the identity a name are acted on there, not on a step that closes
      Notify.create({ type: 'positive', message: t('identities.create.doneTitle') });
      openCard(picked.txid, 'publish');
    });
  }

  // Lands on one card with one of its forms open, for a hand-over to what comes next; a card that
  // did not resolve has no form to open and is shown as it is
  function openCard(category: string, action: CardAction) {
    mode.value = 'identities';
    expandedIdentity.value = category;
    const identity = identities.value.find(listed => listed.category === category);
    if (identity?.authUtxo) openAction.value = { category, action };
  }

  // These have no name to confirm against, so the dialog says what the UTXO is instead
  async function removeUnnamed(txid: string) {
    await runAction('remove', async () => {
      const confirmed = await confirmDialog(
        t('identities.unnamed.removeTitle'),
        t('identities.unnamed.removeMessage'),
        t('identities.remove.button')
      );
      if (confirmed) await identitiesStore.removeUnnamedAuthhead(txid);
    });
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>{{ t('identities.title') }}</legend>

    <div class="page-head">
      <div>{{ t('identities.description') }}</div>
      <span v-if="mode !== 'learn'" class="page-nav" @click="mode = 'learn'">{{ t('identities.learn.link') }}</span>
      <span v-else class="page-nav" @click="mode = 'identities'">← {{ t('identities.learn.back') }}</span>
    </div>

    <template v-if="mode === 'learn'">
    <div class="section">
      <b>{{ t('identities.learn.title') }}</b>
      <div v-for="topic in ['what', 'holding']" :key="topic" style="margin-top: 12px;">
        <b>{{ t(`identities.learn.${topic}Lead`) }}</b> {{ t(`identities.learn.${topic}`) }}
      </div>
      <div style="margin-top: 12px;">
        <!-- the lead and the sentence share a line: a line break between elements is dropped, a space is kept -->
        <b>{{ t('identities.learn.readMoreLead') }}</b> <i18n-t keypath="identities.learn.readMore" tag="span">
          <template #registries>
            <a :href="BCMR_DOCS_URL" target="_blank">{{ t('identities.learn.registriesLink') }}</a>
          </template>
          <template #studio>
            <a :href="CASHTOKENS_STUDIO_URL[store.network]" target="_blank">CashTokens Studio</a>
          </template>
        </i18n-t>
      </div>
    </div>
    </template>

    <div v-if="mode !== 'learn'" class="type-filter" style="margin-top: 12px;">
      <button :class="{ active: mode === 'identities' }" @click="mode = 'identities'">
        {{ t('identities.modes.identities') }}
      </button>
      <button :class="{ active: mode === 'existing' }" @click="mode = 'existing'">
        {{ t('identities.modes.existing') }}
      </button>
      <button :class="{ active: mode === 'create' }" @click="mode = 'create'">
        {{ t('identities.modes.create') }}
      </button>
    </div>

    <template v-if="mode === 'existing'">
    <div class="section">
      <div>
        <b>{{ t('identities.add.lead') }}</b> {{ t('identities.add.label') }}
        <InfoPopup>
          <div v-for="state in ['held', 'watched']" :key="state" style="max-width: 300px;">
            <b>{{ t(`identities.add.${state}Lead`) }}</b> {{ t(`identities.add.${state}`) }}
          </div>
        </InfoPopup>
      </div>
      <div class="input-with-button" style="margin-top: 12px;">
        <input v-model="categoryInput" :placeholder="t('identities.add.placeholder')" @keyup.enter="addIdentity()">
        <input
          @click="addIdentity()"
          type="button"
          class="primaryButton"
          :value="runningAction === 'add' ? t('identities.add.addingButton') : t('identities.add.button')"
          :disabled="busy || !categoryInput"
        >
      </div>
      <div class="description" style="margin-top: 6px;">
        <b>{{ t('identities.add.authbaseLead') }}</b> {{ t('identities.add.authbase') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.add.keyNote') }}</div>
        </InfoPopup>
      </div>
    </div>
    </template>

    <template v-if="mode === 'create'">
    <div class="section">
      <div><b>{{ t('identities.create.newLead') }}</b> {{ t('identities.create.newWhat') }}</div>
      <div class="description" style="margin-top: 6px;">
        <b>{{ t('identities.create.cautionLead') }}</b> {{ t('identities.create.caution') }}
      </div>
      <div class="info-box" style="margin-top: 12px;">
        <img class="warning-box-icon" :src="settingsStore.darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg'" width="20" height="20">
        <div>
          <b>{{ t('identities.create.tokenLead') }}</b> <i18n-t keypath="identities.create.tokenPointer" tag="span">
            <template #link>
              <span class="action-link" @click="() => store.changeView(6)">{{ t('identities.create.tokenPointerLink') }}</span>
            </template>
          </i18n-t>
        </div>
      </div>
    </div>

    <genesisInputPicker
      v-model="pickedUtxo"
      v-model:open="pickStepOpen"
      :step-label="stepLabel(1, 2, addStepTitle('pick'))"
      :picked-label="t('identities.create.pickedId')"
      :explainer="t('identities.create.pick')"
      :prepare-message="t('identities.create.prepareMessage', { amount: bchOf(preparedUtxoValue) })"
      smallest-first
    >
      <div class="step-label" style="margin-top: 12px;">{{ stepLabel(2, 2, addStepTitle('add')) }}</div>
    </genesisInputPicker>
    <div v-if="!pickStepOpen" class="section">
      <div class="step-label open">{{ stepLabel(2, 2, addStepTitle('add')) }}</div>
      <div style="margin-top: 6px;"><b>{{ t('identities.create.lead') }}</b> {{ t('identities.create.outcome') }}</div>
      <input
        @click="addIdentityFromUtxo()"
        type="button"
        class="primaryButton"
        :value="runningAction === 'addUtxo' ? t('identities.create.creatingButton') : t('identities.create.button')"
        :disabled="busy"
        style="margin-top: 12px;"
      >
      <div class="description" style="margin-top: 6px;">
        <b>{{ t('identities.create.registryLead') }}</b> <i18n-t keypath="identities.create.registry" tag="span">
          <template #schema>
            <a :href="BCMR_SCHEMA_URL" target="_blank">{{ t('identities.publish.generatorHelpSchema') }}</a>
          </template>
          <template #examples>
            <a :href="BCMR_EXAMPLES_URL" target="_blank">{{ t('identities.publish.examplesLink') }}</a>
          </template>
        </i18n-t>
        <InfoPopup>
          <div style="max-width: 300px;">
            <i18n-t keypath="identities.create.registryNote" tag="span">
              <template #generator>
                <a :href="BCMR_GENERATOR_URL" target="_blank">BCMR generator</a>
              </template>
            </i18n-t>
          </div>
        </InfoPopup>
      </div>
    </div>
    </template>

    <div v-if="mode === 'identities'" class="section">
      <div v-if="identitiesStore.openCheckError" class="warning-box" style="margin-bottom: 10px;">
        <q-icon name="warning" size="20px" class="warning-box-icon" />
        <div>{{ t('identities.openCheckFailed', { reason: identitiesStore.openCheckError }) }}</div>
      </div>
      <div v-if="!store.chaingraph" class="warning-box" style="margin-bottom: 10px;">
        <q-icon name="warning" size="20px" class="warning-box-icon" />
        <div>{{ t('identities.chaingraphNotConfigured') }}</div>
      </div>
      <div v-if="!identitiesStore.identities" class="description">{{ t('identities.resolving') }}</div>
      <div v-else-if="!identities.length" class="description">
        <i18n-t keypath="identities.empty" tag="span">
          <template #link>
            <span class="action-link" @click="mode = 'existing'">{{ t('identities.emptyLink') }}</span>
          </template>
        </i18n-t>
      </div>

      <div v-for="coin in identitiesStore.unnamedAuthheadCoins" :key="coin.txid" class="section identity-card">
        <div>
          {{ t('identities.unnamed.title') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('identities.unnamed.help') }}</div>
          </InfoPopup>
        </div>
        <div class="identity-status">
          <q-icon name="lock" size="15px" />
          {{ t('identities.unnamed.status') }}
        </div>
        <div class="copy-target" :title="`${coin.txid}:0`" @click="copyToClipboard(`${coin.txid}:0`)">
          <span class="description">{{ t('identities.authheadLabel') }}</span>
          <span class="mono">{{ truncateHash(coin.txid) }}:0</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
        <div>{{ t('identities.authheadAmount', { amount: bchOf(coin.satoshis) }) }}</div>
        <div class="identity-links">
          <span class="remove-identity" @click="removeUnnamed(coin.txid)">{{ t('identities.remove.button') }}</span>
        </div>
      </div>

      <template v-for="group in identityGroups" :key="group.key">
      <div v-if="group.key !== 'tokens'" class="section">
        {{ group.key === 'held' ? t('identities.ownedCount', group.identities.length) : t('identities.watchedHeader', group.identities.length) }}
      </div>
      <div v-else class="section">
        <div v-if="identitiesStore.tokenIdentities === undefined" class="description">{{ t('identities.follow.resolving') }}</div>
        <div v-else class="follow-head" @click="showTokenIdentities = !showTokenIdentities">
          <span>{{ t('identities.follow.header', group.identities.length) }}</span>
          <q-icon name="expand_more" class="chevron" :class="{ open: showTokenIdentities }" />
        </div>
      </div>
      <identityCard
        v-for="identity in (group.key === 'tokens' && !showTokenIdentities ? [] : group.identities)"
        :key="identity.category"
        :identity="identity"
        :removable="group.key !== 'tokens'"
        :expanded="expandedIdentity === identity.category"
        :found-automatically="foundAutomatically.includes(identity.category)"
        v-model:open-action="openAction"
        v-model:running-action="runningAction"
        @toggle="toggleCard(identity.category)"
      />
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.page-nav {
  cursor: pointer;
}
.page-nav:hover {
  text-decoration: underline;
}
.follow-head {
  cursor: pointer;
}
/* sized and dropped like the info icon beside it, rather than centred on the line box */
.follow-head .chevron {
  font-size: 1.1em;
  vertical-align: -0.2em;
  margin-left: 4px;
}
.chevron {
  transition: transform 0.2s;
}
.chevron.open {
  transform: rotate(180deg);
}
.identity-status {
  color: grey;
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
