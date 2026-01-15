<script setup lang="ts">
  import { ref, computed } from 'vue';
  import { OpReturnData, sha256, utf8ToBin } from "mainnet-js"
  import { copyToClipboard } from 'src/utils/utils';
  import alertDialog from 'src/components/alertDialog.vue'
  import EmojiItem from './general/emojiItem.vue';
  import { type TokeneGenesisRequestParams } from 'src/interfaces/interfaces';
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useStore } from '../stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { cachedFetch } from 'src/utils/cacheUtils';
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

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
      const walletAddr = store.wallet.cashaddr;
      $q.notify({
        spinner: true,
        message: 'Preparing pre-genesis...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([{ cashaddr: walletAddr, value: 10000, unit: "sat" }]);
      $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
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
      const errorMessage = selectedUri.value != "IPFS" ? "Urls should not have any prefix!" : "Ipfs location should be a v1 CID";
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
        message: 'Creating tokens...',
        color: 'grey-5',
        timeout: 1000
      })
      const genesisResponse = await store.wallet.tokenGenesis(
        {
          cashaddr: store.wallet.tokenaddr,
          amount: BigInt(totalSupply),    // fungible token amount
          value: 1000,                    // Satoshi value
        } as TokeneGenesisRequestParams,
        opreturnData
      );
      const tokenId = genesisResponse?.tokenIds?.[0];
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
        message: 'Transaction succesfully sent!'
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
        message: 'Creating minting NFT...',
        color: 'grey-5',
        timeout: 1000
      })
      const genesisResponse = await store.wallet.tokenGenesis(
        {
          cashaddr: store.wallet.tokenaddr,
          commitment: "",
          capability: "minting",
          value: 1000,
        } as TokeneGenesisRequestParams,
        opreturnData
      );
      const tokenId = genesisResponse?.tokenIds?.[0];
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
        message: 'Transaction succesfully sent!'
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
      <legend>Create new tokens</legend>
      <div>
        You can use the <a :href="store.network == 'mainnet'? 'https://cashtokens.studio/': 'https://chipnet.cashtokens.studio/'" target="_blank">CashTokens Studio</a> 
        for the easiest token creation, or you can use the built-in process below for fine-grained control. <br><br>
      </div>

      <div v-if="store.balance?.bch === 0" style="color: red;">Need BCH in wallet to create tokens</div>
      <div style="margin-bottom: 1em;">
        <div v-if="store.plannedTokenId == ''">
          Currently the wallet does not have any UTXOs capable of token creation. <br>
          Prepare a UTXO for token-creation:
          <input
            @click="createPreGenesis"
            type="button"
            class="primaryButton"
            :value="activeAction === 'creatingPreGenesis' ? 'Preparing...' : 'Prepare UTXO'"
            :disabled="activeAction !== null"
            style="margin-top: 8px;"
          >
        </div>
        <div v-else>
           Planned tokenId:
          <span v-if="store.plannedTokenId == undefined">loading...</span>
          <span v-if="store.plannedTokenId" @click="copyToClipboard(store.plannedTokenId)" style="cursor: pointer;">
            <span class="tokenId"> {{ displayPlannedTokenId }} </span>
            <img class="copyIcon icon" src="images/copyGrey.svg">
          </span>
        </div> 
      </div>

      <label for="newtokens">Select token-type:</label>
      <select name="newtokens" id="newtokens"  v-model="selectedTokenType" :disabled="!store.plannedTokenId">
        <option autocomplete="off" selected value="-select-">-select-</option>
        <option autocomplete="off" value="fungibles">Fungible Tokens</option>
        <option autocomplete="off" value="mintingNFT">Minting NFT</option>
      </select>
      <br>
      <div v-if="selectedTokenType == '-select-'">
        <div>
        <b>Fungible Tokens</b> is used to create interchangeable tokens. The total supply of fungible tokens needs to be
        determined at creation. <br>
        <b>Minting NFT</b> is used to create an NFT collection. The minting NFT has the ability to mint new NFTs with the
        same tokenId.
        </div>
        <div style="margin: 5px 0px;">
          <i>Note:</i> to use a Minting NFT toggle the option "Enable mint NFTs" in the developer settings.
        </div>
      </div>
      <div v-if="selectedTokenType != '-select-'">
        <div v-if="selectedTokenType == 'fungibles'">
          Choose the total supply of fungible tokens
          <input v-model="inputFungibleSupply" placeholder="total supply" type="number">
          <i>note:</i> add extra zeroes for the number of decimals set in the BCMR metadata
          <br><br>
        </div>

        <details style="margin-bottom: 0.5em;">
          <summary style="display: list-item">Link Token-Metadata</summary>
          To add metadata to your token you need to upload the token image(s), create a JSON file following the 
          <a href="https://github.com/bitjson/chip-bcmr" target="_blank">BCMR-standard</a>, upload it somewhere and then post that link on-chain. <br><br>
    
          <label for="selectUri">Select where to upload your metadata (IPFS recommended): </label>
          <select name="selectUri" v-model="selectedUri">
            <option value="-select-">- select -</option>
            <option value="IPFS">IPFS</option>
            <option value="website">HTTPS: own website</option>
            <option value="github">HTTPS: github gist</option>
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
          <b>Validity check metadata:
            <EmojiItem v-if="validitityCheck != undefined" :emoji="validitityCheck ? '✅':'❌'" style="vertical-align: baseline;"/>
            <span v-else>...</span>
          </b>
        </details>
        <div style="margin: 15px 0px;">
          <b>Note:</b> Token metadata can still be added/updated after creation with the token's AuthUTXO.
          To use this functionality toggle "Enable authchain resolution" in the developer settings.
          Transfer the AuthUTXO to a dedicated wallet right after creation.
        </div>
        <input @click="() => selectedTokenType == 'fungibles' ? createFungibles() : createMintingNFT()" type="button" class="primaryButton" :value="activeAction === 'creatingFungibles' ? 'Creating Tokens...' : (activeAction === 'creatingMintingNFT' ? 'Creating NFT...' : 'Create')" style="margin: 8px 0;" :disabled="activeAction !== null">
      </div>
    </fieldset>
</div></template>