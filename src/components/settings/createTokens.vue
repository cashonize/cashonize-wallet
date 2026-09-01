<script setup lang="ts">
  import { ref, computed, watch } from 'vue';
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
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useI18n } from 'vue-i18n'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const inputFungibleSupply = ref("");
  const inputCirculating = ref("");
  const createMintingNft = ref(false);
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

  watch(genesisCandidates, (candidates) => {
    if (genesisInput.value) return;
    const firstCandidate = candidates?.[0];
    pickedOutpoint.value = firstCandidate ? outpointOf(firstCandidate) : undefined;
  }, { immediate: true });

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
    const supply = totalSupply.value;
    const issued = circulating.value;
    if (supply === undefined || issued === undefined) return t('createTokens.errors.invalidAmount');
    if (issued > supply) return t('createTokens.errors.overSupply');
    if (supply === 0n && !createMintingNft.value) return t('createTokens.errors.nothingToCreate');
    if (issued === supply && !createMintingNft.value) return t('createTokens.errors.emptyAuthhead');
    return undefined;
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
    const reserveAmount = reserve.value;
    const circulatingAmount = circulating.value;
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
      createMintingNft.value = false;
      metadataUris.value = [""];
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('createTokens.notifications.transactionSent'));
      // creation ends where management begins: the identity is listed and its AuthHead held back
      if (txId) await store.listCreatedIdentity(pickedCoin.txid, txId, tokenOutputValue);
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
    if (!totalSupply.value) {
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
        <br><br>
      </div>

      <div v-if="store.spendableBalance === 0n" style="color: red;">{{ t('createTokens.needBch') }}</div>
      <div class="genesis-input">
        <b>{{ t('createTokens.genesisInput.title') }}</b>
        <div class="description">{{ t('createTokens.genesisInput.explainer') }}</div>

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
              <span class="description">{{ bchOf(coin.satoshis) }}</span>
            </div>
          </div>
          <span class="action-link" @click="createPreGenesis">
            {{ activeAction === 'creatingPreGenesis' ? t('createTokens.preparingButton') : t('createTokens.genesisInput.prepareLink') }}
          </span>
        </template>

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

      <div class="token-shape">
        <label for="supply">
          {{ t('createTokens.supplyLabel') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('createTokens.supplyHelp') }}</div>
          </InfoPopup>
        </label>
        <input
          id="supply"
          v-model="inputFungibleSupply"
          :placeholder="t('createTokens.supplyPlaceholder')"
          :disabled="!genesisInput"
          type="number"
        >
        <div class="description">{{ t('createTokens.supplyNote') }}</div>

        <template v-if="totalSupply">
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
          <div v-if="reserve !== undefined && reserve >= 0n" class="description">
            {{ t('createTokens.circulation.split', { reserve: reserve.toString(), circulating: circulating?.toString() }) }}
          </div>
        </template>

        <div class="minting-option">
          {{ t('createTokens.mintingNFT') }}
          <InfoPopup>
            <div style="max-width: 300px;">{{ t('createTokens.mintingHelp') }}</div>
          </InfoPopup>
          <q-toggle v-model="createMintingNft" :disable="!genesisInput" dense />
        </div>
        <div class="description">{{ t('createTokens.mintingDescription') }}</div>
        <div class="description"><i>{{ t('createTokens.mintingNote') }}</i></div>
      </div>

      <details style="margin-bottom: 0.5em;">
          <summary style="display: list-item">{{ t('createTokens.linkMetadata') }}</summary>
          <ol class="walkthrough">
            <li>
              <q-icon name="edit" size="18px" />
              <i18n-t keypath="createTokens.steps.author" tag="span">
                <template #generator>
                  <a href="https://bcmr-generator.app/" target="_blank">BCMR generator</a>
                </template>
              </i18n-t>
            </li>
            <li>
              <q-icon name="archive" size="18px" />
              <span>{{ t('createTokens.steps.host') }}</span>
            </li>
            <li>
              <q-icon name="check_circle" size="18px" />
              <span>{{ t('createTokens.steps.verify') }}</span>
            </li>
            <li>
              <q-icon name="add_circle" size="18px" />
              <span>{{ t('createTokens.steps.create') }}</span>
            </li>
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
            <span class="action-link" @click="addUriRow()">{{ t('identities.publish.addLocation') }}</span>
            <span class="description" :class="{ 'over-budget': publicationBytesLeft < 0 }">
              {{ t('identities.publish.bytesLeft', { bytes: publicationBytesLeft }) }}
            </span>
          </div>
      </details>
      <div class="description" style="margin: 15px 0px;">{{ t('createTokens.metadataNote') }}</div>
      <div v-if="genesisInput && genesisProblem" class="genesis-problem">{{ genesisProblem }}</div>
      <input
        @click="createToken"
        type="button"
        class="primaryButton"
        :value="activeAction === 'creating' ? t('createTokens.creatingTokensButton') : t('createTokens.createButton')"
        style="margin: 8px 0;"
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
.genesis-input {
  margin-bottom: 1em;
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
.action-link {
  color: var(--color-primary);
  cursor: pointer;
}
.token-shape {
  margin-bottom: 1em;
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
.walkthrough li .q-icon {
  flex: none;
  align-self: center;
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
