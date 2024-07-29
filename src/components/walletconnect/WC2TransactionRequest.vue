<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import { lockingBytecodeToCashAddress, hexToBin, binToHex, importWalletTemplate, walletTemplateP2pkhNonHd, walletTemplateToCompilerBCH, secp256k1, generateTransaction, encodeTransaction, sha256, hash256, SigningSerializationFlag, generateSigningSerializationBCH, TransactionCommon, TransactionTemplateFixed, CompilationContextBCH, Input, Output } from "@bitauth/libauth"
  import { BCMR, convert } from "mainnet-js"
  import { getSdkError } from '@walletconnect/utils';
  import type { DappMetadata, ContractInfo } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { parseExtendedJson } from 'src/utils/utils'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet
  const emit = defineEmits(['signedTransaction', 'rejectTransaction']);

  const showDialog = ref(true);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    transactionRequestWC: any
  }>()
  const { transactionRequestWC } = toRefs(props);

  const { id, topic } = transactionRequestWC.value;
  // parse params from transactionRequestWC
  const requestParams = parseExtendedJson(JSON.stringify(transactionRequestWC.value.params.request.params));
  const txDetails:TransactionCommon = requestParams.transaction;
  const sourceOutputs = requestParams.sourceOutputs as (Input & Output & ContractInfo)[]

  const abs = (value: bigint) => (value < 0n) ? -value : value;

  const satoshiToBCHString = (amount:bigint) => {
    const numberAmount = Number(amount);
    if (Math.abs(numberAmount / (10 ** 3)) > 1000) {
      const bchAmount = numberAmount * (10 ** -8)
      return `${bchAmount.toFixed(8)} BCH`
    } else {
      return `${numberAmount} sat`
    }
  };

  const toCashaddr = (lockingBytecode:Uint8Array) => {
    const prefix = store.network == "mainnet" ? "bitcoincash" : "bchtest";
    // check for opreturn
    if(binToHex(lockingBytecode).startsWith("6a")) return "opreturn:" +  binToHex(lockingBytecode)
    const result = lockingBytecodeToCashAddress(lockingBytecode,prefix);
    if (typeof result !== "string") throw result;
    return result;
  }

  async function convertToCurrency(satAmount: bigint) {
    const newCurrencyValue = await convert(Number(satAmount), "sat", settingsStore.currency);
    return Number(newCurrencyValue.toFixed(2));
  }

  const bchSpentInputs:bigint = sourceOutputs.reduce((total:bigint, sourceOutput:any) => 
    toCashaddr(sourceOutput.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + sourceOutput.valueSatoshis : total, 0n
  );
  const bchReceivedOutputs:bigint = txDetails.outputs.reduce((total:bigint, outputs:any) => 
    toCashaddr(outputs.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + outputs.valueSatoshis : total, 0n
  );
  const bchBalanceChange = bchReceivedOutputs - bchSpentInputs;
  const currencyBalanceChange = await convertToCurrency(bchBalanceChange);

  const tokensSpentInputs:Record<string, NonNullable<Output['token']>[]> = {}
  const tokensReceivedOutputs:Record<string, NonNullable<Output['token']>[]> = {}
  for (const input of sourceOutputs) {
    const walletOrigin = toCashaddr(input.lockingBytecode) == store?.wallet?.getDepositAddress();
    if(input.token && walletOrigin){
      const tokenCategory = binToHex(input.token.category);
      if(tokensSpentInputs[tokenCategory])tokensSpentInputs[tokenCategory].push(input.token);
      else tokensSpentInputs[tokenCategory] = [input.token];
    }
  }
  for (const output of txDetails.outputs) {
    const walletDestination = toCashaddr(output.lockingBytecode) == store?.wallet?.getDepositAddress();
    if(output.token && walletDestination){
      const tokenCategory = binToHex(output.token.category);
      if(tokensReceivedOutputs[tokenCategory]) tokensReceivedOutputs[tokenCategory].push(output.token);
      else tokensReceivedOutputs[tokenCategory] = [output.token];
    }
  }


  async function signTransactionWC() {
    const privateKey = store?.wallet?.privateKey;
    const pubkeyCompressed = store?.wallet?.publicKeyCompressed
    if(!privateKey || !pubkeyCompressed) return

    // prepare libauth template for input signing
    const template = importWalletTemplate(walletTemplateP2pkhNonHd);
    if (typeof template === "string") throw new Error("Transaction template error");

    // configure compiler
    const compiler = walletTemplateToCompilerBCH(template);

    const txTemplate = {...txDetails} as TransactionTemplateFixed<typeof compiler>;

    for (const [index, input] of txTemplate.inputs.entries()) {
      const sourceOutputsUnpacked = sourceOutputs;
      if (sourceOutputsUnpacked[index].contract?.artifact.contractName) {
        // instruct compiler to produce signatures for relevant contract inputs

        // replace pubkey and sig placeholders
        let unlockingBytecodeHex = binToHex(sourceOutputsUnpacked[index].unlockingBytecode);
        const sigPlaceholder = "41" + binToHex(Uint8Array.from(Array(65)));
        const pubkeyPlaceholder = "21" + binToHex(Uint8Array.from(Array(33)));
        if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
          // compute the signature argument
          const hashType = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
          const context: CompilationContextBCH = { inputIndex: index, sourceOutputs: sourceOutputsUnpacked, transaction: txDetails };
          const signingSerializationType = new Uint8Array([hashType]);

          const coveredBytecode = sourceOutputsUnpacked[index].contract?.redeemScript;
          if (!coveredBytecode) {
            alert("Not enough information provided, please include contract redeemScript");
            return;
          }
          const sighashPreimage = generateSigningSerializationBCH(context, { coveredBytecode, signingSerializationType });
          const sighash = hash256(sighashPreimage);
          const signature = secp256k1.signMessageHashSchnorr(privateKey, sighash);
          if (typeof signature === "string") {
            alert(signature);
            return;
          }
          const sig = Uint8Array.from([...signature, hashType]);

          unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, "41" + binToHex(sig));
        }
        if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
          unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, "21" + binToHex(pubkeyCompressed));
        }

        input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
      } else {
        // replace unlocking bytecode for non-contract inputs having placeholder unlocking bytecode
        const sourceOutput = sourceOutputsUnpacked[index];
        if (!sourceOutput.unlockingBytecode?.length && toCashaddr(sourceOutput.lockingBytecode) === store.wallet?.getDepositAddress()) {
           input.unlockingBytecode = {
            compiler,
             data: {
              keys: { privateKeys: { key: privateKey } },
            },
            valueSatoshis: sourceOutput.valueSatoshis,
            script: "unlock",
            token: sourceOutput.token,
          }
        }
      }
    };

    // generate and encode transaction
    const generated = generateTransaction(txTemplate);
    if (!generated.success) throw Error(JSON.stringify(generated.errors, null, 2));

    const encoded = encodeTransaction(generated.transaction);
    const hash = binToHex(sha256.hash(sha256.hash(encoded)).reverse());
    const signedTxObject = { signedTransaction: binToHex(encoded), signedTransactionHash: hash };

    // send transaction
    const response = { id, jsonrpc: '2.0', result: signedTxObject };
    if (requestParams.broadcast) {
      await store.wallet?.submitTransaction(hexToBin(signedTxObject.signedTransaction));
    }
    await web3wallet?.respondSessionRequest({ topic, response });

    emit('signedTransaction', signedTxObject.signedTransactionHash);
  }

  async function rejectTransaction(){
    const response = { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') };
    await web3wallet?.respondSessionRequest({ topic, response });
    emit('rejectTransaction')
  }
</script>

<template>
  <q-dialog v-model="showDialog" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldsetTxRequest"> 
        <legend style="font-size: large;">Sign Transaction</legend>
        <div style="font-size: large; margin-top: 2rem;">Origin:</div>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <hr style="margin-top: 2rem;">

        <div class="wc-modal-details">
          <div style="display: flex; justify-content: center; font-size: larger;"> {{ requestParams.userPrompt }}</div>
          <div class="wc-modal-heading">Inputs:</div>
          <table class="wc-data-table">
            <tbody v-for="(input, inputIndex) in sourceOutputs" :key="binToHex(input.outpointTransactionHash) + inputIndex">
              <tr>
                <td>{{ inputIndex }}</td>
                <td>
                  {{ toCashaddr(input.lockingBytecode).slice(0,25)  + '...' }}
                  <span v-if="toCashaddr(input.lockingBytecode) == store?.wallet?.getDepositAddress()" class="thisWalletTag">
                    (this wallet)
                  </span>
                </td>
                <td>{{ satoshiToBCHString(input.valueSatoshis) }}</td>
              </tr>
              <tr v-if="input.contract">
                <td></td>
                <td style="font-weight: 600;">Contract: {{input.contract.artifact.contractName}}, Function: {{ input.contract.abiFunction.name }}</td>
              </tr>
              <tr v-if="input?.token">
                <td></td>
                <td>
                  {{input?.token?.nft && !input?.token?.amount ? 'NFT:' : 'Token:'}}
                  {{ binToHex(input.token.category).slice(0,6)  + '...'}}
                  <span style="font-weight: 600;">
                    {{ store.bcmrRegistries?.[binToHex(input.token.category)]?.name ?? null }}
                  </span>
                </td>
                <td v-if="input.token.amount">Amount: {{ input.token.amount }}</td>
              </tr>
              <tr v-if="input?.token?.nft">
                <td></td>
                <td>Commitment: {{ binToHex(input.token.nft.commitment) }}</td>
                <td>Capability: {{ input.token.nft.capability }}</td>
              </tr>
            </tbody>
          </table>
          <div>
          </div>
          <div class="wc-modal-heading">Outputs:</div>
          <table class="wc-data-table">
            <tbody v-for="(output, outputIndex) in txDetails.outputs" :key="binToHex(output.lockingBytecode) + outputIndex">
              <tr>
                <td>{{ outputIndex }}</td>
                <td>
                  {{ toCashaddr(output.lockingBytecode).slice(0,25)  + '...' }}
                  <span v-if="toCashaddr(output.lockingBytecode) == store?.wallet?.getDepositAddress()" class="thisWalletTag">
                    (this wallet)
                  </span>
                </td>
                <td>{{ satoshiToBCHString(output.valueSatoshis) }}</td>
              </tr>
              <tr v-if="output?.token">
                <td></td>
                <td>
                  {{output?.token?.nft && !output?.token?.amount ? 'NFT:' : 'Token:'}}
                  {{ binToHex(output.token.category).slice(0,6)  + '...'}}
                  <span style="font-weight: 600;">
                    {{ store.bcmrRegistries?.[binToHex(output.token.category)]?.name ?? null }}
                  </span>
                </td>
                <td v-if="output.token.amount">Amount: {{ output.token.amount }}</td>
              </tr>
              <tr v-if="output?.token?.nft">
                <td></td>
                <td>Commitment: {{ binToHex(output.token.nft.commitment) }}</td>
                <td>Capability: {{ output.token.nft.capability }}</td>
              </tr>
            </tbody>
          </table>
          <hr>
          <div class="wc-modal-heading">Balance Change:</div>
          <div>
            {{ bchBalanceChange > 0 ? '+ ': '- '}} {{ satoshiToBCHString(abs(bchBalanceChange)) }}
            ({{ currencyBalanceChange }}{{ CurrencySymbols[settingsStore.currency] }})
          </div>
          <div v-for="(tokenArrayInput, firstIndex) in tokensSpentInputs" :key="firstIndex">
            <div v-for="(tokenSpent, index) in tokenArrayInput" :key="binToHex(tokenSpent.category) + index">
            - {{tokenSpent?.nft ? "NFT" : "Token"}}
            {{ store.bcmrRegistries?.[binToHex(tokenSpent?.category) ?? ""]?.name ?
              store.bcmrRegistries?.[binToHex(tokenSpent.category)]?.name : 
              binToHex(tokenSpent.category).slice(0,6)  + '...'
            }}
            </div>
          </div>
          <div v-for="(tokenArrayRecived, firstIndex) in tokensReceivedOutputs" :key="firstIndex">
            <div v-for="(tokenReceived, index) in tokenArrayRecived" :key="binToHex(tokenReceived.category) + index">
            + {{tokenReceived.nft ? "NFT" : "Token"}}
            {{ store.bcmrRegistries?.[binToHex(tokenReceived.category)]?.name ?
              store.bcmrRegistries?.[binToHex(tokenReceived.category)]?.name : 
              binToHex(tokenReceived.category).slice(0,6)  + '...'
            }}
            {{ tokenReceived.amount ? "amount: "+ (tokenReceived.amount / (10n ** BigInt(BCMR.getTokenInfo(binToHex(tokenReceived.category))?.token?.decimals ?? 0n))) : ""}}
            </div>
          </div>
          <div class="wc-modal-bottom-buttons">
            <input type="button" class="primaryButton" value="Sign" @click="() => signTransactionWC()" v-close-popup>
            <input type="button" value="Cancel" @click="() => rejectTransaction()" v-close-popup>
          </div>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldsetTxRequest{
    padding: .5rem 2rem;
    width: 500px;
    max-height: 90vh;
    background-color: white;
    overflow: auto;
  }
  body.dark .dialogFieldsetTxRequest {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
  .wc-modal-details {
    font-size: smaller;
  }
  .wc-modal-heading {
    font-weight: 700;
  }
  .wc-data-table tbody td {
    padding-right: .3em;
  }
  td {
    padding: 0;
  }
  .wc-modal-bottom-buttons {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
    margin-bottom: 2rem;
    gap: 10px;
  }
  .wc-modal-bottom-buttons > input {
    width: 111px;
  }
  .thisWalletTag{
    color: hsla(160, 100%, 37%, 1)
  }

  @media only screen and (max-width: 570px) {
    .dialogFieldsetTxRequest{
      width: 100%;
    }
    .thisWalletTag{
      display: block;
    }
  }
</style>