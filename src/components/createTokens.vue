<script setup lang="ts">
  import { ref, computed } from 'vue';
  import { OpReturnData, sha256, utf8ToBin } from "mainnet-js"
  import { useStore } from '../stores/store'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()

  const selectedTokenType = ref("-select-");
  const inputFungibleSupply = ref("");
  const selectedUri = ref("-select-");
  const inputBcmr = ref("");
  const validitityCheck = ref(false);
  const displayPlannedTokenId = computed(() => store.plannedTokenId? `${store.plannedTokenId.slice(0, 20)}...${store.plannedTokenId.slice(-10)}`:"");

  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    $q.notify({
        message: "Copied!",
        icon: 'info',
        timeout : 1000,
        color: "grey-6"
      })
  }

  async function hasPreGenesis(){
    store.plannedTokenId = undefined;
    const walletUtxos = await store.wallet?.getAddressUtxos();;
    const preGenesisUtxo = walletUtxos?.find(utxo => !utxo.token && utxo.vout === 0);
    store.plannedTokenId = preGenesisUtxo?.txid ?? "";
  }
  async function createPreGenesis(){
    if(!store.wallet) return;
    try{
      store.plannedTokenId = undefined;
      const walletAddr = store.wallet.address as string;
      const { txId } = await store.wallet.send([{ cashaddr: walletAddr, value: 10000, unit: "sat" }]);
      console.log(`Created valid preGenesis for token creation \n${store.explorerUrl}/tx/${txId}`);
      let walletUtxos = await store.wallet.getAddressUtxos();
      const createdPreGenesis = walletUtxos.find(utxo => !utxo.token && utxo.vout === 0);
      store.plannedTokenId = createdPreGenesis?.txid;
    } catch(error){
      console.log(error)
    }
  }

  async function getOpreturnData(){
    const inputField = inputBcmr.value;
    let validinput = selectedUri.value != "IPFS"? !inputField.startsWith("http"): inputField.startsWith("ipfs://baf");
    if(!validinput){
      selectedUri.value != "IPFS" ? alert("Urls should not have any prefix!") : alert("Ipfs location should be a v1 CID");
      return
    }
    const defaultBcmrLocation = "/.well-known/bitcoin-cash-metadata-registry.json"
    const bcmrLocation = (selectedUri.value === "website" && !inputField.endsWith(".json"))? defaultBcmrLocation : ""
    const fetchLocation = selectedUri.value != "IPFS" ? "https://" + inputField + bcmrLocation : inputField + inputField.slice(7);
    try{
      console.log("fetching bcmr at "+fetchLocation);
      const response = await fetch(fetchLocation);
      if(response?.status == 200) validitityCheck.value = true;
      const bcmrContent = await response.text();
      const hashContent = sha256.hash(utf8ToBin(bcmrContent));
      const chunks = ["BCMR", hashContent, inputField];
      return OpReturnData.fromArray(chunks);
    } catch (error) {validitityCheck.value = false;}
  }
  
  async function createFungibles(){
    if(!store.wallet) return;
    const validInput = isValidBigInt(inputFungibleSupply.value) && +inputFungibleSupply.value > 0;
    function isValidBigInt(value:string) {
      try { return BigInt(value) }
      catch (e) { return false }
    }
    if(!validInput){ alert(`Input total supply must be a valid integer`); return }
    try{
      const totalSupply = inputFungibleSupply.value;
      let opreturnData = await getOpreturnData();
      const genesisResponse = await store.wallet.tokenGenesis(
        {
          cashaddr: store.wallet.tokenaddr,
          amount: BigInt(totalSupply),    // fungible token amount
          value: 1000,                    // Satoshi value
        }, 
        opreturnData
      );
      const tokenId = genesisResponse?.tokenIds?.[0];
      const { txId } = genesisResponse;
      alert(`Created ${totalSupply} fungible tokens of category ${tokenId}`);
      console.log(`Created ${totalSupply} fungible tokens \n${store.explorerUrl}/tx/${txId}`);
      // reset input fields
      inputFungibleSupply.value = "";
      selectedTokenType.value  = "-select-";
      hasPreGenesis();
    } catch(error){
      console.log(error)
    }
  }
  async function createMintingNFT(){
    if(!store.wallet) return;
    try{
      let opreturnData = await getOpreturnData();
      const genesisResponse = await store.wallet.tokenGenesis(
        {
          cashaddr: store.wallet.tokenaddr,
          commitment: "",
          capability: "minting",
          value: 1000,
        }, 
        opreturnData
      );
      const tokenId = genesisResponse?.tokenIds?.[0];
      const { txId } = genesisResponse;
      alert(`Created minting NFT with category ${tokenId}`);
      console.log(`Created minting NFT with category ${tokenId} \n${store.explorerUrl}/tx/${txId}`);
      // reset input fields
      selectedTokenType.value  = "-select-";
      hasPreGenesis();
    } catch(error){
      console.log(error)
    }
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

      <div v-if="store.balance?.bch === 0" style="color: red;" id="warningNoBCH">Need BCH in wallet to create tokens</div>
      <div style="margin-bottom: 1em;">
        <div v-if="store.plannedTokenId == ''">
          Currently the wallet does not have any UTXOs capable of token creation. <br>
          <a @click="createPreGenesis" style="cursor: pointer;">Click here</a> to prepare a UTXO for token-creation.
        </div>
        <div v-else>
           Planned tokenId:
          <span v-if="store.plannedTokenId == undefined" id="plannedTokenId">loading...</span>
          <span v-if="store.plannedTokenId"> {{ displayPlannedTokenId }} </span>
          <button @click="copyToClipboard(store.plannedTokenId)" type="button" style="background: none; padding: 0;">
            <img class="copyIcon icon" src="images/copy.svg">
          </button>
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
        <b>Fungible Tokens</b> is used to create interchangeable tokens. The total supply of fungible tokens needs to be
        determined at creation. <br>
        <b>Minting NFT</b> is used to create an NFT collection. The minting NFT has the ability to mint new NFTs with the
        same tokenId.
        <br><br>
      </div>
      <div v-if="selectedTokenType != '-select-'">
        <div v-if="selectedTokenType == 'fungibles'">
          Choose the total supply of fungible tokens
          <input v-model="inputFungibleSupply" placeholder="total supply" type="number"> <br>
        </div>

        <details  style="margin-bottom: 0.5em;">
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
            1) First upload (pin) your tokenIcon on IPFS which can be done easily with <a href="https://nft.storage/" target="_blank">nft.storage</a>. <br>
            To upload multiple images grouped together on IPFS use their <a href="https://nft.storage/docs/how-to/nftup/" target="_blank">NFT UP</a> tool. <br>
            2) Then, you can create the BCMR JSON file with the <a href="https://bcmr-generator.netlify.app/" target="_blank">BCMR generator</a> or
              with the <a href="https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.ts" target="_blank">BCMR-schema</a>.<br>
            3) Upload the BCMR JSON file to ipfs with <a href="https://nft.storage/" target="_blank">nft.storage</a>.<br>
            4) Enter the IPFS location of your BCMR json file (version 1 CID starting with <code>baf...</code>) below. <br>
            The BCMR location together with the hash of its content will be stored on the blockchain.
            <input v-model="inputBcmr" @input="getOpreturnData" placeholder="bafkreiaqpmlrtsdf5cvwgh46mpyric2r44ikqzqgtevny74qdmrjc5dkxy">
          </div><br>
          <b>Validity check metadata: {{ validitityCheck? '✅':'❌' }}</b>
        </details><br>
        <b>Note:</b> Token metadata can still be added/updated after creation with the token's AuthUTXO.
        That's why the AuthUTXO should be transferred to a dedicated wallet right after creation.<br><br>
        Process might take a few seconds... <input @click="selectedTokenType == 'fungibles' ? createMintingNFT : createFungibles" type="button" class="primaryButton" value="Create" style="margin-top: 8px;">
      </div>
    </fieldset>
</div></template>