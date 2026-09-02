<script setup lang="ts">
  import { ref, computed } from 'vue';
  import {
    fetchCandidateRegistry,
    maxPublicationOutputSize,
    publicationOutput,
    publicationOutputSize,
    summarizeRegistry,
  } from 'src/utils/tools/authchainIdentity';
  import { copyToClipboard, formatBchAmount } from 'src/utils/utils';
  import { NFTCapability, TokenSendRequest } from 'mainnet-js';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import TokenIcon from '../general/TokenIcon.vue';
  import InfoPopup from '../general/InfoPopup.vue';
  import { displayAndLogError } from 'src/utils/errorHandling';
  import { notifySending, handleTransactionBroadcastSuccess } from 'src/utils/txHelpers';
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
  // What the token is, rather than a supply field and a toggle the user has to combine into one
  const tokenShape = ref<'fungible' | 'mintingNft' | 'both'>('fungible');
  const createMintingNft = computed(() => tokenShape.value !== 'fungible');
  const hasSupply = computed(() => tokenShape.value !== 'mintingNft');
  const metadataUris = ref<string[]>([""]);
  const activeAction = ref<'creatingPreGenesis' | 'creating' | null>(null);

  // The satoshis each token output of the genesis carries, the AuthHead included
  const tokenOutputValue = 1000n;

  const bchDisplayUnit = computed(() => store.network === 'mainnet' ? 'BCH' : 'tBCH');
  const bchOf = (satoshis: bigint) => `${formatBchAmount(Number(satoshis), false, 8)} ${bchDisplayUnit.value}`;
  const truncateHash = (hash: string) => `${hash.slice(0, 16)}...${hash.slice(-8)}`;

  // A new token's category is the txid of the coin its genesis spends, so which coin that is
  // decides the identity's id and its icon before anything exists.
  const genesisCandidates = computed(() => {
    if (!store.spendableUtxos) return undefined;
    const eligible = store.spendableUtxos.filter(utxo => !utxo.token && utxo.vout === 0);
    // safe to sort in place, the array is a fresh result of filter()
    return eligible.sort((left, right) => Number(right.satoshis - left.satoshis));
  });

  // Held as an outpoint and resolved against the current coins, so a coin spent from somewhere
  // else leaves the list and takes the selection with it
  const pickedOutpoint = ref<string | undefined>(undefined);
  const genesisInput = computed(() =>
    genesisCandidates.value?.find(utxo => outpointOf(utxo) === pickedOutpoint.value)
  );
  const plannedCategory = computed(() => genesisInput.value?.txid);

  // Amounts are whole token units here: the decimals live in the metadata, which does not exist
  // yet at creation time
  function parseAmount(value: string): bigint | undefined {
    if (!value.trim()) return 0n;
    try {
      const amount = BigInt(value);
      return amount >= 0n ? amount : undefined;
    } catch {
      return undefined;
    }
  }

  // A category's fungible supply is capped at the largest signed 64-bit integer
  const maxTokenSupply = 9223372036854775807n;

  const totalSupply = computed(() => parseAmount(inputFungibleSupply.value));
  const circulating = computed(() => parseAmount(inputCirculating.value));
  // What the AuthHead keeps: supply the wallet holds out of circulation, alongside the authority
  const reserve = computed(() => {
    if (totalSupply.value === undefined || circulating.value === undefined) return undefined;
    return totalSupply.value - circulating.value;
  });

  // The genesis is the one transaction that cannot be corrected afterwards, so what it refuses is
  // said before the button is pressed rather than by a failed broadcast.
  const genesisProblem = computed(() => {
    if (!hasSupply.value) return undefined;
    const supply = totalSupply.value;
    const issued = circulating.value;
    if (supply === undefined || issued === undefined) return t('createTokens.errors.invalidAmount');
    if (supply > maxTokenSupply) return t('createTokens.errors.overMaxSupply', { max: maxTokenSupply.toString() });
    if (issued > supply) return t('createTokens.errors.overSupply');
    return undefined;
  });

  // A token output carrying neither an amount nor an NFT is invalid, so the identity output has
  // to keep something. A limit of the transaction rather than a mistake, hence a note, not an error.
  const reserveNote = computed(() => {
    if (!hasSupply.value || createMintingNft.value) return undefined;
    if (!totalSupply.value || circulating.value !== totalSupply.value) return undefined;
    return t('createTokens.reserveNote');
  });

  // A coin a genesis can spend is an ordinary one sitting at output 0, which a send to self makes
  async function createPreGenesis(){
    if (activeAction.value) return;
    activeAction.value = 'creatingPreGenesis';
    try{
      const walletAddr = store.wallet.getDepositAddress();
      notifySending(t('createTokens.notifications.preparingPreGenesis'));
      const { txId } = await store.spend.send([{ cashaddr: walletAddr, value: 10000n }]);
      $q.notify({
        type: 'positive',
        message: t('createTokens.notifications.transactionSent')
      })
      console.log(`Created valid pre-genesis for token creation \n${store.explorerUrl}/${txId}`);
      // update utxo list
      await store.updateWalletUtxos();
      // the coin the user just asked for is the one they meant to create with
      if (txId) pickedOutpoint.value = `${txId}:0`;
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }

  const filledUris = computed(() => metadataUris.value.map(uri => uri.trim()).filter(uri => uri.length));

  const publicationBytesLeft = computed(() =>
    maxPublicationOutputSize - publicationOutputSize(filledUris.value)
  );

  function addUriRow() {
    metadataUris.value = [...metadataUris.value, ""];
  }

  function removeUriRow(index: number) {
    metadataUris.value = metadataUris.value.filter((_, rowIndex) => rowIndex !== index);
    if (!metadataUris.value.length) metadataUris.value = [""];
  }

  // Verified by the same code an update's publication is. Checking that the file names this
  // identity is only possible before signing because the category is known in advance.
  async function metadataOutput(category: string) {
    if (!filledUris.value.length) return undefined;
    if (publicationBytesLeft.value < 0) throw new Error(t('identities.publish.errors.tooLarge'));
    const candidate = await fetchCandidateRegistry(filledUris.value, settingsStore.ipfsGateway);
    if (!summarizeRegistry(candidate.content, category)) {
      throw new Error(t('createTokens.notifications.bcmrWrongIdentity'));
    }
    return publicationOutput(candidate.hash, filledUris.value);
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
    activeAction.value = 'creating';
    try{
      const opreturnData = await metadataOutput(pickedCoin.txid);
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
      const category = genesisResponse?.categories?.[0] ?? pickedCoin.txid;
      const alertMessage = creationSummary(category, reserveAmount);
      // reset input fields
      inputFungibleSupply.value = "";
      inputCirculating.value = "";
      tokenShape.value = 'fungible';
      metadataUris.value = [""];
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('createTokens.notifications.transactionSent'));
      // creation ends where management begins: the identity is listed and its AuthHead held back
      if (txId) await identitiesStore.listCreatedIdentity(pickedCoin.txid, txId, tokenOutputValue);
    } catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }

  // What was just made, for the dialog that reports it
  function creationSummary(category: string, reserveAmount: bigint) {
    const supply = inputFungibleSupply.value;
    const lines: string[] = [];
    if (!hasSupply.value) {
      lines.push(t('createTokens.created.mintingNft', { category }));
    } else if (createMintingNft.value) {
      lines.push(t('createTokens.created.hybrid', { supply, category }));
    } else {
      lines.push(t('createTokens.created.fungibles', { supply, category }));
    }
    if (reserveAmount > 0n && reserveAmount !== totalSupply.value) {
      lines.push(t('createTokens.created.reserve', { amount: reserveAmount.toString() }));
    }
    lines.push(t('createTokens.created.listed'));
    return lines.join('\n');
  }
</script>

<template>
  <div>
    <fieldset class="item">
      <legend>{{ t('createTokens.title') }}</legend>
      <div>
        <i18n-t keypath="createTokens.intro" tag="span">
          <template #link>
            <a :href="store.network == 'mainnet'? 'https://cashtokens.studio/': 'https://chipnet.cashtokens.studio/'" target="_blank">{{ t('createTokens.cashTokensStudio') }}</a>
          </template>
        </i18n-t>
      </div>

      <div v-if="store.spendableBalance === 0n" style="color: red; margin-top: 15px;">{{ t('createTokens.needBch') }}</div>

      <!-- Which coin the genesis spends decides the token's permanent id, which is the whole of
           what this section is, so it leads with that rather than with a heading repeating it -->
      <div class="section">
        <div class="description">{{ t('createTokens.step', { current: 1, total: 3 }) }}</div>
        <div>{{ t('createTokens.genesisInput.explainer') }}</div>

        <!-- Preparing a coin is a step towards creating rather than the page's action, so it
             takes the ordinary button and leaves the primary one to Create -->
        <input
          @click="createPreGenesis"
          type="button"
          :value="activeAction === 'creatingPreGenesis' ? t('createTokens.preparingButton') : t('createTokens.genesisInput.prepareButton')"
          :disabled="activeAction !== null"
          style="margin-top: 10px;"
        >

        <!-- Which of your coins becomes a token's id is a question nearly nobody needs asked, so
             it waits behind a disclosure for whoever wants a particular id or one fewer fee -->
        <details style="margin-top: 10px;">
          <summary style="display: list-item">{{ t('createTokens.genesisInput.chooseExisting') }}</summary>
          <div v-if="genesisCandidates === undefined" class="description">{{ t('createTokens.loading') }}</div>
          <template v-else>
            <div v-if="!genesisCandidates.length" class="description">{{ t('createTokens.genesisInput.none') }}</div>
            <div v-else class="coin-list">
              <div
                v-for="coin in genesisCandidates"
                :key="outpointOf(coin)"
                class="coin-row"
                :class="{ picked: outpointOf(coin) === pickedOutpoint }"
                @click="pickedOutpoint = outpointOf(coin)"
              >
                <TokenIcon :token-id="coin.txid" :size="24" />
                <span class="mono">{{ truncateHash(coin.txid) }}</span>
                <span>{{ bchOf(coin.satoshis) }}</span>
              </div>
            </div>
          </template>
        </details>

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

      <!-- The fields stay usable before a coin exists: deciding what to make does not depend on
           which coin makes it, and Create says what is still missing -->
      <div class="section">
        <div class="description">{{ t('createTokens.step', { current: 2, total: 3 }) }}</div>
        <label for="tokenShape">
          {{ t('createTokens.shapeLabel') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('createTokens.mintingHelp') }}</div>
            <div class="info-popup-note" style="max-width: 300px;">{{ t('createTokens.mintingDescription') }}</div>
          </InfoPopup>
        </label>
        <select id="tokenShape" v-model="tokenShape">
          <option value="fungible">{{ t('createTokens.shapes.fungible') }}</option>
          <option value="mintingNft">{{ t('createTokens.shapes.mintingNft') }}</option>
          <option value="both">{{ t('createTokens.shapes.both') }}</option>
        </select>
        <div v-if="createMintingNft" class="description" style="margin-top: 6px;">{{ t('createTokens.mintingNote') }}</div>

        <template v-if="hasSupply">
        <label for="supply">
          {{ t('createTokens.supplyLabel') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('createTokens.supplyHelp') }}</div>
            <div class="info-popup-note" style="max-width: 300px;">{{ t('createTokens.supplyNote') }}</div>
          </InfoPopup>
        </label>
        <input
          id="supply"
          v-model="inputFungibleSupply"
          :placeholder="t('createTokens.supplyPlaceholder')"
          type="number"
        >

        <label for="circulating">
          {{ t('createTokens.circulation.label') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('createTokens.circulation.help') }}</div>
          </InfoPopup>
        </label>
        <input
          id="circulating"
          v-model="inputCirculating"
          :placeholder="t('createTokens.circulation.placeholder')"
          type="number"
        >
        <div v-if="totalSupply && reserve !== undefined && reserve >= 0n" style="margin-top: 6px;">
          {{ t('createTokens.circulation.split', { reserve: reserve.toString(), circulating: circulating?.toString() }) }}
        </div>
        <div v-if="reserveNote" class="description" style="margin-top: 6px;">{{ reserveNote }}</div>
        </template>
      </div>

      <div class="section">
        <div class="description">{{ t('createTokens.step', { current: 3, total: 3 }) }}</div>
        <details style="margin-top: 6px;">
          <summary style="display: list-item">{{ t('createTokens.linkMetadata') }}</summary>
          <!-- The numbers already say these are steps in order, so an icon beside each one is a
               second signpost for the same thing -->
          <ol class="walkthrough">
            <li>
              <i18n-t keypath="createTokens.steps.author" tag="span">
                <template #generator>
                  <a href="https://bcmr-generator.app/" target="_blank">BCMR generator</a>
                </template>
              </i18n-t>
            </li>
            <li>{{ t('createTokens.steps.host') }}</li>
            <li>{{ t('createTokens.steps.verify') }}</li>
            <li>{{ t('createTokens.steps.create') }}</li>
          </ol>
          <div class="description" style="margin-top: 8px;">{{ t('identities.publish.locationsHint') }}</div>
          <div v-for="(uri, index) in metadataUris" :key="index" class="publish-uri-row">
            <input v-model="metadataUris[index]" :placeholder="t('identities.publish.uriPlaceholder')">
            <span
              v-if="metadataUris.length > 1"
              class="remove-uri"
              @click="removeUriRow(index)"
            >{{ t('identities.publish.removeLocation') }}</span>
          </div>
          <div class="publish-uri-actions">
            <button @click="addUriRow()">{{ t('identities.publish.addLocation') }}</button>
            <span class="description" :class="{ 'over-budget': publicationBytesLeft < 0 }">
              {{ t('identities.publish.bytesLeft', { bytes: publicationBytesLeft }) }}
            </span>
          </div>
        </details>
        <!-- Reassurance that there is nothing to be stuck on, which is an aside rather than
             something to stop at, so it is a line and not a box -->
        <div class="description" style="margin-top: 10px;">{{ t('createTokens.metadataNote') }}</div>
      </div>

      <div v-if="genesisInput && genesisProblem" class="genesis-problem" style="margin-top: 15px;">{{ genesisProblem }}</div>
      <!-- A disabled Create with nothing said would leave the missing piece to be guessed at -->
      <div v-else-if="!genesisInput" class="description" style="margin-top: 15px;">{{ t('createTokens.genesisInput.needCoin') }}</div>
      <input
        @click="createToken"
        type="button"
        class="primaryButton"
        :value="activeAction === 'creating' ? t('createTokens.creatingTokensButton') : t('createTokens.createButton')"
        style="margin: 10px 0 4px;"
        :disabled="activeAction !== null || !genesisInput || genesisProblem !== undefined"
      >
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
/* the page's three questions are numbered the way the flipstarter tool numbers its steps,
   rather than carrying a heading in bold over each of them */
.section {
  margin-top: 20px;
}
label {
  display: block;
  margin-top: 14px;
  margin-bottom: 4px;
}
/* long lists stay a list rather than pushing the form off the screen */
.coin-list {
  max-height: 220px;
  overflow-y: auto;
  margin: 8px 0;
}
.coin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.coin-row:hover {
  border-color: rgba(128, 128, 128, 0.4);
}
.coin-row.picked {
  border-color: var(--color-primary);
}
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
.remove-uri {
  cursor: pointer;
  color: grey;
}
/* what will not relay reads as an error rather than as one more grey number */
.over-budget {
  color: var(--color-error);
}
.minting-option {
  margin-top: 12px;
}
.genesis-problem {
  color: var(--color-error);
}
.planned-category {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.copy-target {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
