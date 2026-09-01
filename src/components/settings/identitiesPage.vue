<script setup lang="ts">
  import { computed, onActivated, ref, watch } from 'vue'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import {
    copyToClipboard,
    formatBchAmount,
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
    isTokenCategory,
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

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const categoryInput = ref("");
  const isAdding = ref(false);
  const isScanning = ref(false);
  const scanSummary = ref<IdentityScanSummary | undefined>(undefined);
  // The destination of an open transfer form, keyed by category so each card keeps its own
  const destinationInputs = ref<Record<string, string>>({});
  const transferringCategory = ref<string | undefined>(undefined);

  // One form open at a time across the whole list: these are deliberate, one-at-a-time operations,
  // and a card with four open forms says otherwise
  type IdentityAction = 'publish' | 'issue' | 'addToReserve' | 'emptyReserve';
  const openAction = ref<{ category: string, action: IdentityAction } | undefined>(undefined);
  const runningAction = ref<IdentityAction | undefined>(undefined);
  const publishUris = ref<string[]>([]);
  const currentRegistry = ref<RegistrySummary | undefined>(undefined);
  const issueAmount = ref("");
  const issueDestination = ref("");
  const addToReserveAmount = ref("");

  const bchDisplayUnit = computed(() => store.network === 'mainnet' ? 'BCH' : 'tBCH');
  const bchOf = (satoshis: bigint) => `${formatBchAmount(Number(satoshis), false, 8)} ${bchDisplayUnit.value}`;
  const truncateHash = (hash: string) => `${hash.slice(0, 16)}...${hash.slice(-8)}`;

  const identities = computed(() => store.identities ?? []);
  // A watched identity counts here too: the wallet follows its publication either way, and only
  // the actions depend on holding the authhead
  const listedCount = computed(() =>
    identities.value.filter(identity => identity.status !== 'unresolved').length
  );

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
  const hasDrifted = (identity: IdentityState) =>
    !!identity.authUtxo && !!store.publicationChecks[identity.category]?.some(check => check.status === 'changed');

  // One row per published location: the location as published, where it is actually fetched from,
  // and what fetching it found once the check has run
  function publicationRows(identity: IdentityState) {
    const checks = store.publicationChecks[identity.category];
    return (identity.publication?.uris ?? []).map(uri => {
      const status = checks?.find(check => check.uri === uri)?.status;
      return {
        uri,
        url: registryUrlOf(uri, settingsStore.ipfsGateway),
        status,
        statusText: status ? uriStatusText(uri, status) : undefined,
      };
    });
  }

  const identityName = (category: string) => store.bcmrRegistries?.[category]?.name;

  // What an authhead carries alongside the authority to update the metadata: a token supply held
  // back from circulation, an NFT that mints the category's tokens, or both at once. Managing any
  // of it is not here yet, so the card only says what is there.
  function reserveDescription(identity: IdentityState) {
    const token = identity.authUtxo?.token;
    if (!token) return undefined;
    const metadata = store.bcmrRegistries?.[identity.category];
    const lines: string[] = [];
    if (token.amount) {
      const amount = formatTokenAmountFromBigInt(token.amount, metadata?.token?.decimals ?? 0);
      lines.push(t('identities.reserve.supply', { amount, symbol: metadata?.token?.symbol ?? '' }).trim());
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
    // after the resolving, which is what says where each publication is
    await store.checkPublications();
  }

  onActivated(() => { void reloadIdentities() });
  // The view is kept alive across navigation, so a different wallet's form input must not linger
  watch(() => store._wallet, () => {
    categoryInput.value = "";
    destinationInputs.value = {};
    scanSummary.value = undefined;
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

  // Checking costs a Chaingraph query per held category, so it only ever runs on the user's word
  async function scanForIdentities() {
    if (isScanning.value) return;
    isScanning.value = true;
    scanSummary.value = undefined;
    try {
      scanSummary.value = await store.scanForIdentities();
      await fetchMissingMetadata();
    } catch (error) {
      displayAndLogError(error);
    } finally {
      isScanning.value = false;
    }
  }

  const isOpen = (identity: IdentityState, action: IdentityAction) =>
    openAction.value?.category === identity.category && openAction.value.action === action;

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
    currentRegistry.value = undefined;
    if (action !== 'publish' || !identity.publication) return;
    // read what is published now, so the update can say what it changes
    const published = await fetchPublishedRegistry(identity.publication.uris, settingsStore.ipfsGateway);
    if (!published || !isOpen(identity, 'publish')) return;
    currentRegistry.value = summarizeRegistry(published, identity.category);
  }

  const tokenDecimals = (category: string) => store.bcmrRegistries?.[category]?.token?.decimals ?? 0;
  const reserveOf = (identity: IdentityState) => identity.authUtxo?.token?.amount ?? 0n;
  const reserveDisplay = (identity: IdentityState) =>
    formatTokenAmountFromBigInt(reserveOf(identity), tokenDecimals(identity.category));

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
    if (runningAction.value || !authUtxo) return;
    runningAction.value = 'publish';
    try {
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
      openAction.value = undefined;
      await handleTransactionBroadcastSuccess(
        t('identities.publish.done'), txId, t('identities.publish.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      runningAction.value = undefined;
    }
  }

  const walletAddresses = () => ({
    bch: store.wallet.getDepositAddress(),
    token: store.wallet.getTokenDepositAddress(),
  });

  async function issueFromReserve(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (runningAction.value || !authUtxo?.token) return;
    runningAction.value = 'issue';
    try {
      const decimals = tokenDecimals(identity.category);
      const amount = parseTokenAmountToBigInt(issueAmount.value, decimals);
      if (amount <= 0n) throw new Error(t('identities.reserve.errors.invalidAmount'));
      if (amount > reserveOf(identity)) throw new Error(t('identities.reserve.errors.overReserve'));
      const destination = validateTokenRecipientAddress(issueDestination.value, store.wallet.networkPrefix);
      const confirmed = await confirmDialog(
        t('identities.reserve.issue.confirmTitle'),
        t('identities.reserve.issue.confirmMessage', {
          amount: formatTokenAmountFromBigInt(amount, decimals), address: destination,
        }),
        t('identities.reserve.issue.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      // issuing the whole reserve leaves nothing for a token output to carry, which the identity
      // output turns into the emptied layout on its own
      const { txId } = await store.spend.spendAuthUtxo(authUtxo, [
        identityOutput(authUtxo, walletAddresses(), reserveOf(identity) - amount),
        new TokenSendRequest({ cashaddr: destination, category: identity.category, amount }),
      ]);
      openAction.value = undefined;
      await handleTransactionBroadcastSuccess(
        t('identities.reserve.issue.done', { address: destination }), txId, t('identities.reserve.issue.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      runningAction.value = undefined;
    }
  }

  async function addToReserve(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (runningAction.value || !authUtxo?.token) return;
    runningAction.value = 'addToReserve';
    try {
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
      openAction.value = undefined;
      await handleTransactionBroadcastSuccess(
        t('identities.reserve.add.done'), txId, t('identities.reserve.add.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      runningAction.value = undefined;
    }
  }

  async function emptyReserve(identity: IdentityState) {
    const authUtxo = identity.authUtxo;
    if (runningAction.value || !authUtxo?.token) return;
    runningAction.value = 'emptyReserve';
    try {
      const reserve = reserveOf(identity);
      if (reserve <= 0n) throw new Error(t('identities.reserve.errors.nothingToEmpty'));
      const confirmed = await confirmDialog(
        t('identities.reserve.empty.confirmTitle'),
        t('identities.reserve.empty.confirmMessage', { amount: reserveDisplay(identity) }),
        t('identities.reserve.empty.confirmButton')
      );
      if (!confirmed) return;
      notifySending();
      // the reserve returns to the wallet as ordinary circulating supply, leaving the authhead
      // carrying only what it is: the authority
      const { txId } = await store.spend.spendAuthUtxo(authUtxo, [
        identityOutput(authUtxo, walletAddresses(), 0n),
        new TokenSendRequest({
          cashaddr: store.wallet.getTokenDepositAddress(),
          category: identity.category,
          amount: reserve,
        }),
      ]);
      openAction.value = undefined;
      await handleTransactionBroadcastSuccess(
        t('identities.reserve.empty.done'), txId, t('identities.reserve.empty.doneTitle')
      );
    } catch (error) {
      displayAndLogError(error);
    } finally {
      runningAction.value = undefined;
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
      t('identities.transfer.confirmMessage', { amount: bchOf(authUtxo.satoshis), address: destination }),
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
          :disabled="isAdding || store.identitiesResolving || !categoryInput"
        >
      </div>
      <div class="description" style="margin-top: 6px;">{{ t('identities.add.hint') }}</div>
    </div>

    <div class="section">
      <div class="description">
        <i18n-t keypath="identities.scan.prompt" tag="span">
          <template #link>
            <span
              v-if="!isScanning && !store.identitiesResolving"
              class="scan-link"
              @click="scanForIdentities()"
            >{{ t('identities.scan.linkText') }}</span>
            <span v-else>{{ t('identities.scan.linkText') }}</span>
          </template>
        </i18n-t>
      </div>
      <div v-if="isScanning" class="description" style="margin-top: 6px;">{{ t('identities.scan.scanning') }}</div>
      <div v-else-if="scanSummary" class="description" style="margin-top: 6px;">
        <div v-if="scanSummary.found">{{ t('identities.scan.found', scanSummary.found) }}</div>
        <div v-else>{{ t('identities.scan.noneFound') }}</div>
        <div v-if="scanSummary.alreadyListed">{{ t('identities.scan.alreadyListed', scanSummary.alreadyListed) }}</div>
        <div v-if="scanSummary.carriesTokens">{{ t('identities.scan.carriesTokens', scanSummary.carriesTokens) }}</div>
        <div v-if="scanSummary.failed">{{ t('identities.scan.failed', scanSummary.failed) }}</div>
      </div>
    </div>

    <div class="section">
      <div v-if="!store.identities" class="description">{{ t('identities.resolving') }}</div>
      <div v-else-if="!identities.length" class="description">{{ t('identities.empty') }}</div>
      <div v-else class="description">{{ t('identities.listedCount', listedCount) }}</div>

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
          {{ t('identities.authheadAmount', { amount: bchOf(identity.authUtxo.satoshis) }) }}
        </div>

        <!-- The latest metadata publication of this identity, and what its locations serve now.
             Shown for a watched identity as much as a held one: reading it needs no custody. -->
        <div class="section">
          <div>{{ t('identities.publication.title') }}</div>
          <div v-if="!identity.publication" class="description">{{ t('identities.publication.none') }}</div>
          <template v-else>
            <div v-for="row in publicationRows(identity)" :key="row.uri" class="publication-uri">
              <a :href="row.url" target="_blank" class="mono">{{ row.uri }}</a>
              <span v-if="row.status" class="publication-badge" :class="row.status">{{ row.statusText }}</span>
              <span v-else-if="store.publicationChecksRunning" class="description">{{ t('identities.publication.checking') }}</span>
            </div>
            <div class="description mono" :title="identity.publication.hash">
              {{ t('identities.publication.hash', { hash: truncateHash(identity.publication.hash) }) }}
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

        <div v-if="identity.status === 'carriesTokens'" class="section">
          <div>{{ t('identities.reserve.title') }}</div>
          <div v-for="line in reserveDescription(identity)" :key="line" class="description">{{ line }}</div>
        </div>

        <!-- The operations, all of them the same spend of the authhead, so they share one row of
             actions and open one form at a time -->
        <div v-if="identity.authUtxo" class="identity-actions">
          <span class="action-link" @click="toggleAction(identity, 'publish')">
            {{ t('identities.publish.action') }}
          </span>
          <template v-if="identity.status === 'carriesTokens'">
            <span class="action-link" @click="toggleAction(identity, 'issue')">
              {{ t('identities.reserve.issue.action') }}
            </span>
            <span class="action-link" @click="toggleAction(identity, 'addToReserve')">
              {{ t('identities.reserve.add.action') }}
            </span>
            <span class="action-link" @click="toggleAction(identity, 'emptyReserve')">
              {{ t('identities.reserve.empty.action') }}
            </span>
          </template>
        </div>

        <div v-if="isOpen(identity, 'publish')" class="section">
          <div class="description">
            <i18n-t keypath="identities.publish.hint" tag="span">
              <template #generator>
                <a href="https://bcmr-generator.app/" target="_blank">BCMR generator</a>
              </template>
            </i18n-t>
          </div>
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
            <span class="action-link" @click="addUriRow()">{{ t('identities.publish.addLocation') }}</span>
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
          <div class="transfer-identity">
            <input v-model="issueAmount" :placeholder="t('identities.reserve.issue.amountPlaceholder')">
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

        <div v-if="isOpen(identity, 'emptyReserve')" class="section">
          <div class="description">{{ t('identities.reserve.empty.hint', { amount: reserveDisplay(identity) }) }}</div>
          <input
            @click="emptyReserve(identity)"
            type="button"
            class="primaryButton"
            :value="runningAction === 'emptyReserve' ? t('identities.reserve.empty.emptyingButton') : t('identities.reserve.empty.button')"
            :disabled="runningAction !== undefined"
            style="margin-top: 10px;"
          >
        </div>

        <!-- Transferring an identity that carries a reserve is two steps with one meaning each,
             rather than one transfer that quietly moves the supply along with the authority -->
        <div v-if="identity.status === 'carriesTokens'" class="description" style="margin-top: 12px;">
          {{ t('identities.reserve.transferHint') }}
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
.identity-status.carriesTokens {
  color: var(--color-primary);
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

/* the prompt reads as description, only the action it offers is coloured */
.scan-link {
  color: var(--color-primary);
  cursor: pointer;
}
.scan-link:hover {
  text-decoration: underline;
}
</style>
