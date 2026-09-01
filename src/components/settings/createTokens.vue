<script setup lang="ts">
  import { ref, computed, watch } from 'vue';
  import {
    publicationOutput,
    registryContentHash,
    registryUrlOf,
    summarizeRegistry,
  } from 'src/utils/tools/authchainIdentity';
  import { copyToClipboard, formatBchAmount } from 'src/utils/utils';
  import { outpointOf } from 'src/utils/wallet/reservedUtxos';
  import EmojiItem from '../general/emojiItem.vue';
  import TokenIcon from '../general/TokenIcon.vue';
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

  const selectedTokenType = ref("-select-");
  const inputFungibleSupply = ref("");
  const selectedUri = ref("-select-");
  const inputBcmr = ref("");
  const validityCheck = ref(undefined as boolean | undefined);
  const activeAction = ref<'creatingPreGenesis' | 'creatingFungibles' | 'creatingMintingNFT' | null>(null);

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

  // What the registry location becomes on chain, which is the form the identities page reads back
  function publishedUri() {
    if (selectedUri.value === "IPFS") return `ipfs://${inputBcmr.value}`;
    return inputBcmr.value;
  }

  // The genesis publishes the same output an update does, so it is built by the same code: one
  // module owns the format, and creating an identity cannot drift from maintaining one.
  async function getOpreturnData(){
    validityCheck.value = undefined;
    const inputField = inputBcmr.value;
    if(selectedUri.value == "-select-") return
    const validinput = selectedUri.value != "IPFS"? !inputField.startsWith("http"): inputField.startsWith("baf");
    if(!validinput){
      const errorMessage = selectedUri.value != "IPFS" ? t('createTokens.notifications.urlPrefixError') : t('createTokens.notifications.ipfsCidError');
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
      validityCheck.value = false;
      return
    }
    const uri = publishedUri();
    try{
      // fetched fresh rather than through the metadata cache: what is hashed has to be what the
      // host serves now, or the hash commits to something nobody can fetch
      const response = await fetch(registryUrlOf(uri, settingsStore.ipfsGateway), { cache: "no-store" });
      if(!response.ok) throw new Error(t('createTokens.notifications.bcmrUnreachable'));
      const bcmrContent = await response.text();

      // The planned category is known before the genesis is signed, so the wrong-file mistake can
      // be caught at the one moment it costs nothing: the registry has to name this identity.
      if(plannedCategory.value && !summarizeRegistry(bcmrContent, plannedCategory.value)){
        $q.notify({
          message: t('createTokens.notifications.bcmrWrongIdentity'),
          icon: 'warning',
          color: "red"
        })
        validityCheck.value = false;
        return
      }

      validityCheck.value = true;
      return publicationOutput(registryContentHash(bcmrContent), [uri]);
    } catch{
      validityCheck.value = false;
    }
  }
  
  async function createFungibles(){
    if (activeAction.value) return;
    const pickedCoin = genesisInput.value;
    if (!pickedCoin) return;
    const validInput = isValidBigInt(inputFungibleSupply.value) && +inputFungibleSupply.value > 0;
    function isValidBigInt(value:string) {
      try { return BigInt(value) }
      catch{ return false }
    }
    if(!validInput) throw new Error(`Input total supply must be a valid integer`)
    activeAction.value = 'creatingFungibles';
    try{
      const totalSupply = inputFungibleSupply.value;
      const opreturnData = await getOpreturnData();
      notifySending(t('createTokens.notifications.creatingTokens'));
      const genesisResponse = await store.spend.tokenGenesis(
        pickedCoin,
        {
          cashaddr: store.wallet.getTokenDepositAddress(),
          amount: BigInt(totalSupply),    // fungible token amount
          value: 1000n,                    // Satoshi value
        },
        opreturnData
      );
      const tokenId = genesisResponse?.categories?.[0];
      const { txId } = genesisResponse;
      const alertMessage = `Created ${totalSupply} fungible tokens of category ${tokenId}`;
      // reset input fields
      inputFungibleSupply.value = "";
      selectedTokenType.value  = "-select-";
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('createTokens.notifications.transactionSent'));
    } catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function createMintingNFT(){
    if (activeAction.value) return;
    const pickedCoin = genesisInput.value;
    if (!pickedCoin) return;
    activeAction.value = 'creatingMintingNFT';
    try{
      const opreturnData = await getOpreturnData();
      notifySending(t('createTokens.notifications.creatingMintingNft'));
      const genesisResponse = await store.spend.tokenGenesis(
        pickedCoin,
        {
          cashaddr: store.wallet.getTokenDepositAddress(),
          nft: {
            commitment: "",
            capability: "minting",
          },
          value: 1000n,
        },
        opreturnData
      );
      const tokenId = genesisResponse?.categories?.[0];
      const { txId } = genesisResponse;
      const alertMessage = `Created minting NFT with category ${tokenId}`;
      // reset input fields
      selectedTokenType.value  = "-select-";
      await handleTransactionBroadcastSuccess(alertMessage, txId, t('createTokens.notifications.transactionSent'));
    } catch(error){
      displayAndLogError(error)
    } finally {
      activeAction.value = null;
    }
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

      <label for="newtokens">{{ t('createTokens.selectTokenType') }}</label>
      <select name="newtokens" id="newtokens"  v-model="selectedTokenType" :disabled="!genesisInput">
        <option autocomplete="off" selected value="-select-">{{ t('createTokens.selectOption') }}</option>
        <option autocomplete="off" value="fungibles">{{ t('createTokens.fungibleTokens') }}</option>
        <option autocomplete="off" value="mintingNFT">{{ t('createTokens.mintingNFT') }}</option>
      </select>
      <br>
      <div v-if="selectedTokenType == '-select-'">
        <div>
        <b>{{ t('createTokens.fungibleTokens') }}</b> {{ t('createTokens.fungibleDescription') }} <br>
        <b>{{ t('createTokens.mintingNFT') }}</b> {{ t('createTokens.mintingDescription') }}
        </div>
        <div style="margin: 5px 0px;">
          <i>{{ t('createTokens.mintingNote') }}</i>
        </div>
      </div>
      <div v-if="selectedTokenType != '-select-'">
        <div v-if="selectedTokenType == 'fungibles'">
          {{ t('createTokens.supplyLabel') }}
          <input v-model="inputFungibleSupply" :placeholder="t('createTokens.supplyPlaceholder')" type="number">
          <i>{{ t('createTokens.supplyNote') }}</i>
          <br><br>
        </div>

        <details style="margin-bottom: 0.5em;">
          <summary style="display: list-item">{{ t('createTokens.linkMetadata') }}</summary>
          <i18n-t keypath="createTokens.metadataIntro" tag="span">
            <template #link>
              <a href="https://github.com/bitjson/chip-bcmr" target="_blank">{{ t('createTokens.bcmrStandard') }}</a>
            </template>
          </i18n-t>
          <br><br>

          <label for="selectUri">{{ t('createTokens.selectUploadLocation') }} </label>
          <select name="selectUri" v-model="selectedUri">
            <option value="-select-">{{ t('createTokens.selectPlaceholder') }}</option>
            <option value="IPFS">{{ t('createTokens.ipfs') }}</option>
            <option value="website">{{ t('createTokens.httpsWebsite') }}</option>
            <option value="github">{{ t('createTokens.httpsGithub') }}</option>
          </select>
          <div v-if="selectedUri == 'github'">
            If you have a GitHub account and know how to use git, you can easily host your BCMR on Github Gist, similar to 
              <a href="https://gist.github.com/mr-zwets/84b0057808af20df392815fb27d4a661" target="_blank">DogeCash</a>. <br>
            1) First add the static images like token icon and image to your gist by following <a href="https://gist.github.com/mroderick/1afdd71aa69f6b29601d335751a1a9be" target="_blank">these steps</a> or upload them to IPFS.<br>
            2) Then you can create the BCMR JSON file with the <a href="https://bcmr-generator.netlify.app/" target="_blank">BCMR generator</a> or
              with the <a href="https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.ts" target="_blank">BCMR-schema</a>.<br>
            3) Add the JSON file to your github gist.<br>
            4) Then press the "raw" button on your Github Gist and copy the url until <code>/raw</code> below. <br>
            The BCMR location together with the hash of its content will be stored on the blockchain.
            <input v-model="inputBcmr" @input="getOpreturnData" placeholder="gist.githubusercontent.com/mr-zwets/323c7786e2acf01e3c04a440d7cf6c2c/raw">
          </div>
          <div v-if="selectedUri == 'website'">
            1) First host the static images like token icon and image on your website or on IPFS.<br>
            2) Then you can create the BCMR JSON file with the <a href="https://bcmr-generator.netlify.app/" target="_blank">BCMR generator</a> or
              with the <a href="https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.ts" target="_blank">BCMR-schema</a>.<br>
            3) To host the JSON file on your own website, the recommended location for it is <code>/.well-known/bitcoin-cash-metadata-registry.json</code> 
                like <a href="https://otr.cash/.well-known/bitcoin-cash-metadata-registry.json" target="_blank">the OTR registry</a> does. <br>
            4) Enter the base url of your website (like 'yourtokenwebsite.com') below.  <br>
            The BCMR location together with the hash of its content will be stored on the blockchain.
            <input v-model="inputBcmr" @input="getOpreturnData" placeholder="yourtokenwebsite.com">
          </div>
          <div v-if="selectedUri == 'IPFS'">
            1) First upload (pin) your tokenIcon and image on IPFS. <br>
            2) Then, you can create the BCMR JSON file with the <a href="https://bcmr-generator.app/" target="_blank">BCMR generator</a> or
              with the <a href="https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.ts" target="_blank">BCMR-schema</a>.<br>
            3) Upload the BCMR JSON file to IPFS.<br>
            4) Enter the IPFS location of your BCMR json file (version 1 CID starting with <code>baf...</code>) below. <br>
            The BCMR location together with the hash of its content will be stored on the blockchain.
            <input v-model="inputBcmr" @input="getOpreturnData" placeholder="bafkreiaqpmlrtsdf5cvwgh46mpyric2r44ikqzqgtevny74qdmrjc5dkxy">
          </div><br>
          <b>{{ t('createTokens.validityCheck') }}
            <EmojiItem v-if="validityCheck != undefined" :emoji="validityCheck ? '✅':'❌'" style="vertical-align: baseline;"/>
            <span v-else>...</span>
          </b>
        </details>
        <div style="margin: 15px 0px;">
          <b>{{ t('createTokens.metadataNote') }}</b>
        </div>
        <input @click="() => selectedTokenType == 'fungibles' ? createFungibles() : createMintingNFT()" type="button" class="primaryButton" :value="activeAction === 'creatingFungibles' ? t('createTokens.creatingTokensButton') : (activeAction === 'creatingMintingNFT' ? t('createTokens.creatingNftButton') : t('createTokens.createButton'))" style="margin: 8px 0;" :disabled="activeAction !== null">
      </div>
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
