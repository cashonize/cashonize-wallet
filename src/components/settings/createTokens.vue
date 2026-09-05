<script setup lang="ts">
  import { ref, computed, watch } from 'vue';
  import {
    BCMR_GENERATOR_URL,
    BCMR_SCHEMA_URL,
    CASHTOKENS_STUDIO_URL,
    fetchCandidateRegistry,
    filledLocations,
    locationBudgetLeft,
    publicationOutput,
    summarizeRegistry,
    tokenOutputValue,
  } from 'src/utils/tools/authchainIdentity';
  import {
    formatTokens,
    genesisAmounts,
    metadataReadiness,
    parseDecimals,
    maxTokenSupply,
    genesisCandidates,
    preparedUtxoValue,
    type CheckedRegistry,
  } from 'src/utils/tools/tokenCreation';
  import { copyToClipboard, formatBch, truncateHash } from 'src/utils/utils';
  import { NFTCapability, TokenSendRequest } from 'mainnet-js';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import TokenIcon from '../general/TokenIcon.vue';
  import genesisInputPicker from './genesisInputPicker.vue';
  import publicationLocations from './publicationLocations.vue';
  import InfoPopup from '../general/InfoPopup.vue';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import { confirmDialog, notifySending } from 'src/utils/txHelpers';
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  const $q = useQuasar()
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const inputFungibleSupply = ref("");
  const inputCirculating = ref("");
  const inputDecimals = ref("0");
  // A card says who its side is for and where the token is managed afterwards; the rows, the
  // risk among them, wait behind the closed line's popup once the choice is made
  const cardLines = ['for', 'managed'] as const;
  const homeRows = ['protection', 'metadata', 'operations'] as const;
  // A step's title is what the user does in it, the same whether the step is open or closed, so
  // the greyed list under the open step and the label above it read as one sequence
  function stepLabel(current: number, title: 'utxo' | 'shape' | 'type' | 'metadata') {
    return `${t('createTokens.step', { current, total: 3 })}: ${t(`createTokens.stepTitles.${title}`)}`;
  }
  // the Tokens tab, where the token now shows, the identities page, where its identity does, and
  // the Connect tab, where Studio's WalletConnect session is made
  const tokensView = 2;
  // the token list narrows itself to a pending search on arrival, so the new token is the one shown
  function openInTokenList(category: string) {
    store.pendingTokenSearch = category;
    store.changeView(tokensView);
  }
  const identitiesView = 19;
  const connectView = 4;
  watch(() => store._wallet, startOver);

  // What the token is, rather than a supply field and a toggle the user has to combine into one
  const tokenShape = ref<'fungible' | 'mintingNft' | 'both'>('fungible');
  const createMintingNft = computed(() => tokenShape.value !== 'fungible');
  const hasSupply = computed(() => tokenShape.value !== 'mintingNft');
  const metadataUris = ref<string[]>([""]);
  const activeAction = ref<'checking' | 'creating' | null>(null);

  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);

  // A new token's category is the txid of the UTXO its genesis spends, so which UTXO that is
  // decides the identity's id and its icon before anything exists. Held as an outpoint and
  // resolved against the current UTXOs, so one spent from somewhere else leaves the list and
  // takes the selection with it
  const pickedOutpoint = ref<string | undefined>(undefined);
  const genesisInput = computed(() =>
    store.spendableUtxos && genesisCandidates(store.spendableUtxos).find(utxo => outpointOf(utxo) === pickedOutpoint.value)
  );
  const plannedCategory = computed(() => genesisInput.value?.txid);

  // The steps open one at a time, the way the flipstarter page's do: step 1 closes to one line
  // once a genesis input is set and can be reopened, step 2 opens then, and step 3 with Create
  // once step 2 is settled. The choice block closes with step 1, the form under it being
  // committed to; "change" there gives the pick up, since the pick belongs to this path.
  const editingUtxo = ref(true);
  // watched by outpoint: every utxo refresh hands out fresh objects for the same coin
  watch(() => genesisInput.value && outpointOf(genesisInput.value), picked => {
    if (picked) editingUtxo.value = false;
  });
  const utxoStepOpen = computed(() => editingUtxo.value || !genesisInput.value);
  // Where the token's identity lives afterwards: here, or in an AuthGuard covenant made by
  // CashTokens Studio. This page only makes the first; the second is a link out.
  const selectedHome = ref<'wallet' | 'studio' | undefined>(undefined);
  const homeConfirmed = ref(false);
  const choiceOpen = computed(() => !homeConfirmed.value);
  function confirmHome() {
    homeConfirmed.value = true;
  }
  // the shape step is titled by what it asks, which for a collection alone is only the type
  const shapeTitle = computed(() => hasSupply.value ? 'shape' : 'type');
  // Step 2 closes on its own Continue, so step 3 opens one step at a time for every shape, a
  // minting NFT alone included, where nothing but the select would otherwise settle it
  const shapeStepOpen = ref(true);
  const shapeSummary = computed(() => {
    const shape = t(`createTokens.shapes.${tokenShape.value}`);
    if (!hasSupply.value || totalSupply.value === undefined) return shape;
    return `${shape}, ${t('createTokens.closedSupply', { supply: tokensOf(totalSupply.value), decimals: decimals.value })}`;
  });
  function changeHome() {
    homeConfirmed.value = false;
    selectedHome.value = undefined;
    pickedOutpoint.value = undefined;
    editingUtxo.value = true;
    shapeStepOpen.value = true;
  }

  // Amounts are typed in tokens and the decimals field does the zeroes: the number on chain is
  // permanent, and asking the user for that arithmetic was the mistake every walkthrough made
  const decimals = computed(() => parseDecimals(inputDecimals.value) ?? 0);
  const amounts = computed(() => genesisAmounts(inputFungibleSupply.value, inputCirculating.value, inputDecimals.value));
  const totalSupply = computed(() => typeof amounts.value === 'string' ? undefined : amounts.value.supply);
  const circulating = computed(() => typeof amounts.value === 'string' ? undefined : amounts.value.circulating);
  // What the AuthHead keeps: supply the wallet holds out of circulation, alongside the authority
  const reserve = computed(() => typeof amounts.value === 'string' ? undefined : amounts.value.reserve);
  const baseUnitsOf = (baseUnits: bigint) => formatTokens(baseUnits, 0);
  // Tokens, with the symbol once a checked metadata file has given the token one: the first time
  // the user's number looks like a token
  function tokensOf(baseUnits: bigint) {
    const symbol = readiness.value === 'ready' ? checkedRegistry.value?.summary.symbol : undefined;
    const amount = formatTokens(baseUnits, decimals.value);
    return symbol ? `${amount} ${symbol}` : amount;
  }

  // The genesis is the one transaction that cannot be corrected afterwards, so what it refuses is
  // said before the button is pressed rather than by a failed broadcast.
  const genesisProblem = computed(() => {
    if (!hasSupply.value) return undefined;
    if (typeof amounts.value === 'string') {
      if (amounts.value === 'overMaxSupply') {
        // the cap in the unit the field is typed in: the on-chain number is not one the user can type here
        return t('createTokens.errors.overMaxSupply', { max: formatTokens(maxTokenSupply, decimals.value) });
      }
      return t(`createTokens.errors.${amounts.value}`);
    }
    // a token output carrying neither an amount nor an NFT is invalid, so without a minting NFT
    // the identity output has to keep some of the supply: refused here, before the genesis can
    if (!createMintingNft.value && amounts.value.supply > 0n && amounts.value.reserve === 0n) {
      return t('createTokens.errors.emptyReserve', { minimum: formatTokens(1n, decimals.value) });
    }
    return undefined;
  });

  // Step 2 is settled when what Create acts on is: a shape, and for a shape with a supply both
  // amounts typed and passing the checks
  const supplySettled = computed(() => {
    if (!hasSupply.value) return true;
    if (!inputFungibleSupply.value.trim() || !inputCirculating.value.trim()) return false;
    return genesisProblem.value === undefined && (totalSupply.value ?? 0n) > 0n;
  });

  const filledUris = computed(() => filledLocations(metadataUris.value));

  // What the typed locations serve, fetched and verified on the user's word rather than on blur,
  // and shown before anything is signed: the creator confirms a genesis knowing the name, the
  // decimals and the hash it commits to. Verified by the same code an update's publication is;
  // checking that the file names this identity is possible because the category is known already.
  const checkedRegistry = ref<CheckedRegistry | undefined>(undefined);
  watch(filledUris, (uris, before) => {
    if (uris.join('\n') !== before.join('\n')) checkedRegistry.value = undefined;
  });
  // the decimals field is only shown for a shape with a supply, so only then can it disagree
  // with the registry; a leftover value must not block a minting NFT alone
  const readiness = computed(() => metadataReadiness(
    filledUris.value,
    checkedRegistry.value,
    hasSupply.value ? decimals.value : (checkedRegistry.value?.summary.decimals ?? 0),
  ));

  async function checkRegistry() {
    const category = plannedCategory.value;
    if (activeAction.value || !category || !filledUris.value.length) return;
    activeAction.value = 'checking';
    try {
      if (locationBudgetLeft(filledUris.value) < 0) throw new Error(t('identities.publish.errors.tooLarge'));
      const candidate = await fetchCandidateRegistry(filledUris.value, settingsStore.ipfsGateway);
      const summary = summarizeRegistry(candidate.content, category);
      if (!summary) throw new Error(t('createTokens.notifications.bcmrWrongIdentity'));
      checkedRegistry.value = { uris: [...filledUris.value], summary, hash: candidate.hash };
    } catch (error) {
      displayAndLogError(error);
    } finally {
      activeAction.value = null;
    }
  }

  // the file's icon, resolved the way the token list resolves one
  const checkedIconUrl = computed(() => {
    const uri = checkedRegistry.value?.summary.iconUri;
    if (!uri) return undefined;
    return uri.startsWith('ipfs://') ? settingsStore.ipfsGateway + uri.slice('ipfs://'.length) : uri;
  });

  const checkedName = computed(() => {
    const summary = checkedRegistry.value?.summary;
    if (!summary) return undefined;
    return summary.symbol ? `${summary.name} (${summary.symbol})` : summary.name;
  });

  // The publication output of a checked metadata file; none when no location was typed
  function metadataOutput() {
    if (readiness.value === 'none') return undefined;
    const checked = checkedRegistry.value;
    if (readiness.value !== 'ready' || !checked) throw new Error(t('createTokens.check.needed'));
    return publicationOutput(checked.hash, checked.uris);
  }

  // What the page made, shown in its place as the last step rather than as a dialog over it, the
  // way the flipstarter page shows its signed pledge. Stays until the user starts over.
  interface CreatedToken {
    category: string;
    txId: string | undefined;
    name?: string;
    symbol?: string;
    iconUrl?: string;
    hasSupply: boolean;
    supply: bigint;
    reserve: bigint;
    circulating: bigint;
    decimals: number;
  }
  const created = ref<CreatedToken | undefined>(undefined);
  function createdAmount(baseUnits: bigint) {
    const token = created.value;
    if (!token) return '';
    const amount = formatTokens(baseUnits, token.decimals);
    return token.symbol ? `${amount} ${token.symbol}` : amount;
  }

  function startOver() {
    created.value = undefined;
    inputFungibleSupply.value = "";
    inputCirculating.value = "";
    inputDecimals.value = "0";
    tokenShape.value = 'fungible';
    metadataUris.value = [""];
    checkedRegistry.value = undefined;
    changeHome();
  }

  // One genesis builds the whole issuer kit: output 0 is the AuthHead, carrying the reserve and
  // the minting NFT if there is one, and a second output carries what is issued to circulation.
  async function createToken(){
    if (activeAction.value) return;
    const pickedCoin = genesisInput.value;
    const reserveAmount = hasSupply.value ? reserve.value : 0n;
    const circulatingAmount = hasSupply.value ? circulating.value : 0n;
    if (!pickedCoin || genesisProblem.value) return;
    if (reserveAmount === undefined || circulatingAmount === undefined) return;
    // a genesis cannot be corrected afterwards, so what it makes is confirmed first, always
    const confirmed = await confirmDialog(
      t('createTokens.confirm.title'),
      confirmMessage(reserveAmount, circulatingAmount),
      t('createTokens.confirm.button')
    );
    if (!confirmed) return;
    activeAction.value = 'creating';
    try{
      const opreturnData = metadataOutput();
      const tokenAddress = store.wallet.getTokenDepositAddress();
      const circulationOutput = new TokenSendRequest({
        cashaddr: tokenAddress,
        category: pickedCoin.txid,
        amount: circulatingAmount,
        value: tokenOutputValue,
      });
      const extraOutputs = [
        ...(circulatingAmount > 0n ? [circulationOutput] : []),
        ...(opreturnData ? [opreturnData] : []),
      ];
      notifySending(t('createTokens.notifications.creatingTokens'));
      const genesisResponse = await store.spend.tokenGenesis(
        pickedCoin,
        {
          cashaddr: tokenAddress,
          amount: reserveAmount,
          value: tokenOutputValue,
          ...(createMintingNft.value ? { nft: { commitment: "", capability: NFTCapability.minting } } : {}),
        },
        extraOutputs
      );
      const { txId } = genesisResponse;
      // creation ends where management begins: the identity is listed and its AuthHead held back
      if (txId) await identitiesStore.listCreatedIdentity(pickedCoin.txid, txId);
      const linked = opreturnData ? checkedRegistry.value?.summary : undefined;
      created.value = {
        category: pickedCoin.txid,
        txId,
        ...(linked ? { name: linked.name } : {}),
        ...(linked?.symbol ? { symbol: linked.symbol } : {}),
        ...(linked && checkedIconUrl.value ? { iconUrl: checkedIconUrl.value } : {}),
        hasSupply: hasSupply.value,
        supply: totalSupply.value ?? 0n,
        reserve: reserveAmount,
        circulating: circulatingAmount,
        decimals: decimals.value,
      };
      $q.notify({ type: 'positive', message: t('createTokens.notifications.transactionSent') });
      await store.updateWalletUtxos();
      void store.updateWalletHistory();
    } catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }

  // Tokens, and the base units in brackets when the decimals make them differ
  function amountShown(baseUnits: bigint) {
    if (!decimals.value) return tokensOf(baseUnits);
    return `${tokensOf(baseUnits)} (${baseUnitsOf(baseUnits)})`;
  }

  // What is about to be made, for the dialog that asks before it is
  function confirmMessage(reserveAmount: bigint, circulatingAmount: bigint) {
    const lines = [t(`createTokens.shapes.${tokenShape.value}`)];
    if (hasSupply.value) {
      lines.push(t('createTokens.confirm.supply', { supply: amountShown(totalSupply.value ?? 0n) }));
      lines.push(t('createTokens.confirm.decimals', { decimals: decimals.value }));
      lines.push(t('createTokens.circulation.split', {
        reserve: amountShown(reserveAmount), circulating: amountShown(circulatingAmount),
      }));
    }
    const checked = checkedRegistry.value;
    if (checked && readiness.value === 'ready') {
      lines.push(t('createTokens.confirm.metadataLinked', { name: checkedName.value, location: checked.uris.join(', ') }));
    } else {
      lines.push(t('createTokens.confirm.metadataNone'));
    }
    return lines.join('\n');
  }
</script>

<template>
  <div>
    <fieldset class="item" style="padding-bottom: 20px;">
      <legend>{{ t('createTokens.title') }}</legend>

      <!-- The finish, in the page's own sequence: the closed steps with their ticks, then the
           token as the Tokens tab will show it, with the next thing to do beside it -->
      <template v-if="created">
        <div class="closed-line description">
          <img src="images/check-circle.svg" class="step-check">
          <span>{{ t('createTokens.home.chosen') }}</span>
        </div>
        <div class="closed-line description">
          <img src="images/check-circle.svg" class="step-check">
          <span>{{ t('createTokens.plannedTokenId') }}</span>
          <span class="copy-target" @click="copyToClipboard(created.category)">
            <span class="mono">{{ truncateHash(created.category) }}</span>
            <img class="copyIcon" src="images/copyGrey.svg">
          </span>
        </div>
        <div class="closed-line description">
          <img src="images/check-circle.svg" class="step-check">
          <span>{{ stepLabel(2, created.hasSupply ? 'shape' : 'type') }}</span>
        </div>
        <div class="closed-line description">
          <img src="images/check-circle.svg" class="step-check">
          <span>{{ stepLabel(3, 'metadata') }}</span>
        </div>

        <div class="section created-title">{{ t('createTokens.created.title') }}</div>
        <div class="created-card">
          <!-- keyed on the category because the generated icon is only drawn when the component mounts -->
          <TokenIcon :key="created.category" :token-id="created.category" :icon-url="created.iconUrl" :size="48" class="pop" />
          <div>
            <div v-if="created.name"><b>{{ created.symbol ? `${created.name} (${created.symbol})` : created.name }}</b></div>
            <div v-else class="copy-target" @click="copyToClipboard(created.category)">
              <span class="mono">{{ truncateHash(created.category) }}</span>
              <img class="copyIcon" src="images/copyGrey.svg">
            </div>
            <div v-if="created.hasSupply">{{ t('createTokens.created.supply', { amount: createdAmount(created.supply) }) }}</div>
            <div v-else>{{ t('createTokens.created.mintingNft') }}</div>
            <div v-if="created.hasSupply">
              {{ t('createTokens.created.split', { reserve: createdAmount(created.reserve), circulating: createdAmount(created.circulating) }) }}
            </div>
            <!-- the number lives nowhere else until the file is written; this is where the user is
                 looking at their numbers -->
            <div v-if="created.hasSupply && !created.name">{{ t('createTokens.created.decimals', { decimals: created.decimals }) }}</div>
            <div class="description">{{ t('createTokens.created.listed') }}</div>
          </div>
        </div>
        <!-- the nameless token is the thing the user is looking at, with the fix one tap away -->
        <div v-if="!created.name" style="margin-top: 10px;">
          <i18n-t keypath="createTokens.created.untilPublished" tag="span">
            <template #link>
              <span class="action-link" @click="store.changeView(identitiesView)">{{ t('createTokens.created.untilPublishedLink') }}</span>
            </template>
          </i18n-t>
        </div>
        <div class="created-actions">
          <input type="button" :value="t('createTokens.created.seeToken')" @click="openInTokenList(created.category)">
          <input type="button" :value="t('createTokens.created.seeIdentity')" @click="store.changeView(identitiesView)">
        </div>
        <div class="created-links">
          <a v-if="created.txId" :href="`${store.explorerUrl}/${created.txId}`" target="_blank" class="action-link">
            {{ t('createTokens.created.viewTransaction') }}
            <img :src="settingsStore.darkMode ? 'images/external-link-grey.svg' : 'images/external-link.svg'" style="vertical-align: sub;">
          </a>
          <span class="action-link" @click="startOver()">{{ t('createTokens.created.createAnother') }}</span>
        </div>
      </template>

      <template v-else>
      <!-- The one decision on this page a creator cannot see the consequences of from the form:
           where the token's identity lives afterwards. One short intro, then two cards of the
           same shape so neither reads as the recommended one: a radio marker, a title with the
           mark of the thing it stands for, and two lines with the same leads, who the side is for
           and where the token is managed. A pick replaces all of it with one closed line. -->
      <template v-if="choiceOpen">
      <div>{{ t('createTokens.home.intro') }}</div>
      <div class="home-cards">
        <div class="home-card" :class="{ selected: selectedHome === 'wallet' }" @click="selectedHome = 'wallet'">
          <div class="home-card-title">
            <span class="home-radio"></span>
            <b>{{ t('createTokens.home.wallet') }}</b>
            <img src="images/cashonize-icon.png" class="home-mark">
          </div>
          <div v-for="line in cardLines" :key="line">
            <b>{{ t(`createTokens.home.cardLeads.${line}`) }}</b> {{ t(`createTokens.home.walletLines.${line}`) }}
          </div>
        </div>
        <div class="home-card" :class="{ selected: selectedHome === 'studio' }" @click="selectedHome = 'studio'">
          <div class="home-card-title">
            <span class="home-radio"></span>
            <b>{{ t('createTokens.home.studio') }}</b>
            <img src="images/studio.png" class="home-mark">
          </div>
          <div v-for="line in cardLines" :key="line">
            <b>{{ t(`createTokens.home.cardLeads.${line}`) }}</b> {{ t(`createTokens.home.studioLines.${line}`) }}
          </div>
        </div>
      </div>
      <!-- the selected side's detail, read before it is committed to: the same three leads on
           both sides so the selection is compared like with like, the risk in the Protection row,
           and the way back in the last line -->
      <div v-if="selectedHome" class="section home-rows">
        <div v-for="row in homeRows" :key="row">
          <b>{{ t(`createTokens.home.leads.${row}`) }}</b> {{ t(`createTokens.home.${selectedHome}Rows.${row}`) }}
          <!-- Studio's side has two mechanisms behind its rows: the covenant and the key, by the
               names Studio uses for them, and why the file wants a copy kept; the wallet side's
               rows carry none -->
          <InfoPopup v-if="selectedHome === 'studio' && (row === 'protection' || row === 'metadata')">
            <div style="max-width: 300px;">{{ t(`createTokens.home.studioRows.${row}Help`) }}</div>
          </InfoPopup>
        </div>
        <div class="description">{{ t(`createTokens.home.${selectedHome}Rows.moveLater`) }}</div>
        <!-- the wallet path has three steps to go to, so Continue takes it there; Studio's side is
             one fact and one link, which fit here -->
        <input
          v-if="selectedHome === 'wallet'"
          @click="confirmHome()"
          type="button"
          class="primaryButton"
          :value="t('createTokens.home.continueButton')"
          style="margin-top: 10px;"
        >
        <template v-else>
          <!-- the one fact a user meets on coming back from Studio, a key NFT and no tokens, beside
               the one action, marked external like every other link out of the wallet -->
          <div class="info-box" style="margin: 10px 0 16px;">
            <img class="warning-box-icon" :src="settingsStore.darkMode ? 'images/infoLightGrey.svg' : 'images/info.svg'" width="20" height="20">
            <div>{{ t('createTokens.home.studioBox') }}</div>
          </div>
          <div class="studio-actions">
            <a :href="CASHTOKENS_STUDIO_URL[store.network]" target="_blank" class="button primaryButton studio-button">
              {{ t('createTokens.home.openStudio') }}
              <img src="images/external-link-white.svg">
            </a>
            <!-- the wallet's side of the same flow: Studio asks for a wallet over WalletConnect -->
            <input type="button" :value="t('createTokens.home.connectButton')" @click="store.changeView(connectView)">
          </div>
        </template>
      </div>
      </template>
      <!-- what was chosen, and the way back: from the user's side Continue went to a new page -->
      <div v-else class="chosen-line">
        <span>{{ t('createTokens.home.chosen') }}</span>
        <span class="go-back" @click="changeHome()">← {{ t('createTokens.goBack') }}</span>
      </div>

      <template v-if="homeConfirmed">

      <!-- Which UTXO the genesis spends decides the token's permanent id, which is the whole of
           what this section is, so it leads with that rather than with a heading repeating it -->
      <div v-if="utxoStepOpen" class="section">
        <div class="step-label open">{{ stepLabel(1, 'utxo') }}</div>
        <!-- the open step's one action, preparing, takes the primary style inside the picker;
             Create is not on screen until this step has closed -->
        <genesisInputPicker
          v-model="pickedOutpoint"
          :explainer="t('createTokens.genesisInput.explainer')"
          :prepare-message="t('createTokens.prepare.message', { amount: bchOf(preparedUtxoValue) })"
        />

        <div v-if="plannedCategory" class="planned-category">
          <!-- keyed on the category because the icon is only drawn when the component mounts -->
          <TokenIcon :key="plannedCategory" :token-id="plannedCategory" :size="40" />
          <div class="copy-target" @click="copyToClipboard(plannedCategory)">
            <span class="description">{{ t('createTokens.plannedTokenId') }}</span>
            <span class="mono">{{ truncateHash(plannedCategory) }}</span>
            <img class="copyIcon" src="images/copyGrey.svg">
          </div>
        </div>
      </div>
      <!-- closed to the one thing the step decided, in the form the metadata names it by, which
           copies on tap since pasting it into the generator is the next thing a creator does -->
      <div v-else-if="plannedCategory" class="section closed-line description">
        <img src="images/check-circle.svg" class="step-check pop">
        <span>{{ t('createTokens.plannedTokenId') }}</span>
        <span class="copy-target" @click="copyToClipboard(plannedCategory)">
          <span class="mono">{{ truncateHash(plannedCategory) }}</span>
          <img class="copyIcon" src="images/copyGrey.svg">
        </span>
        <span>·</span>
        <span class="action-link" @click="editingUtxo = true">{{ t('createTokens.change') }}</span>
      </div>
      <!-- the shape of the flow shows before its fields do, since the first step costs a fee -->
      <template v-if="utxoStepOpen">
        <div class="section step-label">{{ stepLabel(2, shapeTitle) }}</div>
        <div class="step-label" style="margin-top: 8px;">{{ stepLabel(3, 'metadata') }}</div>
      </template>

      <!-- Deciding what to make does not depend on which UTXO makes it, but it reads better one
           thing at a time, so this opens once the UTXO is settled -->
      <div v-if="!utxoStepOpen && shapeStepOpen" class="section">
        <div class="step-label open">{{ stepLabel(2, shapeTitle) }}</div>
        <!-- the sentences that change what the user does are in the lines the fields have, not
             behind icons: what a minting NFT is, that the supply is final, what decimals mean -->
        <label for="tokenShape">{{ t('createTokens.shapeLabel') }}</label>
        <select id="tokenShape" v-model="tokenShape">
          <option value="fungible">{{ t('createTokens.shapes.fungible') }}</option>
          <option value="mintingNft">{{ t('createTokens.shapes.mintingNft') }}</option>
          <option value="both">{{ t('createTokens.shapes.both') }}</option>
        </select>
        <div v-if="createMintingNft" class="description" style="margin-top: 4px;">{{ t('createTokens.mintingDescription') }}</div>
        <div v-if="createMintingNft" class="description" style="margin-top: 4px;">{{ t('createTokens.mintingNote') }}</div>

        <template v-if="hasSupply">
        <!-- the supply in tokens beside the decimals that turn it into the permanent number on
             chain, which is shown underneath rather than typed -->
        <div class="supply-row">
          <div class="supply-field">
            <label for="supply">{{ t('createTokens.supplyLabel') }}</label>
            <input
              id="supply"
              v-model="inputFungibleSupply"
              :placeholder="t('createTokens.supplyPlaceholder')"
              type="text"
              inputmode="decimal"
            >
          </div>
          <div class="decimals-field">
            <label for="decimals">{{ t('createTokens.decimalsLabel') }}</label>
            <!-- a text input: v-model on a number input casts to a number, and the string parser
                 the amounts share would throw on it -->
            <input id="decimals" v-model="inputDecimals" type="text" inputmode="numeric">
          </div>
        </div>
        <div style="margin-top: 4px;">{{ t('createTokens.supplyNote') }}</div>
        <div class="description" style="margin-top: 4px;">{{ t('createTokens.decimalsNote') }}</div>
        <div v-if="decimals && totalSupply" style="margin-top: 4px;">
          {{ t('createTokens.supplyOnChain', { tokens: tokensOf(totalSupply), base: baseUnitsOf(totalSupply) }) }}
        </div>

        <label for="circulating">{{ t('createTokens.circulation.label') }}</label>
        <input
          id="circulating"
          v-model="inputCirculating"
          :placeholder="t('createTokens.circulation.placeholder')"
          type="text"
          inputmode="decimal"
        >
        <div v-if="totalSupply && reserve !== undefined && circulating !== undefined" style="margin-top: 6px;">
          {{ t('createTokens.circulation.split', { reserve: tokensOf(reserve), circulating: tokensOf(circulating) }) }}
        </div>
        <div class="description" style="margin-top: 4px;">{{ t('createTokens.circulation.note') }}</div>
        <div v-if="genesisProblem" class="genesis-problem" style="margin-top: 6px;">{{ genesisProblem }}</div>
        </template>
        <input
          type="button"
          class="primaryButton"
          :value="t('createTokens.nextButton')"
          style="margin-top: 12px;"
          :disabled="!supplySettled"
          @click="shapeStepOpen = false"
        >
      </div>
      <div v-else-if="!utxoStepOpen" class="section closed-line description">
        <img src="images/check-circle.svg" class="step-check pop">
        <span>{{ shapeSummary }}</span>
        <span>·</span>
        <span class="action-link" @click="shapeStepOpen = true">{{ t('createTokens.change') }}</span>
      </div>

      <!-- Optional. The location is the field that delivers what the page promises, so it is in
           the open; how to write and host the file is the collapsible part. -->
      <div v-if="!utxoStepOpen && !shapeStepOpen" class="section">
        <div class="step-label open">{{ stepLabel(3, 'metadata') }}</div>
        <div style="margin-top: 6px;">
          <i18n-t keypath="createTokens.metadataNote" tag="span">
            <template #generator>
              <a :href="BCMR_GENERATOR_URL" target="_blank">BCMR generator</a>
            </template>
          </i18n-t>
          <InfoPopup>
            <div style="max-width: 300px;">
              <i18n-t keypath="identities.publish.generatorHelp" tag="span">
                <template #schema>
                  <a :href="BCMR_SCHEMA_URL" target="_blank">{{ t('identities.publish.generatorHelpSchema') }}</a>
                </template>
              </i18n-t>
            </div>
          </InfoPopup>
        </div>
        <!-- the number chosen in step 2, carried here where the file that has to agree is named -->
        <div v-if="hasSupply" class="description" style="margin-top: 6px;">
          {{ t('createTokens.check.decimalsReminder', { decimals }) }}
        </div>
        <div class="description" style="margin-top: 4px;">{{ t('createTokens.locationHint') }}</div>
        <publicationLocations v-model="metadataUris">
          <span class="description">{{ t('createTokens.sameFile') }}</span>
        </publicationLocations>
        <!-- The check is the user's action, never a fetch on blur, and what it found is shown
             before anything is signed: the token as wallets will show it, and the hash Create
             would commit to. The one moment of colour on the page that is not the primary green,
             and it is the user's own. -->
        <template v-if="filledUris.length">
          <input
            v-if="readiness === 'unchecked'"
            @click="checkRegistry"
            type="button"
            :value="activeAction === 'checking' ? t('createTokens.check.checking') : t('createTokens.check.button')"
            :disabled="activeAction !== null"
            style="margin-top: 10px;"
          >
          <div v-if="readiness === 'unchecked'" class="description" style="margin-top: 6px;">{{ t('createTokens.check.needed') }}</div>
          <template v-else-if="checkedRegistry">
            <div class="description" style="margin-top: 10px;">{{ t('createTokens.check.howShown') }}</div>
            <div class="checked-registry pop">
              <TokenIcon :key="checkedRegistry.hash" :token-id="plannedCategory ?? ''" :icon-url="checkedIconUrl" :size="48" />
              <div>
                <div>{{ t('createTokens.check.summary', { name: checkedName, decimals: checkedRegistry.summary.decimals ?? 0 }) }}</div>
                <div class="description mono">{{ t('createTokens.check.hash', { hash: truncateHash(checkedRegistry.hash) }) }}</div>
              </div>
            </div>
            <div v-if="readiness === 'decimalsMismatch'" class="genesis-problem" style="margin-top: 6px;">
              {{ t('createTokens.check.decimalsMismatch', { registry: checkedRegistry.summary.decimals ?? 0, chosen: decimals }) }}
            </div>
          </template>
        </template>
        <details style="margin-top: 10px;">
          <summary style="display: list-item">{{ t('createTokens.howTo') }}</summary>
          <!-- These four are the reader's own actions, done on other sites, so they take the text
               colour; the numbers already say they are steps in order -->
          <ol class="walkthrough">
            <li>
              <i18n-t keypath="createTokens.steps.author" tag="span">
                <template #generator>
                  <a :href="BCMR_GENERATOR_URL" target="_blank">BCMR generator</a>
                </template>
              </i18n-t>
            </li>
            <li>{{ t('createTokens.steps.host') }}</li>
            <li>{{ t('createTokens.steps.verify') }}</li>
            <li>{{ t('createTokens.steps.create') }}</li>
          </ol>
          <div style="margin-top: 8px;">{{ t('createTokens.noHosting') }}</div>
        </details>

        <input
          @click="createToken"
          type="button"
          class="primaryButton"
          :value="activeAction === 'creating' ? t('createTokens.creatingTokensButton') : t('createTokens.createButton')"
          style="margin: 15px 0 4px;"
          :disabled="activeAction !== null || genesisProblem !== undefined || (readiness !== 'none' && readiness !== 'ready')"
        >
      </div>
      <div v-else-if="!utxoStepOpen" class="section step-label">
        {{ stepLabel(3, 'metadata') }}
      </div>
      </template>
      </template>
    </fieldset>
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
/* side by side where the width allows, stacked on a phone; a card line is cut to the column of a
   half-width card so it stays one line, and the pair borrows most of the fieldset's 2rem inset,
   the only columns on the page and the only thing that gains from it. The selected card is
   marked the way a picked UTXO is, and stops reading as clickable. */
.home-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
  margin: 20px -1.25rem 0;
}
.home-card {
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
}
.dark .home-card {
  border-color: #333;
}
.home-card:hover {
  border-color: rgba(128, 128, 128, 0.4);
}
.home-card.selected {
  border-color: var(--color-primary);
  cursor: default;
}
/* set rather than crammed: air under the title, a little between the facts */
.home-card > div {
  margin-top: 3px;
}
.home-card > .home-card-title + div {
  margin-top: 6px;
}
/* the one-of-two control the page's own inputs use, so a card reads as a choice on a phone too;
   after the title, the mark of the thing the card stands for: home, or someone else's site */
.home-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0;
}
.home-radio {
  flex: none;
  width: 16px;
  height: 16px;
  border: 2px solid grey;
  border-radius: 50%;
}
.home-card.selected .home-radio {
  border-color: var(--color-primary);
  background: radial-gradient(circle, var(--color-primary) 45%, transparent 50%);
}
.home-mark {
  width: 20px;
  height: 20px;
  flex: none;
}
.home-rows div {
  margin-top: 4px;
}
/* the way back, in the text colour like the settings pages' own back line */
.chosen-line {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.go-back {
  cursor: pointer;
}
.studio-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 10px;
}
.studio-actions input {
  margin: 0;
}
.studio-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
/* the anchor hover tints the background; a button hovers by fading, like every other button */
.studio-button:hover {
  background-color: var(--color-primary);
  opacity: 0.8;
}
label {
  display: block;
  margin-top: 14px;
  margin-bottom: 4px;
}
.genesis-problem {
  color: var(--color-error);
}
/* the supply and its decimals on one line where the width allows */
.supply-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.supply-field {
  flex: 1 1 220px;
}
.decimals-field {
  flex: 0 0 110px;
}
.supply-row input {
  margin: 0;
}
.checked-registry {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
.planned-category {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
/* the finish: the one glad line on the page, then the token in the shape the Tokens tab gives it */
.created-title {
  font-size: 1.2em;
  font-weight: bold;
}
.created-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}
.dark .created-card {
  border-color: #333;
}
.created-card > div > div {
  margin-top: 2px;
}
.created-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 15px;
}
.created-actions input {
  margin: 0;
}
.created-links {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 10px;
}
</style>
