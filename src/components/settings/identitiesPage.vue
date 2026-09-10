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
  import { formatBch, truncateHash } from 'src/utils/utils'
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
  const busy = computed(() => runningAction.value !== undefined);
  async function runAction(action: 'add' | 'addUtxo' | 'remove', operate: () => Promise<Outcome | void>) {
    await runIdentityAction(runningAction, action, operate);
  }

  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);
  const identities = computed(() => identitiesStore.identities ?? []);
  const identityName = (category: string) => store.bcmrRegistries?.[category]?.name;

  // Three lists: what this wallet holds, what the user chose to watch for somebody else, and the
  // identities of the tokens it holds, followed passively. Neither of the last two counts among
  // this wallet's. The followed group also shows while its lookups run, and never once the
  // following is turned off, whatever it last found.
  const tokenGroupShown = computed(() => {
    if (!settingsStore.followTokenIdentities) return false;
    return identitiesStore.followedTokenIdentities === undefined || identitiesStore.followedTokenIdentities.length > 0;
  });
  // a burned identity is nobody's now, so it is listed with the watched ones
  const notOwnedStatuses: IdentityStatus[] = ['notHeld', 'burned'];
  const identityGroups = computed(() => [
    { key: 'held' as const, identities: identities.value.filter(identity => !notOwnedStatuses.includes(identity.status)) },
    { key: 'watched' as const, identities: identities.value.filter(identity => notOwnedStatuses.includes(identity.status)) },
    { key: 'tokens' as const, identities: identitiesStore.followedTokenIdentities ?? [] },
  ].filter(group => group.key === 'tokens' ? tokenGroupShown.value : group.identities.length > 0));
  // A wallet opening on a dozen identities it found for itself would carry the same pill a dozen
  // times, so the group says it once instead. The pills stay for a mixed group, where they are
  // the only thing saying which ones are new.
  const heldAllFound = computed(() => {
    const held = identityGroups.value.find(group => group.key === 'held')?.identities ?? [];
    return held.length > 1 && held.every(identity => foundAutomatically.value.includes(identity.category));
  });
  function showsFoundPill(groupKey: string, category: string) {
    if (groupKey === 'held' && heldAllFound.value) return false;
    return foundAutomatically.value.includes(category);
  }

  // The third tier follows the identities of the tokens this wallet holds, passively: folded,
  // since nobody is actively watching them, and on unless turned off in the settings
  const showTokenIdentities = ref(false);
  // the chain drawn out, folded the same way: the prose above says what it is without it
  const showChain = ref(false);

  // From the listed categories rather than the resolved states: a watched identity's token is not
  // in the wallet, so nothing else fetches the name its card is known by
  async function fetchMissingMetadata() {
    await identitiesStore.fetchMetadataFor(identitiesStore.identityCategories);
  }

  // Re-resolving on every visit is the point of the page: the authhead moves whenever the identity's
  // metadata is updated elsewhere, and the reservations are rewritten from what comes back
  async function reloadIdentities() {
    try {
      // the names first: the cards are up already, and a name the wallet open failed to fetch
      // would otherwise wait on Chaingraph
      await fetchMissingMetadata();
      await identitiesStore.refreshIdentities();
      // the identities of every held token, all of them on a visit rather than the new ones at
      // open; with following off, those of the held NFTs shaped like a key
      await identitiesStore.followTokenIdentities(settingsStore.followTokenIdentities ? 'all' : 'keys');
      // after the resolving, which is what says where each publication is
      await identitiesStore.checkPublications();
    } catch (error) {
      displayAndLogError(error);
    }
  }

  onActivated(() => {
    // every way in leads here to look at an identity, including the notification trail; the
    // found dialog's Learn more leads to the learn text, and the token list to one card
    mode.value = identitiesStore.takeLearnRequest() ? 'learn' : 'identities';
    foundAutomatically.value = identitiesStore.markIdentitiesSeen();
    const requested = identitiesStore.takeCardRequest();
    if (requested) openCard(requested.category, requested.action as CardAction | undefined);
    void reloadIdentities();
  });
  // The view is kept alive across navigation, so a different wallet's form input must not linger
  watch(() => store._wallet, () => {
    categoryInput.value = "";
    openAction.value = undefined;
    showTokenIdentities.value = false;
    pickedUtxo.value = undefined;
  });

  // The confirm says what was found and where it is, so the name comes first: a fetch that fails
  // leaves the id standing in for the name
  async function fetchMetadata(category: string) {
    if (store.bcmrRegistries?.[category]) return;
    try {
      await store.fetchTokenMetadata([{ category, amount: 0n }], false);
    } catch (error) {
      console.error("Failed to fetch metadata before adding:", error);
    }
  }

  async function addIdentity() {
    await runAction('add', async () => {
      const category = categoryInput.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(category)) throw new Error(t('identities.errors.invalidCategory'));
      if (identitiesStore.identityCategories.includes(category)) throw new Error(t('identities.errors.alreadyListed'));
      // fetched before the lookup, which reads the key an identity that adopted a guard names there
      await fetchMetadata(category);
      const found = await identitiesStore.inspectCategory(category);
      if (found.status === 'unresolved') throw new Error(t('identities.add.errors.nothingFound'));
      // an AuthKey's category resolves to the identity it guards, which is the one to name and list
      if (identitiesStore.identityCategories.includes(found.category)) throw new Error(t('identities.errors.alreadyListed'));
      if (found.category !== category) await fetchMetadata(found.category);
      const name = identityName(found.category) ?? truncateHash(found.category);
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
      await identitiesStore.addIdentity(found.category, found);
      await fetchMissingMetadata();
      categoryInput.value = "";
    });
  }

  // A new identity that is not a token starts from any UTXO at output 0, picked or prepared the
  // way the create page picks a genesis input: its txid is the id and the UTXO its authhead. Two
  // steps, the pick closing to one line before the add, so what is about to be listed is read
  // before it is.
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
  function openCard(category: string, action?: CardAction) {
    mode.value = 'identities';
    expandedIdentity.value = category;
    if (!action) return;
    const identity = identities.value.find(listed => listed.category === category);
    const opens = action === 'transferKey' ? identity?.authKeyUtxo : identity?.authUtxo;
    if (opens) openAction.value = { category, action };
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
      <div v-for="topic in ['what', 'holding', 'custody']" :key="topic" style="margin-top: 12px;">
        <b>{{ t(`identities.learn.${topic}Lead`) }}</b> {{ t(`identities.learn.${topic}`) }}
      </div>
      <!-- The chain itself, which the prose above used to spell out link by link. Its terms are
           the spec's and stand untranslated, as they do in the rest of this page. -->
      <div class="chain-head" @click="showChain = !showChain">
        <span>{{ t('identities.learn.chainToggle') }}</span>
        <q-icon name="expand_more" class="chevron" :class="{ open: showChain }" />
      </div>
      <figure v-if="showChain" class="chain-figure">
        <svg viewBox="0 0 560 132" role="img" :aria-label="t('identities.learn.chainCaption')">
          <!-- the transactions, and the outputs of each that are not the identity's -->
          <g fill="none" stroke="currentColor" stroke-opacity="0.4">
            <rect x="6" y="34" width="150" height="64" rx="8" />
            <rect x="197" y="34" width="150" height="64" rx="8" />
            <rect x="388" y="34" width="150" height="64" rx="8" />
            <rect x="110" y="68" width="40" height="16" rx="8" />
            <rect x="301" y="68" width="40" height="16" rx="8" />
            <rect x="492" y="68" width="40" height="16" rx="8" />
          </g>
          <g fill="currentColor" fill-opacity="0.5" font-size="10" text-anchor="middle">
            <text x="130" y="80">1</text>
            <text x="321" y="80">1</text>
            <text x="512" y="80">1</text>
          </g>
          <g fill="currentColor" font-size="12">
            <text x="18" y="71">Authbase</text>
            <text x="209" y="71">…</text>
            <text x="400" y="71">Authhead</text>
          </g>
          <!-- output 0 of each, and the chain that runs through them -->
          <g class="chain-live">
            <g fill="none" stroke="currentColor">
              <rect x="110" y="42" width="40" height="16" rx="8" />
              <rect x="301" y="42" width="40" height="16" rx="8" />
              <rect x="492" y="42" width="40" height="16" rx="8" />
              <path d="M156 50h29" />
              <path d="M347 50h29" />
              <path d="M532 50h16v58" />
            </g>
            <g fill="currentColor" font-size="10" text-anchor="middle">
              <polygon points="185,46 193,50 185,54" />
              <polygon points="376,46 384,50 376,54" />
              <text x="130" y="54">0</text>
              <text x="321" y="54">0</text>
              <text x="512" y="54">0</text>
            </g>
            <text x="548" y="122" fill="currentColor" font-size="11" text-anchor="end">
              {{ t('identities.learn.chainUtxo') }}
            </text>
          </g>
        </svg>
        <figcaption class="description">{{ t('identities.learn.chainCaption') }}</figcaption>
      </figure>
      <div class="description" style="margin-top: 12px;">
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
      <!-- an identity that is not a token is new ground, so the way in is behind a user option -->
      <button v-if="settingsStore.nonTokenIdentities" :class="{ active: mode === 'create' }" @click="mode = 'create'">
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
      <div v-if="pickStepOpen"><b>{{ t('identities.create.newLead') }}</b> {{ t('identities.create.newWhat') }}</div>
      <div class="description" :style="pickStepOpen ? 'margin-top: 6px;' : ''">
        <b>{{ t('identities.create.cautionLead') }}</b> {{ t('identities.create.caution') }}
      </div>
      <div v-if="pickStepOpen" class="info-box" style="margin-top: 12px;">
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
          <template #generator>
            <a :href="BCMR_GENERATOR_URL" target="_blank">BCMR generator</a>
          </template>
          <template #schema>
            <a :href="BCMR_SCHEMA_URL" target="_blank">{{ t('identities.publish.generatorHelpSchema') }}</a>
          </template>
          <template #examples>
            <a :href="BCMR_EXAMPLES_URL" target="_blank">{{ t('identities.publish.examplesLink') }}</a>
          </template>
        </i18n-t>
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.create.registryNote') }}</div>
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
      <div v-if="!identitiesStore.identities" class="description">{{ t('identities.resolving') }} <q-spinner-dots size="1.2em" /></div>
      <div v-else-if="!identities.length" class="description">
        <i18n-t keypath="identities.empty" tag="span">
          <template #link>
            <span class="action-link" @click="mode = 'existing'">{{ t('identities.emptyLink') }}</span>
          </template>
        </i18n-t>
      </div>

      <template v-for="group in identityGroups" :key="group.key">
      <div v-if="group.key !== 'tokens'" class="section">
        {{ group.key === 'held' ? t('identities.ownedCount', group.identities.length) : t('identities.watchedHeader', group.identities.length) }}
        <InfoPopup v-if="group.key === 'held' && heldAllFound">
          <template #trigger>
            <span class="identity-badge">{{ t('identities.detected.allFoundAutomatically') }}</span>
          </template>
          <div style="max-width: 300px;">{{ t('identities.detected.allFoundAutomaticallyHelp') }}</div>
        </InfoPopup>
      </div>
      <div v-else class="section">
        <div v-if="identitiesStore.followedTokenIdentities === undefined" class="description">{{ t('identities.follow.resolving') }} <q-spinner-dots size="1.2em" /></div>
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
        :found-automatically="showsFoundPill(group.key, identity.category)"
        v-model:open-action="openAction"
        v-model:running-action="runningAction"
        @toggle="toggleCard(identity.category)"
      />
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
/* the description on the left and the way into Learn on the right; on a phone the link
   takes its own line under the description instead */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
@media only screen and (max-width: 600px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}
/* the cards carry their own padding, so on a phone the page's fieldset gives up most of
   its own, the way the history page does */
@media only screen and (max-width: 500px) {
  fieldset {
    padding: 0.5rem 1rem;
  }
  legend {
    margin-left: 0.5rem;
  }
}
.chain-head {
  cursor: pointer;
  margin-top: 12px;
}
/* the chain drawn at the width it has, up to the size at which its labels stop growing; the
   caption is not held to that width, since it is prose */
.chain-figure {
  margin: 8px 0 0;
}
.chain-figure svg {
  display: block;
  width: 100%;
  max-width: 560px;
  height: auto;
}
/* the identity's own output and the chain through it, told from the rest the way the standard's
   own figure tells them apart */
.chain-figure .chain-live {
  color: var(--color-primary);
}
.chain-figure figcaption {
  margin-top: 6px;
  font-size: 0.9em;
}
.page-nav {
  cursor: pointer;
  white-space: nowrap;
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
