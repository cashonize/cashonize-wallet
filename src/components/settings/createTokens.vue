<script setup lang="ts">
  import { ref, computed } from 'vue';
  import { OpReturnData, sha256, utf8ToBin } from "mainnet-js"
  import { copyToClipboard } from 'src/utils/utils';
  import alertDialog from 'src/components/general/alertDialog.vue'
  import EmojiItem from '../general/emojiItem.vue';
    import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { cachedFetch } from 'src/utils/cacheUtils';
  import { useI18n } from 'vue-i18n'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const selectedTokenType = ref("-select-");
  const inputFungibleSupply = ref("");
  const selectedUri = ref("-select-");
  const inputBcmr = ref("");
  const validitityCheck = ref(undefined as boolean | undefined);
  const displayPlannedTokenId = computed(() =>
    store.plannedTokenId? `${store.plannedTokenId.slice(0, 20)}...${store.plannedTokenId.slice(-8)}` : ""
  );
  const activeAction = ref<'creatingPreGenesis' | 'creatingFungibles' | 'creatingMintingNFT' | null>(null);

  async function createPreGenesis(){
    if (activeAction.value) return;
    activeAction.value = 'creatingPreGenesis';
    try{
      store.plannedTokenId = undefined;
      const walletAddr = store.wallet.getDepositAddress();
      $q.notify({
        spinner: true,
        message: t('createTokens.notifications.preparingPreGenesis'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([{ cashaddr: walletAddr, value: 10000n }]);
      $q.notify({
        type: 'positive',
        message: t('createTokens.notifications.transactionSent')
      })
      console.log(`Created valid pre-genesis for token creation \n${store.explorerUrl}/${txId}`);
      store.plannedTokenId = txId;
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }

  async function getOpreturnData(){
    validitityCheck.value = undefined;
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
      validitityCheck.value = false;
      return
    }
    const defaultBcmrLocation = "/.well-known/bitcoin-cash-metadata-registry.json"
    const bcmrLocation = (selectedUri.value === "website" && !inputField.endsWith(".json"))? defaultBcmrLocation : ""
    const fetchLocation = selectedUri.value != "IPFS" ? "https://" + inputField + bcmrLocation : settingsStore.ipfsGateway + inputField;
    try{
      console.log("fetching bcmr at "+fetchLocation);
      const response = await cachedFetch(fetchLocation);
      const bcmrContent = await response.text();
      JSON.parse(bcmrContent)
      validitityCheck.value = true;
      const hashContent = sha256.hash(utf8ToBin(bcmrContent));
      const bcmrUri = selectedUri.value != "IPFS" ? inputField : "ipfs://" + inputField;
      const chunks = ["BCMR", hashContent, bcmrUri];
      return OpReturnData.fromArray(chunks);
    } catch{
      validitityCheck.value = false;
    }
  }
  
  async function createFungibles(){
    if (activeAction.value) return;
    const validInput = isValidBigInt(inputFungibleSupply.value) && +inputFungibleSupply.value > 0;
    function isValidBigInt(value:string) {
      try { return BigInt(value) }
      catch{ return false }
    }
    if(!validInput) throw(`Input total supply must be a valid integer`)
    activeAction.value = 'creatingFungibles';
    try{
      const totalSupply = inputFungibleSupply.value;
      const opreturnData = await getOpreturnData();
      $q.notify({
        spinner: true,
        message: t('createTokens.notifications.creatingTokens'),
        color: 'grey-5',
        timeout: 1000
      })
      const genesisResponse = await store.wallet.tokenGenesis(
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
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('createTokens.notifications.transactionSent')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // reset input fields
      inputFungibleSupply.value = "";
      selectedTokenType.value  = "-select-";
      // update utxo list
      await store.updateWalletUtxos()
      store.hasPreGenesis()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }
  async function createMintingNFT(){
    if (activeAction.value) return;
    activeAction.value = 'creatingMintingNFT';
    try{
      const opreturnData = await getOpreturnData();
      $q.notify({
        spinner: true,
        message: t('createTokens.notifications.creatingMintingNft'),
        color: 'grey-5',
        timeout: 1000
      })
      const genesisResponse = await store.wallet.tokenGenesis(
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
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId }
        }
      })
       $q.notify({
        type: 'positive',
        message: t('createTokens.notifications.transactionSent')
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      // reset input fields
      selectedTokenType.value  = "-select-";
      // update utxo list
      await store.updateWalletUtxos()
      store.hasPreGenesis()
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      handleTransactionError(error)
    } finally {
      activeAction.value = null;
    }
  }

  function handleTransactionError(error: unknown){
    const errorMessage = caughtErrorToString(error)
    console.error(errorMessage)
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    }) 
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

      <div v-if="store.balance === 0n" style="color: red;">{{ t('createTokens.needBch') }}</div>
      <div style="margin-bottom: 1em;">
        <div v-if="store.plannedTokenId == ''">
          {{ t('createTokens.noUtxos') }} <br>
          {{ t('createTokens.prepareUtxo') }}
          <input
            @click="createPreGenesis"
            type="button"
            class="primaryButton"
            :value="activeAction === 'creatingPreGenesis' ? t('createTokens.preparingButton') : t('createTokens.prepareButton')"
            :disabled="activeAction !== null"
            style="margin-top: 8px;"
          >
        </div>
        <div v-else>
           {{ t('createTokens.plannedTokenId') }}
          <span v-if="store.plannedTokenId == undefined">{{ t('createTokens.loading') }}</span>
          <span v-if="store.plannedTokenId" @click="copyToClipboard(store.plannedTokenId)" style="cursor: pointer;">
            <span class="tokenId"> {{ displayPlannedTokenId }} </span>
            <img class="copyIcon icon" src="images/copyGrey.svg">
          </span>
        </div>
      </div>

      <label for="newtokens">{{ t('createTokens.selectTokenType') }}</label>
      <select name="newtokens" id="newtokens"  v-model="selectedTokenType" :disabled="!store.plannedTokenId">
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
            <EmojiItem v-if="validitityCheck != undefined" :emoji="validitityCheck ? '✅':'❌'" style="vertical-align: baseline;"/>
            <span v-else>...</span>
          </b>
        </details>
        <div style="margin: 15px 0px;">
          <b>{{ t('createTokens.metadataNote') }}</b>
        </div>
        <input @click="() => selectedTokenType == 'fungibles' ? createFungibles() : createMintingNFT()" type="button" class="primaryButton" :value="activeAction === 'creatingFungibles' ? t('createTokens.creatingTokensButton') : (activeAction === 'creatingMintingNFT' ? t('createTokens.creatingNftButton') : t('createTokens.createButton'))" style="margin: 8px 0;" :disabled="activeAction !== null">
      </div>
    </fieldset>
</div></template>