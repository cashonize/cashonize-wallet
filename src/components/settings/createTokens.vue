<script setup lang="ts">
  import { ref, computed, watch } from 'vue';
  import type { Utxo } from 'mainnet-js';
  import { filledLocations, locationBudgetLeft, publicationOutput, tokenOutputValue } from 'src/utils/tools/authchainIdentity';
  import { BCMR_GENERATOR_URL, BCMR_SCHEMA_URL, fetchCandidateRegistry, summarizeRegistry } from 'src/utils/tools/registryFile';
  import {
    formatTokens,
    genesisAmounts,
    metadataReadiness,
    parseDecimals,
    maxTokenSupply,
    preparedUtxoValue,
    stepLabel,
    type CheckedRegistry,
    type CreatedToken,
  } from 'src/utils/tools/tokenCreation';
  import { copyToClipboard, formatBch, truncateHash } from 'src/utils/utils';
  import { NFTCapability, TokenSendRequest } from 'mainnet-js';
  import TokenIcon from '../general/TokenIcon.vue';
  import genesisInputPicker from './genesisInputPicker.vue';
  import publicationLocations from './publicationLocations.vue';
  import tokenCreationChoice from './tokenCreationChoice.vue';
  import tokenCreated from './tokenCreated.vue';
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
  const bchOf = (satoshis: bigint) => formatBch(satoshis, store.network);
  const stepTitle = (title: 'utxo' | 'shape' | 'type' | 'metadata') => t(`createTokens.stepTitles.${title}`);
  watch(() => store._wallet, startOver);

  // What the token is, rather than a supply field and a toggle the user has to combine into one
  const tokenShape = ref<'fungible' | 'mintingNft' | 'both'>('fungible');
  const createMintingNft = computed(() => tokenShape.value !== 'fungible');
  const hasSupply = computed(() => tokenShape.value !== 'mintingNft');
  const metadataUris = ref<string[]>([""]);
  const activeAction = ref<'checking' | 'creating' | null>(null);

  // A new token's category is the txid of the UTXO its genesis spends, so which UTXO that is
  // decides the identity's id and its icon before anything exists. The picker owns the pick and
  // whether its step is open; the steps after it open one at a time, the way the flipstarter
  // page's do, and the choice block closes with step 1, the form under it being committed to.
  const genesisInput = ref<Utxo | undefined>(undefined);
  const utxoStepOpen = ref(true);
  const plannedCategory = computed(() => genesisInput.value?.txid);
  const homeConfirmed = ref(false);
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
    genesisInput.value = undefined;
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

  const created = ref<CreatedToken | undefined>(undefined);

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

  // The genesis request and the outputs beside it: output 0 is the AuthHead, carrying the reserve
  // and the minting NFT if there is one, then what is issued to circulation and the publication
  function genesisOutputs(category: string, reserveAmount: bigint, circulatingAmount: bigint) {
    const tokenAddress = store.wallet.getTokenDepositAddress();
    const genesisRequest = {
      cashaddr: tokenAddress,
      amount: reserveAmount,
      value: tokenOutputValue,
      ...(createMintingNft.value ? { nft: { commitment: "", capability: NFTCapability.minting } } : {}),
    };
    const opreturnData = metadataOutput();
    const circulationOutput = new TokenSendRequest({
      cashaddr: tokenAddress,
      category,
      amount: circulatingAmount,
      value: tokenOutputValue,
    });
    const extraOutputs = [
      ...(circulatingAmount > 0n ? [circulationOutput] : []),
      ...(opreturnData ? [opreturnData] : []),
    ];
    return { genesisRequest, extraOutputs, linkedMetadata: opreturnData !== undefined };
  }

  // One genesis builds the whole issuer kit, confirmed first since it cannot be corrected afterwards
  async function createToken(){
    if (activeAction.value) return;
    const pickedCoin = genesisInput.value;
    const reserveAmount = hasSupply.value ? reserve.value : 0n;
    const circulatingAmount = hasSupply.value ? circulating.value : 0n;
    if (!pickedCoin || genesisProblem.value) return;
    if (reserveAmount === undefined || circulatingAmount === undefined) return;
    const confirmed = await confirmDialog(
      t('createTokens.confirm.title'),
      confirmMessage(reserveAmount, circulatingAmount),
      t('createTokens.confirm.button')
    );
    if (!confirmed) return;
    activeAction.value = 'creating';
    try{
      const { genesisRequest, extraOutputs, linkedMetadata } = genesisOutputs(pickedCoin.txid, reserveAmount, circulatingAmount);
      notifySending(t('createTokens.notifications.creatingTokens'));
      const { txId } = await store.spend.tokenGenesis(pickedCoin, genesisRequest, extraOutputs);
      // creation ends where management begins: the identity is listed and its AuthHead held back
      if (txId) await identitiesStore.listCreatedIdentity(pickedCoin.txid, txId);
      const linked = linkedMetadata ? checkedRegistry.value?.summary : undefined;
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

      <tokenCreated v-if="created" :created="created" @start-over="startOver()" />

      <template v-else>
      <tokenCreationChoice v-if="!homeConfirmed" @continue="homeConfirmed = true" />
      <div v-else class="chosen-line">
        <span>{{ t('createTokens.home.chosen') }}</span>
        <span class="go-back" @click="changeHome()">← {{ t('createTokens.goBack') }}</span>
      </div>

      <template v-if="homeConfirmed">
      <genesisInputPicker
        v-model="genesisInput"
        v-model:open="utxoStepOpen"
        :step-label="stepLabel(1, 3, stepTitle('utxo'))"
        :picked-label="t('createTokens.plannedTokenId')"
        :explainer="t('createTokens.genesisInput.explainer')"
        :prepare-message="t('createTokens.prepare.message', { amount: bchOf(preparedUtxoValue) })"
      >
        <div v-if="plannedCategory" class="planned-category">
          <TokenIcon :key="plannedCategory" :token-id="plannedCategory" :size="40" />
          <div class="copy-target" @click="copyToClipboard(plannedCategory)">
            <span class="description">{{ t('createTokens.plannedTokenId') }}</span>
            <span class="mono">{{ truncateHash(plannedCategory) }}</span>
            <img class="copyIcon" src="images/copyGrey.svg">
          </div>
        </div>
      </genesisInputPicker>
      <template v-if="utxoStepOpen">
        <div class="section step-label">{{ stepLabel(2, 3, stepTitle(shapeTitle)) }}</div>
        <div class="step-label" style="margin-top: 8px;">{{ stepLabel(3, 3, stepTitle('metadata')) }}</div>
      </template>

      <div v-if="!utxoStepOpen && shapeStepOpen" class="section">
        <div class="step-label open">{{ stepLabel(2, 3, stepTitle(shapeTitle)) }}</div>
        <label for="tokenShape">{{ t('createTokens.shapeLabel') }}</label>
        <select id="tokenShape" v-model="tokenShape">
          <option value="fungible">{{ t('createTokens.shapes.fungible') }}</option>
          <option value="mintingNft">{{ t('createTokens.shapes.mintingNft') }}</option>
          <option value="both">{{ t('createTokens.shapes.both') }}</option>
        </select>
        <div v-if="createMintingNft" class="description" style="margin-top: 4px;">{{ t('createTokens.mintingDescription') }}</div>
        <div v-if="createMintingNft" class="description" style="margin-top: 4px;">{{ t('createTokens.mintingNote') }}</div>

        <template v-if="hasSupply">
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

      <div v-if="!utxoStepOpen && !shapeStepOpen" class="section">
        <div class="step-label open">{{ stepLabel(3, 3, stepTitle('metadata')) }}</div>
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
        <div v-if="hasSupply" class="description" style="margin-top: 6px;">
          {{ t('createTokens.check.decimalsReminder', { decimals }) }}
        </div>
        <div class="description" style="margin-top: 4px;">{{ t('createTokens.locationHint') }}</div>
        <publicationLocations v-model="metadataUris">
          <span class="description">{{ t('createTokens.sameFile') }}</span>
        </publicationLocations>
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
        {{ stepLabel(3, 3, stepTitle('metadata')) }}
      </div>
      </template>
      </template>
    </fieldset>
  </div>
</template>

<style scoped>
.chosen-line {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.go-back {
  cursor: pointer;
}
label {
  display: block;
  margin-top: 14px;
  margin-bottom: 4px;
}
.genesis-problem {
  color: var(--color-error);
}
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
</style>
