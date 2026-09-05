<script setup lang="ts">
  // One identity: what it is, where it lives, what it published, and the operations on it, all of
  // them the same spend of the authhead. Closed, it shows its states; open, the details and the
  // actions. Which form is open and what is running are the page's, handed to every card.
  import { computed, ref, watch } from 'vue'
  import { runIdentityAction, type CardAction, type OpenAction, type Outcome } from './identityActions'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import publicationLocations from './publicationLocations.vue'
  import {
    copyToClipboard,
    formatBch,
    formatRelativeTime,
    truncateHash,
    formatTokenAmountFromBigInt,
    formatTokenAmountWithSymbol,
    parseTokenAmountToBigInt,
  } from 'src/utils/utils'
  import { confirmDialog, notifySending } from 'src/utils/txHelpers'
  import { validateRecipientAddress, validateTokenRecipientAddress } from 'src/utils/payments/recipientAddress'
  import {
    BCMR_GENERATOR_URL,
    BCMR_SCHEMA_URL,
    CASHTOKENS_STUDIO_URL,
    diffRegistries,
    fetchCandidateRegistry,
    fetchPublishedRegistry,
    filledLocations,
    identityOutput,
    locationBudgetLeft,
    transferOutputs,
    publicationOutput,
    registryUrlOf,
    summarizeRegistry,
    type IdentityState,
    type PublicationUriStatus,
    type RegistrySummary,
  } from 'src/utils/tools/authchainIdentity'
  import { hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth'
  import { TokenSendRequest } from 'mainnet-js'
  import { outpointOf } from 'src/utils/wallet/reservedUtxos'
  import { maxTokenSupply } from 'src/utils/tools/tokenCreation'

  const props = defineProps<{
    identity: IdentityState,
    groupKey: 'held' | 'watched' | 'tokens',
    expanded: boolean,
    foundAutomatically: boolean,
  }>()
  const emit = defineEmits<{ toggle: [] }>()
  const openAction = defineModel<OpenAction | undefined>('openAction', { required: true })
  const runningAction = defineModel<string | undefined>('runningAction', { required: true })

  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);
  const identityName = computed(() => store.bcmrRegistries?.[props.identity.category]?.name);
  const identityIconUrl = computed(() => {
    if (settingsStore.disableTokenIcons) return undefined;
    return store.tokenIconUrl(props.identity.category);
  });

  // the token list narrows itself to a pending search on arrival, the way a token request opens it
  function openInTokenList() {
    store.pendingTokenSearch = props.identity.category;
    store.changeView(2);
  }

  // Where the identity output sits, as the chain has it: an address when the locking bytecode has
  // one, the raw script otherwise. A guarded identity's is its covenant address, in the token-aware
  // form since the output carries a token. A burned one sits nowhere, which its status says.
  const location = computed((): { kind: 'address' | 'script'; text: string } | undefined => {
    const lockingBytecode = props.identity.identityOutput?.lockingBytecode;
    if (!lockingBytecode || props.identity.status === 'burned') return undefined;
    const decoded = lockingBytecodeToCashAddress({
      bytecode: hexToBin(lockingBytecode),
      prefix: store.wallet.networkPrefix,
      tokenSupport: props.identity.guardedBy !== undefined,
    });
    if (typeof decoded === 'string') return { kind: 'script', text: lockingBytecode };
    return { kind: 'address', text: decoded.address };
  });

  // what the identity output holds in BCH: the coin's own word when it is here, the chain's otherwise
  const identityValue = computed(() => props.identity.authUtxo?.satoshis ?? props.identity.identityOutput?.satoshis);

  // What the identity output carries alongside the authority to update the metadata: a token
  // supply held back from circulation, an NFT that mints the category's tokens, or both at once
  const carries = computed(() => {
    const token = props.identity.authUtxo?.token ?? props.identity.identityOutput?.token;
    if (!token) return undefined;
    const lines: string[] = [];
    // the largest amount a category can hold is the AuthGuard standard's mark for a supply with
    // no ceiling, and reads as that rather than as the number
    if (token.amount === maxTokenSupply) {
      lines.push(t('identities.reserve.supplyOpenEnded'));
    } else if (token.amount) {
      const amount = formatTokenAmountWithSymbol(token.amount, store.bcmrRegistries?.[props.identity.category]);
      lines.push(t('identities.reserve.supply', { amount }));
    }
    if (token.nft?.capability === 'minting') lines.push(t('identities.reserve.mintingNft'));
    else if (token.nft) lines.push(t('identities.reserve.nft'));
    return lines;
  });
  const carriesLine = computed(() => carries.value?.join(' · '));

  // When the latest publication was mined: the chain's date, unlike the registry's own timestamp,
  // absolute like the history's dates, with the relative time on hover for freshness at a glance
  const publicationDate = computed(() => {
    const timestamp = props.identity.publication?.timestamp;
    return timestamp ? linkDate(timestamp) : t('identities.publication.unconfirmed');
  });
  const publicationTimeAgo = computed(() => {
    const timestamp = props.identity.publication?.timestamp;
    return timestamp ? formatRelativeTime(timestamp) : undefined;
  });

  // The fungible supply the genesis made, which the reserve is read against and which never
  // changes: a fact about the token rather than the output, so it shows once the card is open
  const genesisSupplyLine = computed(() => {
    const supply = props.identity.genesisSupply;
    if (!supply) return undefined;
    if (supply === maxTokenSupply) return t('identities.reserve.genesisSupplyOpenEnded');
    const amount = formatTokenAmountWithSymbol(supply, store.bcmrRegistries?.[props.identity.category]);
    return t('identities.reserve.genesisSupply', { amount });
  });

  const tokenDecimals = computed(() => store.bcmrRegistries?.[props.identity.category]?.token?.decimals ?? 0);
  const reserve = computed(() => (props.identity.authUtxo?.token ?? props.identity.identityOutput?.token)?.amount ?? 0n);
  const reserveDisplay = computed(() => formatTokenAmountFromBigInt(reserve.value, tokenDecimals.value));

  // An IPFS CID cannot serve content other than its own, so a mismatch there says something
  // different from an edited file at an HTTPS location
  function uriStatusText(uri: string, status: PublicationUriStatus) {
    if (status !== 'changed') return t(`identities.publication.status.${status}`);
    return uri.startsWith('ipfs://')
      ? t('identities.publication.status.changedIpfs')
      : t('identities.publication.status.changed');
  }

  // One row per published location: the location as published, where it is actually fetched from,
  // and what fetching it found once the check has run. A closed card shows the badges, an open one the rows.
  const publicationRows = computed(() => {
    const statuses = identitiesStore.publicationChecks[props.identity.category];
    return (props.identity.publication?.uris ?? []).map((uri, index) => {
      const status = statuses?.[index];
      return {
        uri,
        url: registryUrlOf(uri, settingsStore.ipfsGateway),
        status,
        statusText: status ? uriStatusText(uri, status) : undefined,
      };
    });
  });

  // A location serving something other than what was published is not just a warning on an
  // identity this wallet can act on: it is the state the publish flow exists to resolve
  const hasDrifted = computed(() => {
    if (!props.identity.authUtxo) return false;
    return (identitiesStore.publicationChecks[props.identity.category] ?? []).some(status => status === 'changed');
  });

  // The forms, one open at a time across the list, which is why which one is open is the page's
  const isOpen = (action: CardAction) =>
    openAction.value?.category === props.identity.category && openAction.value.action === action;
  function toggleAction(action: CardAction) {
    openAction.value = isOpen(action) ? undefined : { category: props.identity.category, action };
  }

  const publishUris = ref<string[]>([]);
  const currentRegistry = ref<RegistrySummary | undefined>(undefined);
  const issueAmount = ref("");
  const issueDestination = ref("");
  const addToReserveAmount = ref("");
  const destination = ref("");
  const keyDestination = ref("");
  // whether a transfer takes the reserve and minting NFT with it; staying is the default
  const transferTokensAlong = ref(false);

  // A form opens fresh, whether this card opened it or the page landed on it
  watch(() => (openAction.value?.category === props.identity.category ? openAction.value.action : undefined), async action => {
    if (!action) return;
    const publication = props.identity.publication;
    // the common update changes what the locations serve, not the locations themselves
    publishUris.value = publication?.uris.length ? [...publication.uris] : [""];
    issueAmount.value = "";
    issueDestination.value = "";
    addToReserveAmount.value = "";
    destination.value = "";
    keyDestination.value = "";
    transferTokensAlong.value = false;
    currentRegistry.value = undefined;
    if (action !== 'publish' || !publication) return;
    // read what is published now, so the update can say what it changes
    const published = await fetchPublishedRegistry(publication.uris, settingsStore.ipfsGateway);
    if (!published || !isOpen('publish')) return;
    currentRegistry.value = summarizeRegistry(published, props.identity.category);
  }, { immediate: true });

  const filledUris = computed(() => filledLocations(publishUris.value));
  const publicationBytesLeft = computed(() => locationBudgetLeft(filledUris.value));

  async function runAction(action: CardAction, operate: () => Promise<Outcome | void>) {
    await runIdentityAction(runningAction, action, operate, () => { openAction.value = undefined; });
  }

  const walletAddresses = () => ({
    bch: store.wallet.getDepositAddress(),
    token: store.wallet.getTokenDepositAddress(),
  });

  // Everything the publisher should see before signing: the wallet fetched what the locations
  // serve now, hashed it, and reads out of it what holders will be told changed.
  function publishConfirmMessage(candidateSummary: RegistrySummary, hash: string) {
    const lines = [t('identities.publish.confirm.message', { hash })];
    lines.push(...filledUris.value);
    if (currentRegistry.value) {
      const diff = diffRegistries(currentRegistry.value, candidateSummary);
      for (const change of diff.changed) {
        lines.push(t('identities.publish.confirm.changed', {
          field: t(`identities.publish.fields.${change.field}`),
          from: change.from || t('identities.publish.confirm.empty'),
          to: change.to || t('identities.publish.confirm.empty'),
        }));
      }
      if (diff.droppedSnapshots.length) {
        lines.push(t('identities.publish.confirm.droppedSnapshots', diff.droppedSnapshots.length));
      }
    }
    return lines.join('\n');
  }

  async function publishUpdate() {
    const authUtxo = props.identity.authUtxo;
    if (!authUtxo) return;
    await runAction('publish', async () => {
      if (!filledUris.value.length) throw new Error(t('identities.publish.errors.noUris'));
      if (publicationBytesLeft.value < 0) throw new Error(t('identities.publish.errors.tooLarge'));
      const candidate = await fetchCandidateRegistry(filledUris.value, settingsStore.ipfsGateway);
      const candidateSummary = summarizeRegistry(candidate.content, props.identity.category);
      if (!candidateSummary) throw new Error(t('identities.publish.errors.noIdentity'));

      const confirmed = await confirmDialog(
        t('identities.publish.confirm.title'),
        publishConfirmMessage(candidateSummary, candidate.hash),
        t('identities.publish.confirm.button')
      );
      if (!confirmed) return;

      notifySending();
      const { txId } = await store.spend.spendAuthUtxo(authUtxo, [
        identityOutput(authUtxo, walletAddresses()),
        publicationOutput(candidate.hash, filledUris.value),
      ]);
      return { txId, message: t('identities.publish.done'), title: t('identities.publish.doneTitle') };
    });
  }

  async function issueFromReserve() {
    const authUtxo = props.identity.authUtxo;
    if (!authUtxo?.token) return;
    await runAction('issue', async () => {
      const decimals = tokenDecimals.value;
      const amount = parseTokenAmountToBigInt(issueAmount.value, decimals);
      if (amount <= 0n) throw new Error(t('identities.reserve.errors.invalidAmount'));
      if (amount > reserve.value) throw new Error(t('identities.reserve.errors.overReserve'));
      const address = validateTokenRecipientAddress(issueDestination.value, store.wallet.networkPrefix);
      const confirmed = await confirmDialog(
        t('identities.reserve.issue.confirmTitle'),
        t('identities.reserve.issue.confirmMessage', { amount: formatTokenAmountFromBigInt(amount, decimals), address }),
        t('identities.reserve.issue.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      // issuing the whole reserve leaves nothing for a token output to carry, which the identity
      // output turns into the emptied layout on its own
      const { txId } = await store.spend.spendAuthUtxo(authUtxo, [
        identityOutput(authUtxo, walletAddresses(), reserve.value - amount),
        new TokenSendRequest({ cashaddr: address, category: props.identity.category, amount }),
      ]);
      return { txId, message: t('identities.reserve.issue.done', { address }), title: t('identities.reserve.issue.doneTitle') };
    });
  }

  async function addToReserve() {
    const authUtxo = props.identity.authUtxo;
    if (!authUtxo?.token) return;
    await runAction('addToReserve', async () => {
      const decimals = tokenDecimals.value;
      const amount = parseTokenAmountToBigInt(addToReserveAmount.value, decimals);
      if (amount <= 0n) throw new Error(t('identities.reserve.errors.invalidAmount'));
      // fungible coins only: one carrying an NFT beside its amount is not what the reserve takes in
      const categoryUtxos = (store.spendableUtxos ?? []).filter(
        utxo => utxo.token?.category === props.identity.category && utxo.token.amount && !utxo.token.nft
      );
      const available = categoryUtxos.reduce((total, utxo) => total + (utxo.token?.amount ?? 0n), 0n);
      if (amount > available) throw new Error(t('identities.reserve.errors.overBalance'));
      const confirmed = await confirmDialog(
        t('identities.reserve.add.confirmTitle'),
        t('identities.reserve.add.confirmMessage', { amount: formatTokenAmountFromBigInt(amount, decimals) }),
        t('identities.reserve.add.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      const { txId } = await store.spend.spendAuthUtxo(
        authUtxo,
        [identityOutput(authUtxo, walletAddresses(), reserve.value + amount)],
        categoryUtxos,
      );
      return { txId, message: t('identities.reserve.add.done'), title: t('identities.reserve.add.doneTitle') };
    });
  }

  // The authchain continues at output 0 of the destination. A BCH-only authhead goes as one UTXO
  // (recipient gets it minus the fee); one carrying tokens needs a second output for what stays.
  async function transferIdentity() {
    const authUtxo = props.identity.authUtxo;
    if (!authUtxo) return;
    await runAction('transfer', async () => {
      const tokensGoAlong = Boolean(authUtxo.token) && transferTokensAlong.value;
      const address = tokensGoAlong
        ? validateTokenRecipientAddress(destination.value, store.wallet.networkPrefix)
        : validateRecipientAddress(destination.value, store.wallet.networkPrefix);
      const details = { amount: bchOf(authUtxo.satoshis), address, carries: carriesLine.value };
      let confirmMessage = t('identities.transfer.confirmMessage', details);
      if (authUtxo.token) {
        confirmMessage = tokensGoAlong
          ? t('identities.transfer.confirmMessageAlong', details)
          : t('identities.transfer.confirmMessageKeep', details);
      }
      const confirmed = await confirmDialog(
        t('identities.transfer.confirmTitle'), confirmMessage, t('identities.transfer.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      const { txId } = authUtxo.token
        ? await store.spend.spendAuthUtxo(authUtxo, transferOutputs(authUtxo, address, walletAddresses(), tokensGoAlong))
        : await store.spend.sendUtxo(authUtxo, address);
      // A transfer to one of this wallet's own addresses is a key rotation: the identity stays
      // listed and its new UTXO held back. To anyone else, it is now theirs to update. Decided by
      // the destination rather than by the wallet's view, which can trail its own broadcast.
      if (txId !== undefined && store.ownsAddress(address)) {
        await identitiesStore.listCreatedIdentity(props.identity.category, txId);
      } else {
        await identitiesStore.removeIdentity(props.identity.category, 'transferred');
      }
      return { txId, message: t('identities.transfer.done', { address }), title: t('identities.transfer.doneTitle') };
    });
  }

  // The key is an ordinary NFT and moves as one; what makes this different is what goes with it.
  // It is spent through the deliberate path because it is reserved, exactly as an authhead is.
  async function transferKey() {
    const keyUtxo = props.identity.keyUtxo;
    const key = keyUtxo?.token;
    const nft = key?.nft;
    if (!keyUtxo || !key || !nft) return;
    await runAction('transferKey', async () => {
      const address = validateTokenRecipientAddress(keyDestination.value, store.wallet.networkPrefix);
      const guardedByKey = (identitiesStore.identities ?? []).filter(
        listed => listed.keyUtxo && outpointOf(listed.keyUtxo) === outpointOf(keyUtxo)
      );
      const confirmed = await confirmDialog(
        t('identities.key.confirmTitle'),
        t('identities.key.confirmMessage', { count: guardedByKey.length, address }),
        t('identities.key.confirmButton'),
        'red'
      );
      if (!confirmed) return;
      notifySending();
      const { txId } = await store.spend.spendAuthUtxo(keyUtxo, [
        new TokenSendRequest({
          cashaddr: address,
          category: key.category,
          amount: 0n,
          nft: { commitment: nft.commitment, capability: nft.capability },
        }),
      ]);
      return { txId, message: t('identities.key.done', { address }), title: t('identities.key.doneTitle') };
    });
  }

  async function removeIdentity() {
    await runAction('remove', async () => {
      const confirmed = await confirmDialog(
        t('identities.remove.title'),
        props.identity.status === 'held' ? t('identities.remove.messageHeld') : t('identities.remove.message'),
        t('identities.remove.button')
      );
      if (confirmed) await identitiesStore.removeIdentity(props.identity.category);
    });
  }

  // The history is a view among the card's actions, opened and closed the way the token item's
  // info panel is: it is the one identity query that grows with the chain's length, so it is
  // fetched when asked for, not when the card opens. Closing the card closes it.
  const historyOpen = ref(false);
  const loadingHistory = ref(false);
  watch(() => props.expanded, expanded => {
    if (!expanded) historyOpen.value = false;
  });
  // The chain as fetched at this authhead; nothing to show until it is resolved
  const history = computed(() => {
    const authhead = props.identity.authheadTxid;
    return authhead ? identitiesStore.identityHistories[authhead] : undefined;
  });
  // the label carries the chain's length when the resolve already holds it
  const historyLabel = computed(() => {
    const length = props.identity.chainLength;
    return length ? t('identities.history.actionCount', { count: length }) : t('identities.history.action');
  });
  // How long an identity has stood, once its history says
  const establishedYear = computed(() => {
    const since = history.value?.[0]?.timestamp;
    return since ? new Date(since * 1000).getFullYear() : undefined;
  });
  async function toggleHistory() {
    historyOpen.value = !historyOpen.value;
    if (!historyOpen.value || history.value) return;
    loadingHistory.value = true;
    try {
      await identitiesStore.fetchIdentityHistory(props.identity);
    } catch (error) {
      displayAndLogError(error);
    } finally {
      loadingHistory.value = false;
    }
  }
  // Told by the wallet's own history: the links made here, and the ones made elsewhere with the
  // same keys, which is the half an explorer cannot show
  function madeByThisWallet(hash: string) {
    return (store.walletHistory ?? []).some(transaction => transaction.hash === hash);
  }
  function linkAmount(amount: bigint) {
    const size = amount < 0n ? -amount : amount;
    return formatTokenAmountFromBigInt(size, tokenDecimals.value);
  }
  function linkDate(timestamp?: number) {
    if (!timestamp) return undefined;
    return new Date(timestamp * 1000).toLocaleDateString();
  }
</script>

<template>
  <div class="section identity-card">
    <!-- The header opens and closes the card. Both halves are used: what it is on the left,
         which one it is on the right, where the category was an unused corner. -->
    <div class="identity-header" @click="emit('toggle')">
      <TokenIcon :token-id="identity.category" :icon-url="identityIconUrl" :size="40" />
      <!-- name over identifier, the shape the token list uses for the same pair -->
      <div class="identity-title">
        <div>{{ identityName ?? t('identities.unnamedIdentity') }}</div>
        <div class="copy-target" :title="identity.category" @click.stop="copyToClipboard(identity.category)">
          <span class="description">{{ t('identities.authbaseLabel') }}</span>
          <span class="mono">{{ truncateHash(identity.category) }}</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
      </div>
      <!-- asking what a status means is not asking to open the card -->
      <span class="identity-state" @click.stop>
        <InfoPopup>
          <template #trigger>
            <span class="identity-status info-popup-text-trigger" :class="identity.status">
              <q-icon v-if="identity.authUtxo" name="lock" size="15px" />
              {{ t('identities.status.' + identity.status) }}
            </span>
          </template>
          <div style="max-width: 300px;">{{ t('identities.statusHelp.' + identity.status) }}</div>
          <div v-if="identity.unresolvedReason" class="info-popup-note" style="max-width: 300px;">
            {{ identity.unresolvedReason }} {{ t('identities.unresolvedHint') }}
          </div>
        </InfoPopup>
      </span>
      <q-icon name="expand_more" class="chevron" :class="{ open: expanded }" />
    </div>

    <!-- States stay visible on a closed card; only the details and the actions fold away -->
    <div v-if="foundAutomatically" class="info-box" style="margin-top: 8px;">
      <img class="warning-box-icon" :src="settingsStore.darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg'" width="20" height="20">
      <div>
        {{ t('identities.detected.foundAutomatically') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.detected.foundAutomaticallyHelp') }}</div>
        </InfoPopup>
      </div>
    </div>
    <div v-if="carriesLine">
      {{ carriesLine }}
      <!-- minting lives in the token list, behind its own gate; this points there, narrowed to this token -->
      <span
        v-if="identity.authUtxo?.token?.nft?.capability === 'minting'"
        class="action-link"
        @click.stop="openInTokenList()"
      >{{ t('identities.reserve.mintingNftLink') }}</span>
    </div>
    <div v-if="!expanded && identity.publication" class="publication-badge-row">
      <template v-for="row in publicationRows" :key="row.uri">
        <span v-if="row.status" class="publication-badge" :class="row.status">{{ row.statusText }}</span>
      </template>
    </div>

    <template v-if="expanded">
    <div v-if="genesisSupplyLine">{{ genesisSupplyLine }}</div>
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
    <div v-if="identityValue !== undefined">
      {{ t('identities.authheadAmount', { amount: bchOf(identityValue) }) }}
    </div>
    <!-- where the identity lives, for a watched one as much as a held one: somebody's wallet,
         a covenant, or a script with no address form -->
    <div v-if="location" class="copy-target" :title="location.text" @click="copyToClipboard(location.text)">
      <span class="description">
        {{ t(location.kind === 'script' ? 'identities.locationScriptLabel' : 'identities.locationLabel') }}
        <InfoPopup v-if="identity.guardedBy">
          <div style="max-width: 300px;">{{ t('identities.key.guardHelp') }}</div>
        </InfoPopup>
      </span>
      <span class="mono">{{ truncateHash(location.text) }}</span>
      <img class="copyIcon" src="images/copyGrey.svg">
    </div>

    <!-- The latest metadata publication of this identity, and what its locations serve now.
         Shown for a watched identity as much as a held one: reading it needs no custody. -->
    <div class="section">
      <!-- the title names the thing, the date says which one -->
      <div>
        {{ t('identities.publication.title') }}
        <span v-if="identity.publication" class="description" :title="publicationTimeAgo">· {{ publicationDate }}</span>
      </div>
      <div v-if="!identity.publication" class="info-box" style="margin-top: 6px;">
        <img class="warning-box-icon" :src="settingsStore.darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg'" width="20" height="20">
        <!-- the action is in the bar right under it, so the box only states the fact -->
        <div>{{ t('identities.publication.none') }}</div>
      </div>
      <template v-else>
        <div v-for="row in publicationRows" :key="row.uri" class="publication-uri">
          <a :href="row.url" target="_blank" class="mono">{{ row.uri }}</a>
          <InfoPopup v-if="row.status">
            <template #trigger>
              <span class="publication-badge" :class="row.status">{{ row.statusText }}</span>
            </template>
            <div style="max-width: 300px;">{{ t('identities.publication.statusHelp.' + row.status) }}</div>
            <div v-if="row.status === 'changed'" class="info-popup-note" style="max-width: 300px;">
              {{ t('identities.publication.statusHelp.changedNote') }}
            </div>
          </InfoPopup>
          <span v-else-if="identitiesStore.publicationChecksRunning" class="description">{{ t('identities.publication.checking') }}</span>
        </div>
        <div class="copy-target" :title="identity.publication.hash" @click="copyToClipboard(identity.publication.hash)">
          <span class="mono">
            {{ t('identities.publication.hash', { hash: truncateHash(identity.publication.hash) }) }}
          </span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
        <div v-if="hasDrifted" class="description" style="margin-top: 6px;">
          <i18n-t keypath="identities.publication.driftedPrompt" tag="span">
            <template #link>
              <span class="action-link" @click="toggleAction('publish')">{{ t('identities.publication.driftedLink') }}</span>
            </template>
          </i18n-t>
        </div>
      </template>
    </div>

    <!-- The operations, all of them the same spend of the authhead, so they share one row of
         actions and open one form at a time, the way a token item's actions do -->
    <div class="actionBar identity-action-row">
      <template v-if="identity.authUtxo">
        <span @click="toggleAction('publish')" style="white-space: nowrap;">
          <img class="icon" :src="settingsStore.darkMode? 'images/publishLightGrey.svg' : 'images/publish.svg'">
          {{ t('identities.publish.action') }}
        </span>
        <!-- a reserve is a fungible category's thing: its genesis decides that, not what the
             wallet holds today, so an NFT-only identity never shows this -->
        <span v-if="identity.fungibleSupply && reserve > 0n" @click="toggleAction('issue')" style="white-space: nowrap;">
          <img class="icon" :src="settingsStore.darkMode? 'images/minus-square-lightGrey.svg' : 'images/minus-square.svg'">
          {{ t('identities.reserve.issue.action') }}
        </span>
        <span @click="toggleAction('transfer')" style="white-space: nowrap;">
          <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'">
          {{ t('identities.transfer.action') }}
        </span>
      </template>
      <!-- a view among the actions, the way the token item's "info" sits beside its actions -->
      <span @click="toggleHistory()" style="white-space: nowrap;">
        <q-icon name="history" size="18px" />
        {{ historyLabel }}
      </span>
      <q-icon name="more_vert" size="22px" class="identity-menu-trigger">
        <q-menu anchor="bottom right" self="top right">
          <q-list dense>
            <!-- the reverse of issuing, done rarely: the bar holds the four things a creator does,
                 and the rest waits here -->
            <q-item
              v-if="identity.authUtxo && identity.fungibleSupply"
              clickable
              v-close-popup
              @click="toggleAction('addToReserve')"
            >
              <q-item-section avatar><q-icon name="add_circle" size="18px" /></q-item-section>
              <q-item-section>{{ t('identities.reserve.add.action') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup :href="`https://tokenexplorer.cash/?tokenId=${identity.category}`" target="_blank">
              <q-item-section avatar><q-icon name="open_in_new" size="18px" /></q-item-section>
              <q-item-section>{{ t('tokenItem.info.seeDetailsOnExplorer') }}</q-item-section>
            </q-item>
            <!-- a followed identity is not listed, and one held through a key comes back from
                 the key on the next resolve: the key is transferred instead -->
            <q-item
              v-if="groupKey !== 'tokens' && identity.status !== 'heldViaKey'"
              clickable
              v-close-popup
              @click="removeIdentity()"
            >
              <q-item-section avatar><q-icon name="delete" size="18px" /></q-item-section>
              <q-item-section>{{ t('identities.remove.button') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-icon>
    </div>

    <div v-if="isOpen('publish')" class="section">
      <ol class="walkthrough">
        <li>
          <q-icon name="edit" size="18px" />
          <!-- the generator writes a token section, which an identity that is not a token
               must not have, so that one is sent to the schema instead -->
          <i18n-t v-if="identity.isToken === false" keypath="identities.publish.steps.authorByHand" tag="span">
            <template #schema>
              <a :href="BCMR_SCHEMA_URL" target="_blank">{{ t('identities.publish.generatorHelpSchema') }}</a>
            </template>
          </i18n-t>
          <template v-else>
            <i18n-t keypath="identities.publish.steps.author" tag="span">
              <template #generator>
                <a :href="BCMR_GENERATOR_URL" target="_blank">BCMR generator</a>
              </template>
            </i18n-t>
            <!-- the line names a tool and cannot say what it is -->
            <InfoPopup>
              <div style="max-width: 300px;">
                <i18n-t keypath="identities.publish.generatorHelp" tag="span">
                  <template #schema>
                    <a :href="BCMR_SCHEMA_URL" target="_blank">{{ t('identities.publish.generatorHelpSchema') }}</a>
                  </template>
                </i18n-t>
              </div>
            </InfoPopup>
          </template>
        </li>
        <li>
          <q-icon name="archive" size="18px" />
          <span>{{ t('identities.publish.steps.host') }}</span>
        </li>
        <li>
          <q-icon name="send" size="18px" />
          <span>{{ t('identities.publish.steps.publish') }}</span>
        </li>
      </ol>
      <div class="description" style="margin-top: 4px;">{{ t('identities.publish.locationsHint') }}</div>
      <publicationLocations v-model="publishUris" />
      <input
        @click="publishUpdate()"
        type="button"
        class="primaryButton"
        :value="runningAction === 'publish' ? t('identities.publish.publishingButton') : t('identities.publish.button')"
        :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !filledUris.length || publicationBytesLeft < 0"
        style="margin-top: 10px;"
      >
    </div>

    <div v-if="isOpen('issue')" class="section">
      <div class="description">{{ t('identities.reserve.issue.hint', { amount: reserveDisplay }) }}</div>
      <div class="issue-amount">
        <input v-model="issueAmount" :placeholder="t('identities.reserve.issue.amountPlaceholder')">
        <button @click="issueAmount = reserveDisplay">{{ t('tokenItem.actions.max') }}</button>
      </div>
      <div class="input-with-button">
        <input v-model="issueDestination" :placeholder="t('identities.reserve.issue.destinationPlaceholder')">
      </div>
      <input
        @click="issueFromReserve()"
        type="button"
        class="primaryButton"
        :value="runningAction === 'issue' ? t('identities.reserve.issue.issuingButton') : t('identities.reserve.issue.button')"
        :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !issueAmount || !issueDestination"
        style="margin-top: 10px;"
      >
    </div>

    <div v-if="isOpen('addToReserve')" class="section">
      <div class="description">{{ t('identities.reserve.add.hint') }}</div>
      <div class="input-with-button">
        <input v-model="addToReserveAmount" :placeholder="t('identities.reserve.add.amountPlaceholder')">
      </div>
      <input
        @click="addToReserve()"
        type="button"
        class="primaryButton"
        :value="runningAction === 'addToReserve' ? t('identities.reserve.add.addingButton') : t('identities.reserve.add.button')"
        :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !addToReserveAmount"
        style="margin-top: 10px;"
      >
    </div>

    <div v-if="isOpen('transfer')" class="section">
      <div class="description">{{ t('identities.transfer.hint') }}</div>
      <!-- what rides on the authhead is asked about rather than moved quietly -->
      <template v-if="identity.authUtxo?.token">
        <label :for="`carried-${identity.category}`" style="display: block; margin-top: 8px;">
          {{ t('identities.transfer.carriedLabel', { carries: carriesLine }) }}
        </label>
        <select :id="`carried-${identity.category}`" v-model="transferTokensAlong">
          <option :value="false">{{ t('identities.transfer.carriedStays') }}</option>
          <option :value="true">{{ t('identities.transfer.carriedGoes') }}</option>
        </select>
      </template>
      <div class="input-with-button">
        <input v-model="destination" :placeholder="t('identities.transfer.destinationPlaceholder')">
        <input
          @click="transferIdentity()"
          type="button"
          :value="runningAction === 'transfer' ? t('identities.transfer.transferringButton') : t('identities.transfer.button')"
          :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !destination"
        >
      </div>
    </div>

    <div v-if="identity.status === 'heldViaKey'" class="section">
      <div class="description">{{ t('identities.key.manageHint') }}</div>
      <div class="identity-actions">
        <a :href="CASHTOKENS_STUDIO_URL[store.network]" target="_blank" class="action-link">
          {{ t('identities.key.manageOnStudio') }}
        </a>
        <span class="action-link" @click="toggleAction('transferKey')">
          {{ t('identities.key.action') }}
        </span>
      </div>
      <div v-if="isOpen('transferKey')" style="margin-top: 10px;">
        <div class="description">{{ t('identities.key.hint') }}</div>
        <div class="input-with-button">
          <input v-model="keyDestination" :placeholder="t('identities.key.destinationPlaceholder')">
          <input
            @click="transferKey()"
            type="button"
            :value="runningAction === 'transferKey' ? t('identities.key.transferringButton') : t('identities.key.button')"
            :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !keyDestination"
          >
        </div>
      </div>
    </div>

    <div v-if="historyOpen" class="section">
      <!-- the year comes from the history, so it lands here with the history rather than
           growing the header after the card was drawn -->
      <div>
        {{ t('identities.history.title') }}
        <span v-if="establishedYear" class="description">
          · {{ t('identities.established.since', { year: establishedYear }) }}
        </span>
      </div>
      <div v-if="loadingHistory" class="description">{{ t('identities.history.loading') }}</div>
      <div v-for="link in history ?? []" :key="link.hash" class="chain-link">
        <span v-if="link.kind === 'mint'">{{ t('identities.history.minted', link.minted ?? 0) }}</span>
        <span v-else>{{ t('identities.history.kind.' + link.kind) }}</span>
        <span v-if="link.reserveDelta">
          {{ link.reserveDelta > 0n
            ? t('identities.history.reserveUp', { amount: linkAmount(link.reserveDelta) })
            : t('identities.history.reserveDown', { amount: linkAmount(link.reserveDelta) }) }}
        </span>
        <span v-if="linkDate(link.timestamp)">{{ linkDate(link.timestamp) }}</span>
        <span v-if="madeByThisWallet(link.hash)" class="identity-badge">{{ t('identities.history.madeHere') }}</span>
        <a :href="`${store.explorerUrl}/${link.hash}`" target="_blank" class="mono">{{ link.hash.slice(0, 10) }}</a>
      </div>
    </div>
    </template>
  </div>
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
.identity-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  cursor: pointer;
}
.identity-title {
  min-width: 0;
}
.identity-state {
  margin-left: auto;
  flex: none;
}
.chevron {
  flex: none;
  transition: transform 0.2s;
}
.chevron.open {
  transform: rotate(180deg);
}
.identity-status {
  color: grey;
}
.identity-status.held,
.identity-status.heldViaKey {
  color: var(--font-color);
}
.identity-status.notHeld,
.identity-status.burned {
  color: grey;
}
.identity-status.unresolved {
  color: orange;
}
.publication-badge-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.publication-uri {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.publication-badge {
  font-size: 0.85em;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid currentColor;
}
.publication-badge.verified {
  color: var(--color-primary);
}
.publication-badge.changed {
  color: orange;
}
.publication-badge.unreachable {
  color: var(--color-error);
}
.identity-action-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 0;
}
.actionBar .icon {
  width: 18px;
  height: 18px;
}
.identity-menu-trigger {
  cursor: pointer;
  margin-left: auto;
}
.issue-amount {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.issue-amount input {
  flex: 1 1 auto;
  margin: 0;
}
.identity-actions {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.walkthrough {
  color: grey;
}
.walkthrough li .q-icon {
  flex: none;
  align-self: center;
}
.chain-link {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
</style>
