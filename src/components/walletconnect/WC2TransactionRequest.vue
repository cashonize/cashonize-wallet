<script setup lang="ts">
  import { toRefs } from 'vue';
  import { binToHex, lockingBytecodeToCashAddress, type TransactionCommon, type Input, type Output } from "@bitauth/libauth"
  import { useDialogPluginComponent } from 'quasar'
  import { type DappMetadata, CurrencySymbols } from "src/interfaces/interfaces"
  import { type ContractInfo } from "src/interfaces/wcInterfaces"
  import { useStore } from 'src/stores/store'
  import { convertToCurrency, parseExtendedJson } from 'src/utils/utils'
  import { useSettingsStore } from 'src/stores/settingsStore';
  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    dappMetadata: DappMetadata,
    transactionRequestWC: any,
    exchangeRate: number,
  }>()
  const { transactionRequestWC, exchangeRate } = toRefs(props);

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
  
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

  const bchSpentInputs:bigint = sourceOutputs.reduce((total:bigint, sourceOutput:any) => 
    toCashaddr(sourceOutput.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + sourceOutput.valueSatoshis : total, 0n
  );
  const bchReceivedOutputs:bigint = txDetails.outputs.reduce((total:bigint, outputs:any) => 
    toCashaddr(outputs.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + outputs.valueSatoshis : total, 0n
  );
  const bchBalanceChange = bchReceivedOutputs - bchSpentInputs;
  const currencyBalanceChange = convertToCurrency(bchBalanceChange, exchangeRate.value);

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

  const calculateAmount = (tokenObject: NonNullable<Output['token']>): string => {
    if (!tokenObject.amount) return '';
    const categoryHex = binToHex(tokenObject.category);
    const decimals = Number(store.bcmrRegistries?.[categoryHex]?.token?.decimals ?? 0);

    if (decimals === 0) {
      return tokenObject.amount.toString();
    } else {
      const amount = Number(tokenObject.amount);
      return (amount / (10 ** decimals)).toFixed(decimals);
    }
  };

  const formatTokenDisplay = (tokenSpent: NonNullable<Output['token']>, displayFullName= true): string => {
    const categoryHex = binToHex(tokenSpent.category);
    const tokenMetadata = store.bcmrRegistries?.[categoryHex];
    const tokenName = tokenMetadata?.name;
    const tokenSymbol = tokenMetadata?.token?.symbol;
    const displayMetadata = displayFullName ? tokenName : tokenSymbol;

    if (displayMetadata) {
      const addNftPostfix = tokenSpent.nft ? " NFT" : "";
      return displayMetadata + addNftPostfix;
    } else {
      const tokenType = tokenSpent.nft ? "NFT" : "Tokens";
      return `${categoryHex.slice(0, 6)}... ${tokenType}`;
    }
  };
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldsetTxRequest"> 
        <legend style="font-size: large;">Sign Transaction</legend>

        <div style="display: flex; justify-content: center; font-size: large;  margin-top: 1rem;">
          {{ requestParams.userPrompt }}
        </div>

        <div style="font-size: large; margin-top: 1.5rem;">Origin:</div>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>

        <hr style="margin-top: 1.5rem;">

        <div class="wc-modal-heading" style="margin-top: 1.5rem;">Balance Change:</div>
          <div>
            {{ bchBalanceChange > 0 ? '+ ': '- '}} {{ satoshiToBCHString(abs(bchBalanceChange)) }}
            ({{ currencyBalanceChange + ` ${CurrencySymbols[settingsStore.currency]}`}})
          </div>
          <div v-for="(tokenArrayInput, firstIndex) in tokensSpentInputs" :key="firstIndex">
            <div v-for="(tokenSpent, index) in tokenArrayInput" :key="binToHex(tokenSpent.category) + index">
              {{ `- ${calculateAmount(tokenSpent)} ${formatTokenDisplay(tokenSpent)}` }}
            </div>
          </div>
          <div v-for="(tokenArrayRecived, firstIndex) in tokensReceivedOutputs" :key="firstIndex">
            <div v-for="(tokenReceived, index) in tokenArrayRecived" :key="binToHex(tokenReceived.category) + index">
              {{ `+ ${calculateAmount(tokenReceived)} ${formatTokenDisplay(tokenReceived)}` }}
            </div>
          </div>

          <hr style="margin-top: 2rem;">

        <details>
          <summary style="display: list-item" class="hover">Full Transaction Details</summary>
          <div class="wc-modal-details" style="margin-top: 1rem;">
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
                    {{ formatTokenDisplay(input.token as NonNullable<Output['token']>) }}
                  </td>
                  <td v-if="input.token.amount">
                    Amount: {{ calculateAmount(input.token as NonNullable<Output['token']>) }}
                  </td>
                </tr>
                <tr v-if="input?.token?.nft">
                  <td></td>
                  <td class="commitment">Commitment: {{ binToHex(input.token.nft.commitment) }}</td>
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
                    {{ formatTokenDisplay(output.token as NonNullable<Output['token']>) }}
                  </td>
                  <td v-if="output.token.amount">
                    Amount: {{ calculateAmount(output.token as NonNullable<Output['token']>) }}
                  </td>
                </tr>
                <tr v-if="output?.token?.nft">
                  <td></td>
                  <td class="commitment">Commitment: {{ binToHex(output.token.nft.commitment) }}</td>
                  <td>Capability: {{ output.token.nft.capability }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <div class="wc-modal-bottom-buttons">
          <input type="button" class="primaryButton" value="Sign" @click="onDialogOK">
          <input type="button" value="Cancel" @click="onDialogCancel" v-close-popup>
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
    margin: 0 5px;
  }
  .wc-modal-heading {
    font-weight: 700;
  }
  .wc-data-table tbody td {
    padding-right: .3em;
  }
  td {
    padding: 0;
    max-width: 220px;
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
  .wc-data-table tbody td.commitment{
    line-break: anywhere;
    width: min-content;
    padding-right: 40px;
  }

  .hover {
    cursor: pointer;
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