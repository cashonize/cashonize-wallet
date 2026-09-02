<script setup lang="ts">
  import { computed, onActivated, ref, watch } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import {
    copyToClipboard,
    formatBch,
    truncateHash,
    formatTokenAmountFromBigInt,
    parseTokenAmountToBigInt,
  } from 'src/utils/utils'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { confirmDialog, notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'
  import { validateRecipientAddress, validateTokenRecipientAddress } from 'src/utils/payments/recipientAddress'
  import {
    diffRegistries,
    fetchCandidateRegistry,
    fetchPublishedRegistry,
    identityOutput,
    transferOutputs,
    maxPublicationOutputSize,
    publicationOutput,
    publicationOutputSize,
    registryUrlOf,
    summarizeRegistry,
    type IdentityState,
    type IdentityScanSummary,
    type PublicationUriStatus,
    type RegistrySummary,
  } from 'src/utils/tools/authchainIdentity'
  import { TokenSendRequest } from 'mainnet-js'
  import { outpointOf } from 'src/utils/wallet/reservedUtxos'

  const store = useStore()

  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // Two things happen on this page: looking after the identities that are here, and getting one
  // onto it. Only the first is why anyone opens it, so the acquisition paths wait behind a pill.
  const mode = ref<'identities' | 'existing' | 'create'>('identities');

  const categoryInput = ref("");
  // What the wallet listed on its own and the user has not seen. Taken on opening the page and
  // cleared there, so the cards carry the mark for the visit that answers for it.
  const foundAutomatically = ref<string[]>([]);
  const scanSummary = ref<IdentityScanSummary | undefined>(undefined);
  const destination = ref("");
  const keyDestination = ref("");
  // A card shows what it is when closed and what can be done with it when open, one at a time:
  // the details and every operation standing open on every card was the page's real weight.
  const expandedIdentity = ref<string | undefined>(undefined);
  const isExpanded = (identity: IdentityState) => expandedIdentity.value === identity.category;

  function toggleCard(identity: IdentityState) {
    const category = identity.category;
    const opening = expandedIdentity.value !== category;
    expandedIdentity.value = opening ? category : undefined;
    // opening one card is interest in one identity, which is when its chain is worth a query: the
    // page load stays free of them, and the age and length fill in without a second click
    if (opening) void loadHistory(identity);
  }

  // Which card's history is being fetched
  const loadingHistory = ref<string | undefined>(undefined);

  // One form open at a time across the whole list, and one operation in flight: these are
  // deliberate, one-at-a-time operations, and a card with four open forms says otherwise
  type IdentityAction =
    'add' | 'create' | 'scan' | 'remove' | 'publish' | 'issue' | 'addToReserve' | 'transfer' | 'transferKey';
  const openAction = ref<{ category: string, action: IdentityAction } | undefined>(undefined);
  const runningAction = ref<IdentityAction | undefined>(undefined);

  // Every operation on this page runs in one frame: the form closed and the broadcast reported when
  // a spend went through, an error shown rather than thrown. Each handler keeps its own validation,
  // confirmation and outputs, and returns nothing when the user declined.
  interface Outcome { txId: string | undefined; message: string; title: string }
  async function runAction(action: IdentityAction, operate: () => Promise<Outcome | void>) {
    if (runningAction.value) return;
    runningAction.value = action;
    try {
      const outcome = await operate();
      if (!outcome) return;
      openAction.value = undefined;
      await handleTransactionBroadcastSuccess(outcome.message, outcome.txId, outcome.title);
    } catch (error) {
      displayAndLogError(error);
    } finally {
      runningAction.value = undefined;
    }
  }
  const publishUris = ref<string[]>([]);
  const currentRegistry = ref<RegistrySummary | undefined>(undefined);
  const issueAmount = ref("");
  const issueDestination = ref("");
  const addToReserveAmount = ref("");
  // whether a transfer takes the reserve and minting NFT with it; staying is the default
  const transferTokensAlong = ref(false);

  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);

  const identities = computed(() => identitiesStore.identities ?? []);

  // How long an identity has stood, once its history says
  function establishedYear(identity: IdentityState): number | undefined {
    const since = identitiesStore.identityHistories[identity.category]?.[0]?.timestamp;
    return since ? new Date(since * 1000).getFullYear() : undefined;
  }

  // What the identity output carries, in one line for a closed card
  function carriesLine(identity: IdentityState): string | undefined {
    return reserveDescription(identity)?.join(' · ');
  }
  // A watched identity counts here too: the wallet follows its publication either way, and only
  // the actions depend on holding the authhead
  const listedCount = computed(() =>
    identities.value.filter(identity => identity.status !== 'unresolved').length
  );

  // Owned and watched are different things, so the summary counts them apart rather than calling
  // somebody else's identity one of this wallet's
  const ownedCount = computed(() =>
    identities.value.filter(identity => identity.authUtxo || identity.keyUtxo).length
  );
  const watchedCount = computed(() => listedCount.value - ownedCount.value);

  // Two kinds of card with no name to show: authheads held back with nothing on the UTXO to say
  // which identity they are, and the guarded identities a watched key covers that this version
  // cannot name, since that needs a lookup back from an output to the authchain it ends. The
  // latter are counted rather than dropped, so a key guarding only them is not reported as
  // guarding nothing.
  interface MiniCard {
    id: string; shortId: string; title: string; label: string;
    help?: string; status?: string; note?: string; amount?: string; txid?: string;
  }
  const miniCards = computed<MiniCard[]>(() => [
    ...identitiesStore.unnamedAuthheadCoins.map(coin => ({
      id: `${coin.txid}:0`,
      shortId: `${truncateHash(coin.txid)}:0`,
      title: t('identities.unnamed.title'),
      help: t('identities.unnamed.help'),
      status: t('identities.unnamed.status'),
      label: t('identities.authheadLabel'),
      amount: bchOf(coin.satoshis),
      txid: coin.txid,
    })),
    ...Object.entries(identitiesStore.unidentifiedGuarded)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({
        id: category,
        shortId: truncateHash(category),
        title: t('identities.key.unnameableTitle'),
        note: t('identities.key.unnameable', count),
        label: t('identities.key.categoryLabel'),
      })),
  ]);

  // An IPFS CID cannot serve content other than its own, so a mismatch there says something
  // different from an edited file at an HTTPS location
  function uriStatusText(uri: string, status: PublicationUriStatus) {
    if (status !== 'changed') return t(`identities.publication.status.${status}`);
    return uri.startsWith('ipfs://')
      ? t('identities.publication.status.changedIpfs')
      : t('identities.publication.status.changed');
  }

  // A location serving something other than what was published is not just a warning on an
  // identity this wallet can act on: it is the state the publish flow exists to resolve
  function hasDrifted(identity: IdentityState) {
    if (!identity.authUtxo) return false;
    return (identitiesStore.publicationChecks[identity.category] ?? []).some(status => status === 'changed');
  }

  // One row per published location: the location as published, where it is actually fetched from,
  // and what fetching it found once the check has run. Built once per identity: a closed card
  // shows the badges and an open one the rows.
  const publicationRows = computed(() => Object.fromEntries(identities.value.map(identity => {
    const statuses = identitiesStore.publicationChecks[identity.category];
    const rows = (identity.publication?.uris ?? []).map((uri, index) => {
      const status = statuses?.[index];
      return {
        uri,
        url: registryUrlOf(uri, settingsStore.ipfsGateway),
        status,
        statusText: status ? uriStatusText(uri, status) : undefined,
      };
    });
    return [identity.category, rows];
  })));

  const identityName = (category: string) => store.bcmrRegistries?.[category]?.name;

  // What an authhead carries alongside the authority to update the metadata: a token supply held
  // back from circulation, an NFT that mints the category's tokens, or both at once. Managing any
  // of it is not here yet, so the card only says what is there.
  function reserveDescription(identity: IdentityState) {
    const token = (identity.authUtxo ?? identity.guardedOutput)?.token;
    if (!token) return undefined;
    const metadata = store.bcmrRegistries?.[identity.category];
    const lines: string[] = [];
    if (token.amount) {
      const amount = formatTokenAmountFromBigInt(token.amount, metadata?.token?.decimals ?? 0);
      lines.push(t('identities.reserve.supply', {
        amount: `${amount} ${metadata?.token?.symbol ?? ''}`.trim(),
      }));
    }
    if (token.nft?.capability === 'minting') lines.push(t('identities.reserve.mintingNft'));
    else if (token.nft) lines.push(t('identities.reserve.nft'));
    return lines;
  }
  const identityIconUrl = (category: string) => {
    if (settingsStore.disableTokenIcons) return undefined;
    return store.tokenIconUrl(category);
  };

  // The metadata of a manually added identity is not in the registries yet: the wallet holds its
  // authhead rather than its token, so nothing else fetched it
  async function fetchMissingMetadata() {
    await identitiesStore.fetchMetadataFor(identities.value.map(identity => identity.category));
  }

  // Re-resolving on every visit is the point of the page: the authhead moves whenever the identity's
  // metadata is updated elsewhere, and the reservations are rewritten from what comes back
  async function reloadIdentities() {
    await identitiesStore.refreshIdentities();
    await fetchMissingMetadata();
    // after the resolving, which is what says where each publication is
    await identitiesStore.checkPublications();
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
    scanSummary.value = undefined;
  });

  async function addIdentity() {
    await runAction('add', async () => {
      const category = categoryInput.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(category)) throw new Error(t('identities.errors.invalidCategory'));
      if (identitiesStore.identityCategories.includes(category)) throw new Error(t('identities.errors.alreadyListed'));
      // A token category and an AuthKey category look alike, so both readings are tried and what
      // was found is put to the user rather than asked about beforehand.
      const found = await identitiesStore.inspectCategory(category);
      const guardedCount = found.guardedCategories.length + found.unidentifiedGuarded;
      if (!found.isTokenIdentity && !guardedCount) throw new Error(t('identities.add.errors.nothingFound'));
      const summary = [];
      if (found.isTokenIdentity) summary.push(t('identities.add.found.identity'));
      if (guardedCount) summary.push(t('identities.add.found.key', guardedCount));
      const confirmed = await confirmDialog(
        t('identities.add.found.title'),
        summary.join('\n'),
        t('identities.add.found.button')
      );
      if (!confirmed) return;
      if (guardedCount) await identitiesStore.addAuthKey(category);
      if (found.isTokenIdentity) await identitiesStore.addIdentity(category);
      await fetchMissingMetadata();
      categoryInput.value = "";
    });
  }

  // What the new identity's AuthHead carries. Every later operation recreates the output with the
  // same amount, so this is set once and stays.
  const newIdentityValue = 10_000n;

  // An identity that is not a token is one transaction: its output 0 is the identity, and its txid
  // is the id, which is why naming has to wait for a publication that can name it.
  async function createIdentity() {
    await runAction('create', async () => {
      const confirmed = await confirmDialog(
        t('identities.create.confirmTitle'),
        t('identities.create.confirmMessage', { amount: bchOf(newIdentityValue) }),
        t('identities.create.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      const { txId } = await store.spend.send([
        { cashaddr: store.wallet.getDepositAddress(), value: newIdentityValue }
      ]);
      if (!txId) throw new Error(t('identities.create.errors.noTxId'));
      await identitiesStore.listCreatedIdentity(txId, txId);
      return { txId, message: t('identities.create.done'), title: t('identities.create.doneTitle') };
    });
  }

  // Checking costs a Chaingraph query per held category, so it only ever runs on the user's word
  async function scanForIdentities() {
    await runAction('scan', async () => {
      scanSummary.value = undefined;
      scanSummary.value = await identitiesStore.scanForIdentities();
      await fetchMissingMetadata();
    });
  }

  // The summary as lines, only the counts that are not zero
  const scanSummaryLines = computed(() => {
    const summary = scanSummary.value;
    if (!summary) return [];
    const lines = [summary.found ? t('identities.scan.found', summary.found) : t('identities.scan.noneFound')];
    const counted = ['alreadyListed', 'carriesTokens', 'mintingNfts', 'dismissed', 'failed'] as const;
    for (const key of counted) {
      if (summary[key]) lines.push(t(`identities.scan.${key}`, summary[key]));
    }
    return lines;
  });

  function isOpen(identity: IdentityState, action: IdentityAction) {
    if (openAction.value?.category !== identity.category) return false;
    return openAction.value.action === action;
  }

  async function toggleAction(identity: IdentityState, action: IdentityAction) {
    if (isOpen(identity, action)) {
      openAction.value = undefined;
      return;
    }
    openAction.value = { category: identity.category, action };
    // the common update changes what the locations serve, not the locations themselves
    publishUris.value = identity.publication?.uris.length ? [...identity.publication.uris] : [""];
    issueAmount.value = "";
    issueDestination.value = "";
    addToReserveAmount.value = "";
    destination.value = "";
    keyDestination.value = "";
    transferTokensAlong.value = false;
    currentRegistry.value = undefined;
    if (action !== 'publish' || !identity.publication) return;
    // read what is published now, so the update can say what it changes
    const published = await fetchPublishedRegistry(identity.publication.uris, settingsStore.ipfsGateway);
    if (!published || !isOpen(identity, 'publish')) return;
    currentRegistry.value = summarizeRegistry(published, identity.category);
  }

  const tokenDecimals = (category: string) => store.bcmrRegistries?.[category]?.token?.decimals ?? 0;
  function reserveOf(identity: IdentityState) {
    const identityOutput = identity.authUtxo ?? identity.guardedOutput;
    return identityOutput?.token?.amount ?? 0n;
  }

  function reserveDisplay(identity: IdentityState) {
    return formatTokenAmountFromBigInt(reserveOf(identity), tokenDecimals(identity.category));
  }

  const filledUris = computed(() => publishUris.value.map(uri => uri.trim()).filter(uri => uri.length));
  // The hash and the locations share one output, so the locations are capped by their own length
  const publicationBytesLeft = computed(() =>
    maxPublicationOutputSize - publicationOutputSize(filledUris.value)
  );

  function addUriRow() {
    publishUris.value = [...publishUris.value, ""];
  }
  function removeUriRow(index: number) {
    publishUris.value = publishUris.value.filter((_, rowIndex) => rowIndex !== index);
    if (!publishUris.value.length) publishUris.value = [""];
  }

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

  async function publishUpdate(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (!authUtxo) return;
    await runAction('publish', async () => {
      if (!filledUris.value.length) throw new Error(t('identities.publish.errors.noUris'));
      if (publicationBytesLeft.value < 0) throw new Error(t('identities.publish.errors.tooLarge'));
      const candidate = await fetchCandidateRegistry(filledUris.value, settingsStore.ipfsGateway);
      const candidateSummary = summarizeRegistry(candidate.content, identity.category);
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

  const walletAddresses = () => ({
    bch: store.wallet.getDepositAddress(),
    token: store.wallet.getTokenDepositAddress(),
  });

  async function issueFromReserve(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (!authUtxo?.token) return;
    await runAction('issue', async () => {
      const decimals = tokenDecimals(identity.category);
      const amount = parseTokenAmountToBigInt(issueAmount.value, decimals);
      if (amount <= 0n) throw new Error(t('identities.reserve.errors.invalidAmount'));
      if (amount > reserveOf(identity)) throw new Error(t('identities.reserve.errors.overReserve'));
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
        identityOutput(authUtxo, walletAddresses(), reserveOf(identity) - amount),
        new TokenSendRequest({ cashaddr: address, category: identity.category, amount }),
      ]);
      return { txId, message: t('identities.reserve.issue.done', { address }), title: t('identities.reserve.issue.doneTitle') };
    });
  }

  async function addToReserve(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (!authUtxo?.token) return;
    await runAction('addToReserve', async () => {
      const decimals = tokenDecimals(identity.category);
      const amount = parseTokenAmountToBigInt(addToReserveAmount.value, decimals);
      if (amount <= 0n) throw new Error(t('identities.reserve.errors.invalidAmount'));
      const categoryUtxos = (store.spendableUtxos ?? []).filter(
        utxo => utxo.token?.category === identity.category && utxo.token.amount
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
        [identityOutput(authUtxo, walletAddresses(), reserveOf(identity) + amount)],
        categoryUtxos,
      );
      return { txId, message: t('identities.reserve.add.done'), title: t('identities.reserve.add.doneTitle') };
    });
  }

  // The key is an ordinary NFT and moves as one; what makes this different is what goes with it.
  // It is spent through the deliberate path because it is reserved, exactly as an authhead is.
  async function transferKey(identity: IdentityState) {
    const keyUtxo = identity.keyUtxo;
    const key = keyUtxo?.token;
    const nft = key?.nft;
    if (!keyUtxo || !key || !nft) return;
    await runAction('transferKey', async () => {
      const address = validateTokenRecipientAddress(keyDestination.value, store.wallet.networkPrefix);
      const guardedByKey = identities.value.filter(
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

  // The chain is the identity's whole history. The explorer shows it raw; this says what each
  // step did, and which of them were made from this wallet.
  async function loadHistory(identity: IdentityState) {
    if (identitiesStore.identityHistories[identity.category]) return;
    loadingHistory.value = identity.category;
    try {
      await identitiesStore.fetchIdentityHistory(identity.category);
    } catch (error) {
      displayAndLogError(error);
    } finally {
      loadingHistory.value = undefined;
    }
  }

  // Told by the wallet's own history: the links made here, and the ones made elsewhere with the
  // same keys, which is the half an explorer cannot show
  function madeByThisWallet(hash: string) {
    return (store.walletHistory ?? []).some(transaction => transaction.hash === hash);
  }

  function linkAmount(identity: IdentityState, amount: bigint) {
    const size = amount < 0n ? -amount : amount;
    return formatTokenAmountFromBigInt(size, tokenDecimals(identity.category));
  }

  function linkDate(timestamp?: number) {
    if (!timestamp) return undefined;
    return new Date(timestamp * 1000).toLocaleDateString();
  }

  async function removeIdentity(identity: IdentityState) {
    await runAction('remove', async () => {
      const confirmed = await confirmDialog(
        t('identities.remove.title'),
        identity.status === 'held' ? t('identities.remove.messageHeld') : t('identities.remove.message'),
        t('identities.remove.button')
      );
      if (confirmed) await identitiesStore.removeIdentity(identity.category);
    });
  }

  // The authchain continues at output 0 of the destination. A BCH-only authhead goes as one UTXO
  // (recipient gets it minus the fee); one carrying tokens needs a second output for what stays.
  async function transferIdentity(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (!authUtxo) return;
    await runAction('transfer', async () => {
      const tokensGoAlong = Boolean(authUtxo.token) && transferTokensAlong.value;
      const address = tokensGoAlong
        ? validateTokenRecipientAddress(destination.value, store.wallet.networkPrefix)
        : validateRecipientAddress(destination.value, store.wallet.networkPrefix);
      const details = { amount: bchOf(authUtxo.satoshis), address, carries: carriesLine(identity) };
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
      // The identity is now somebody else's to update, so it leaves this wallet's list
      await identitiesStore.removeIdentity(identity.category);
      return { txId, message: t('identities.transfer.done', { address }), title: t('identities.transfer.doneTitle') };
    });
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

    <div class="type-filter" style="margin-top: 12px;">
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
        {{ t('identities.add.label') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.add.categoryHelpWhere') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('identities.add.categoryHelpKey') }}</div>
        </InfoPopup>
      </div>
      <div class="add-identity">
        <input v-model="categoryInput" :placeholder="t('identities.add.placeholder')" @keyup.enter="addIdentity()">
        <input
          @click="addIdentity()"
          type="button"
          :value="runningAction === 'add' ? t('identities.add.addingButton') : t('identities.add.button')"
          :disabled="runningAction !== undefined || identitiesStore.identitiesResolving || !categoryInput"
        >
      </div>
    </div>

    <div class="section">
      <div>
        {{ t('identities.scan.prompt') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.scan.automaticHelp') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('identities.scan.checkHelp') }}</div>
        </InfoPopup>
      </div>
      <input
        @click="scanForIdentities()"
        type="button"
        class="primaryButton"
        :value="runningAction === 'scan' ? t('identities.scan.scanning') : t('identities.scan.linkText')"
        :disabled="runningAction !== undefined || identitiesStore.identitiesResolving"
        style="margin-top: 8px;"
      >
      <div v-if="scanSummaryLines.length" style="margin-top: 6px;">
        <div v-for="line in scanSummaryLines" :key="line">{{ line }}</div>
      </div>
    </div>
    </template>

    <template v-if="mode === 'create'">
    <!-- The common path first: a token identity is made by the genesis that makes the token.
         What follows is the same primitive with no token on it, said as the rare thing it is -->
    <div class="section">
      <i18n-t keypath="identities.create.tokenPointer" tag="div">
        <template #link>
          <span class="action-link" @click="() => store.changeView(6)">{{ t('identities.create.tokenPointerLink') }}</span>
        </template>
      </i18n-t>
    </div>
    <div class="section">
      <div>
        {{ t('identities.create.label') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.create.help') }}</div>
          <div class="info-popup-note" style="max-width: 300px;">{{ t('identities.create.helpNaming') }}</div>
        </InfoPopup>
      </div>
      <div class="description" style="margin-top: 6px;">
        {{ t('identities.create.hint') }}
        <InfoPopup>
          <div style="max-width: 300px;">{{ t('identities.create.novelHelp') }}</div>
        </InfoPopup>
      </div>
      <input
        @click="createIdentity()"
        type="button"
        :value="runningAction === 'create' ? t('identities.create.creatingButton') : t('identities.create.button')"
        :disabled="runningAction !== undefined || identitiesStore.identitiesResolving"
        style="margin-top: 8px;"
      >
    </div>
    </template>

    <div v-if="mode === 'identities'" class="section">
      <!-- a pass the wallet ran on its own failed: an identity it should have held back may not
           be, which is worth stopping at, so it stays here until the next open rather than toasting -->
      <div v-if="identitiesStore.openCheckError" class="warning-box" style="margin-bottom: 10px;">
        <q-icon name="warning" size="20px" class="warning-box-icon" />
        <div>{{ t('identities.openCheckFailed', { reason: identitiesStore.openCheckError }) }}</div>
      </div>
      <div v-if="!identitiesStore.identities" class="description">{{ t('identities.resolving') }}</div>
      <div v-else-if="!identities.length" class="description">{{ t('identities.empty') }}</div>
      <!-- the answer to what is on this page, which is the first thing read here rather than
           something said alongside what is read -->
      <div v-else>
        {{ t('identities.ownedCount', ownedCount) }}<template v-if="watchedCount">{{ t('identities.watchedSuffix', watchedCount) }}</template>
      </div>

      <!-- Protected first, named if it can be -->
      <div v-for="card in miniCards" :key="card.id" class="section identity-card">
        <div>
          {{ card.title }}
          <InfoPopup v-if="card.help">
            <div style="max-width: 300px;">{{ card.help }}</div>
          </InfoPopup>
        </div>
        <div v-if="card.status" class="identity-status">
          <q-icon name="lock" size="15px" />
          {{ card.status }}
        </div>
        <div v-if="card.note" class="description">{{ card.note }}</div>
        <div class="copy-target" :title="card.id" @click="copyToClipboard(card.id)">
          <span class="description">{{ card.label }}</span>
          <span class="mono">{{ card.shortId }}</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>
        <div v-if="card.amount">{{ t('identities.authheadAmount', { amount: card.amount }) }}</div>
        <div v-if="card.txid" class="identity-links">
          <span class="remove-identity" @click="removeUnnamed(card.txid)">{{ t('identities.remove.button') }}</span>
        </div>
      </div>

      <div v-for="identity in identities" :key="identity.category" class="section identity-card">
        <!-- The header opens and closes the card. Both halves are used: what it is on the left,
             which one it is on the right, where the category was an unused corner. -->
        <div class="identity-header identity-header-row" @click="toggleCard(identity)">
          <TokenIcon
            :token-id="identity.category"
            :icon-url="identityIconUrl(identity.category)"
            :size="40"
          />
          <!-- name over identifier, the shape the token list uses for the same pair -->
          <div class="identity-title">
            <div>{{ identityName(identity.category) ?? t('identities.unnamedIdentity') }}</div>
            <div
              class="copy-target"
              :title="identity.category"
              @click.stop="copyToClipboard(identity.category)"
            >
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
          <q-icon name="expand_more" class="chevron" :class="{ open: isExpanded(identity) }" />
        </div>

        <!-- States stay visible on a closed card; only the details and the actions fold away -->
        <div v-if="foundAutomatically.includes(identity.category)" class="info-box" style="margin-top: 8px;">
          <q-icon name="info" size="20px" class="warning-box-icon" />
          <div>
            {{ t('identities.detected.foundAutomatically') }}
            <InfoPopup>
              <div style="max-width: 300px;">{{ t('identities.detected.foundAutomaticallyHelp') }}</div>
            </InfoPopup>
          </div>
        </div>
        <div v-if="carriesLine(identity)">
          {{ carriesLine(identity) }}
          <!-- minting lives in the token list, behind its own gate; this only points there -->
          <span
            v-if="identity.authUtxo?.token?.nft?.capability === 'minting'"
            class="action-link"
            @click.stop="store.changeView(2)"
          >{{ t('identities.reserve.mintingNftLink') }}</span>
        </div>
        <div v-if="!isExpanded(identity) && identity.publication" class="publication-badge-row">
          <template v-for="row in publicationRows[identity.category]" :key="row.uri">
            <span v-if="row.status" class="publication-badge" :class="row.status">{{ row.statusText }}</span>
          </template>
        </div>

        <template v-if="isExpanded(identity)">
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
        <div v-if="identity.authUtxo">
          {{ t('identities.authheadAmount', { amount: bchOf(identity.authUtxo.satoshis) }) }}
        </div>
        <div
          v-if="identity.guardAddress"
          class="copy-target"
          :title="identity.guardAddress"
          @click="copyToClipboard(identity.guardAddress)"
        >
          <span class="description">
            {{ t('identities.key.guardLabel') }}
            <InfoPopup>
              <div style="max-width: 300px;">{{ t('identities.key.guardHelp') }}</div>
            </InfoPopup>
          </span>
          <span class="mono">{{ truncateHash(identity.guardAddress) }}</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </div>

        <!-- The latest metadata publication of this identity, and what its locations serve now.
             Shown for a watched identity as much as a held one: reading it needs no custody. -->
        <div class="section">
          <div>{{ t('identities.publication.title') }}</div>
          <div v-if="!identity.publication" class="info-box" style="margin-top: 6px;">
            <q-icon name="info" size="20px" class="warning-box-icon" />
            <div>
              {{ t('identities.publication.none') }}
              <span v-if="identity.authUtxo" class="action-link" @click="toggleAction(identity, 'publish')">
                {{ t('identities.publication.noneAction') }}
              </span>
            </div>
          </div>
          <template v-else>
            <div v-for="row in publicationRows[identity.category]" :key="row.uri" class="publication-uri">
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
            <div
              class="copy-target"
              :title="identity.publication.hash"
              @click="copyToClipboard(identity.publication.hash)"
            >
              <span class="mono">
                {{ t('identities.publication.hash', { hash: truncateHash(identity.publication.hash) }) }}
              </span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </div>
            <div v-if="hasDrifted(identity)" class="description" style="margin-top: 6px;">
              <i18n-t keypath="identities.publication.driftedPrompt" tag="span">
                <template #link>
                  <span class="action-link" @click="toggleAction(identity, 'publish')">{{ t('identities.publication.driftedLink') }}</span>
                </template>
              </i18n-t>
            </div>
          </template>
        </div>

        <!-- The operations, all of them the same spend of the authhead, so they share one row of
             actions and open one form at a time, the way a token item's actions do -->
        <div class="actionBar identity-action-row">
        <template v-if="identity.authUtxo">
          <span @click="toggleAction(identity, 'publish')" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/publishLightGrey.svg' : 'images/publish.svg'">
            {{ t('identities.publish.action') }}
          </span>
          <!-- a reserve is a fungible category's thing: its genesis decides that, not what the
               wallet holds today, so an NFT-only identity never shows these -->
          <template v-if="identity.fungibleSupply">
            <span v-if="reserveOf(identity) > 0n" @click="toggleAction(identity, 'issue')" style="white-space: nowrap;">
              <img class="icon" :src="settingsStore.darkMode? 'images/minus-square-lightGrey.svg' : 'images/minus-square.svg'">
              {{ t('identities.reserve.issue.action') }}
            </span>
            <span @click="toggleAction(identity, 'addToReserve')" style="white-space: nowrap;">
              <img class="icon" :src="settingsStore.darkMode? 'images/plus-square-lightGrey.svg' : 'images/plus-square.svg'">
              {{ t('identities.reserve.add.action') }}
            </span>
          </template>
          <span @click="toggleAction(identity, 'transfer')" style="white-space: nowrap;">
            <img class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'">
            {{ t('identities.transfer.action') }}
          </span>
        </template>
          <q-icon name="more_vert" size="22px" class="identity-menu-trigger">
            <q-menu anchor="bottom right" self="top right">
              <q-list dense>
                <q-item clickable v-close-popup :href="`https://tokenexplorer.cash/?tokenId=${identity.category}`" target="_blank">
                  <q-item-section avatar><q-icon name="open_in_new" size="18px" /></q-item-section>
                  <q-item-section>{{ t('tokenItem.info.seeDetailsOnExplorer') }}</q-item-section>
                </q-item>
                <q-item clickable v-close-popup @click="removeIdentity(identity)">
                  <q-item-section avatar><q-icon name="delete" size="18px" /></q-item-section>
                  <q-item-section>{{ t('identities.remove.button') }}</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-icon>
        </div>

        <div v-if="isOpen(identity, 'publish')" class="section">
          <ol class="walkthrough">
            <li>
              <q-icon name="edit" size="18px" />
              <i18n-t keypath="identities.publish.steps.author" tag="span">
                <template #generator>
                  <a href="https://bcmr-generator.app/" target="_blank">BCMR generator</a>
                </template>
              </i18n-t>
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
          <div v-for="(uri, index) in publishUris" :key="index" class="publish-uri-row">
            <input v-model="publishUris[index]" :placeholder="t('identities.publish.uriPlaceholder')">
            <span
              v-if="publishUris.length > 1"
              class="remove-identity"
              @click="removeUriRow(index)"
            >{{ t('identities.publish.removeLocation') }}</span>
          </div>
          <div class="publish-uri-actions">
            <button @click="addUriRow()">{{ t('identities.publish.addLocation') }}</button>
            <span class="description" :class="{ 'over-budget': publicationBytesLeft < 0 }">
              {{ t('identities.publish.bytesLeft', { bytes: publicationBytesLeft }) }}
            </span>
          </div>
          <input
            @click="publishUpdate(identity)"
            type="button"
            class="primaryButton"
            :value="runningAction === 'publish' ? t('identities.publish.publishingButton') : t('identities.publish.button')"
            :disabled="runningAction !== undefined || !filledUris.length || publicationBytesLeft < 0"
            style="margin-top: 10px;"
          >
        </div>

        <div v-if="isOpen(identity, 'issue')" class="section">
          <div class="description">{{ t('identities.reserve.issue.hint', { amount: reserveDisplay(identity) }) }}</div>
          <div class="issue-amount">
            <input v-model="issueAmount" :placeholder="t('identities.reserve.issue.amountPlaceholder')">
            <button @click="issueAmount = reserveDisplay(identity)">{{ t('tokenItem.actions.max') }}</button>
          </div>
          <div class="transfer-identity">
            <input v-model="issueDestination" :placeholder="t('identities.reserve.issue.destinationPlaceholder')">
          </div>
          <input
            @click="issueFromReserve(identity)"
            type="button"
            class="primaryButton"
            :value="runningAction === 'issue' ? t('identities.reserve.issue.issuingButton') : t('identities.reserve.issue.button')"
            :disabled="runningAction !== undefined || !issueAmount || !issueDestination"
            style="margin-top: 10px;"
          >
        </div>

        <div v-if="isOpen(identity, 'addToReserve')" class="section">
          <div class="description">{{ t('identities.reserve.add.hint') }}</div>
          <div class="transfer-identity">
            <input v-model="addToReserveAmount" :placeholder="t('identities.reserve.add.amountPlaceholder')">
          </div>
          <input
            @click="addToReserve(identity)"
            type="button"
            class="primaryButton"
            :value="runningAction === 'addToReserve' ? t('identities.reserve.add.addingButton') : t('identities.reserve.add.button')"
            :disabled="runningAction !== undefined || !addToReserveAmount"
            style="margin-top: 10px;"
          >
        </div>

        <div v-if="isOpen(identity, 'transfer')" class="section">
          <div class="description">{{ t('identities.transfer.hint') }}</div>
          <!-- what rides on the authhead is asked about rather than moved quietly -->
          <template v-if="identity.authUtxo?.token">
            <label :for="`carried-${identity.category}`" style="display: block; margin-top: 8px;">
              {{ t('identities.transfer.carriedLabel', { carries: carriesLine(identity) }) }}
            </label>
            <select :id="`carried-${identity.category}`" v-model="transferTokensAlong">
              <option :value="false">{{ t('identities.transfer.carriedStays') }}</option>
              <option :value="true">{{ t('identities.transfer.carriedGoes') }}</option>
            </select>
          </template>
          <div class="transfer-identity">
            <input v-model="destination" :placeholder="t('identities.transfer.destinationPlaceholder')">
            <input
              @click="transferIdentity(identity)"
              type="button"
              :value="runningAction === 'transfer' ? t('identities.transfer.transferringButton') : t('identities.transfer.button')"
              :disabled="runningAction !== undefined || !destination"
            >
          </div>
        </div>

        <div v-if="identity.status === 'heldViaKey'" class="section">
          <div class="description">{{ t('identities.key.manageHint') }}</div>
          <div class="identity-actions">
            <a href="https://cashtokens.studio/" target="_blank" class="action-link">
              {{ t('identities.key.manageOnStudio') }}
            </a>
            <span class="action-link" @click="toggleAction(identity, 'transferKey')">
              {{ t('identities.key.action') }}
            </span>
          </div>
          <div v-if="isOpen(identity, 'transferKey')" style="margin-top: 10px;">
            <div class="description">{{ t('identities.key.hint') }}</div>
            <div class="transfer-identity">
              <input v-model="keyDestination" :placeholder="t('identities.key.destinationPlaceholder')">
              <input
                @click="transferKey(identity)"
                type="button"
                :value="runningAction === 'transferKey' ? t('identities.key.transferringButton') : t('identities.key.button')"
                :disabled="runningAction !== undefined || !keyDestination"
              >
            </div>
          </div>
        </div>

        <div class="section">
          <!-- the year comes from the history, so it lands here with the history rather than
               growing the header after the card was drawn -->
          <div>
            {{ t('identities.history.title') }}
            <span v-if="establishedYear(identity)" class="description">
              · {{ t('identities.established.since', { year: establishedYear(identity) }) }}
            </span>
          </div>
          <div v-if="loadingHistory === identity.category" class="description">{{ t('identities.history.loading') }}</div>
          <div
            v-for="link in identitiesStore.identityHistories[identity.category] ?? []"
            :key="link.hash"
            class="chain-link"
          >
            <span v-if="link.kind === 'mint'">{{ t('identities.history.minted', link.minted ?? 0) }}</span>
            <span v-else>{{ t('identities.history.kind.' + link.kind) }}</span>
            <span v-if="link.reserveDelta">
              {{ link.reserveDelta > 0n
                ? t('identities.history.reserveUp', { amount: linkAmount(identity, link.reserveDelta) })
                : t('identities.history.reserveDown', { amount: linkAmount(identity, link.reserveDelta) }) }}
            </span>
            <span v-if="linkDate(link.timestamp)">{{ linkDate(link.timestamp) }}</span>
            <span v-if="madeByThisWallet(link.hash)" class="identity-badge">{{ t('identities.history.madeHere') }}</span>
            <a
              :href="`${store.explorerUrl}/${link.hash}`"
              target="_blank"
              class="mono"
            >{{ link.hash.slice(0, 10) }}</a>
          </div>
        </div>

        </template>
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
/* the whole header is the card's toggle, so it takes the width and the pointer */
.identity-header-row {
  cursor: pointer;
}
/* the state sits in the header's other half, where nothing was */
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
/* one size for the operation icons, whatever each file happens to be drawn at */
.actionBar .icon {
  width: 18px;
  height: 18px;
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
.identity-menu-trigger {
  cursor: pointer;
  /* pinned to the end of the action row rather than wrapping under it */
  margin-left: auto;
}
/* the operations wrap as a group, the menu stays where it is */
.identity-action-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 0;
}
/* the same chip the transaction history marks its own rows with */
.identity-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 0.7em;
  font-weight: 600;
  vertical-align: middle;
  background-color: rgba(128, 128, 128, 0.18);
  color: var(--font-color);
}
.publication-badge-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.identity-title {
  min-width: 0;
}
.identity-status {
  color: grey;
}
/* a held identity is simply how things should be, and a colour that reads as a link on something
   that does not click is worse than plain text */
.identity-status.held,
.identity-status.heldViaKey {
  color: var(--font-color);
}
/* an identity whose authhead lives elsewhere is watched, not broken, so it reads as neither */
.identity-status.notHeld {
  color: grey;
}
.identity-status.unresolved {
  color: orange;
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
/* one line a link, wrapping on a narrow screen the way the rest of the card does */
.chain-link {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
/* the annotation an explorer cannot make: these keys signed this one */
.identity-actions {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.publish-uri-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.publish-uri-row input {
  flex: 1 1 260px;
  margin: 0;
}
.publish-uri-actions {
  display: flex;
  align-items: baseline;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 6px;
}
/* adding a row to a form is a small action, not one the full button size fits */
.publish-uri-actions button {
  padding: 8px 16px;
  font-size: 0.9em;
}
/* what will not relay reads as an error rather than as one more grey number */
.over-budget {
  color: var(--color-error);
}
.action-link {
  color: var(--color-primary);
  cursor: pointer;
}
.action-link:hover {
  text-decoration: underline;
}

/* A process reads as numbered steps, each with the one icon that says what kind of step it is.
   Grey like the descriptions around it: the steps explain, the actions below them act. */
.walkthrough {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: walkthrough-step;
  color: grey;
}
.walkthrough li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 6px;
}
.walkthrough li::before {
  counter-increment: walkthrough-step;
  content: counter(walkthrough-step) ")";
  flex: none;
}
.walkthrough li .q-icon {
  flex: none;
  align-self: center;
}

</style>
