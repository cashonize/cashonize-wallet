<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import { lockingBytecodeToCashAddress, hexToBin, binToHex } from "@bitauth/libauth"
  import { BCMR, convert } from "mainnet-js"
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()
  // const emit = defineEmits(['signTransactionWC']);

  const showDialog = ref(true);

  const props = defineProps<{
    dappMetadata: DappMetadata,
    transactionRequestWC: any
  }>()
  const { transactionRequestWC } = toRefs(props);

  const parseExtendedJson = (jsonString: string) => {
    const uint8ArrayRegex = /^<Uint8Array: 0x(?<hex>[0-9a-f]*)>$/u;
    const bigIntRegex = /^<bigint: (?<bigint>[0-9]*)n>$/;

    return JSON.parse(jsonString, (_key, value) => {
      if (typeof value === "string") {
        const bigintMatch = value.match(bigIntRegex);
        if (bigintMatch) {
          return BigInt(bigintMatch[1]);
        }
        const uint8ArrayMatch = value.match(uint8ArrayRegex);
        if (uint8ArrayMatch) {
          return hexToBin(uint8ArrayMatch[1]);
        }
      }
      return value;
    });
  }

  const requestParams = parseExtendedJson(JSON.stringify(transactionRequestWC.value.params.request.params));
  const txDetails = requestParams.transaction;

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

  async function convertToUsd(satAmount: bigint) {
    const newUsdValue = await convert(Number(satAmount), "sat", "usd");
    return Number(newUsdValue.toFixed(2));
  }

  const bchSpentInputs:bigint = requestParams.sourceOutputs.reduce((total:bigint, sourceOutputs:any) => 
    toCashaddr(sourceOutputs.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + sourceOutputs.valueSatoshis : total, 0n
  );
  const bchReceivedOutputs:bigint = txDetails.outputs.reduce((total:bigint, outputs:any) => 
    toCashaddr(outputs.lockingBytecode) == store?.wallet?.getDepositAddress() ? total + outputs.valueSatoshis : total, 0n
  );
  const bchBalanceChange = bchReceivedOutputs - bchSpentInputs;
  const usdBalanceChange = await convertToUsd(bchBalanceChange);

  const tokensSpentInputs: any = {}
  const tokensReceivedOutputs: any = {}
  for (const input of requestParams.sourceOutputs) {
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


  function signWCtransaction() {
    // emit('signTransactionWC', );
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
          <table>
            <tbody v-for="(input, inputIndex) in requestParams.sourceOutputs" :key="input.outpointTransactionHash">
              <tr>
                <td>{{ inputIndex }}</td>
                <td>
                  {{ toCashaddr(input.lockingBytecode).slice(0,25)  + '...' }}
                  <span style="color: hsla(160, 100%, 37%, 1)">
                    {{ toCashaddr(input.lockingBytecode) == store?.wallet?.getDepositAddress() ? "(this wallet)" : "" }}
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
                  <span style="font-weight: 600;">{{BCMR.getTokenInfo(binToHex(input.token.category))?.name }}</span>
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
          <table>
            <tbody v-for="(output, outputIndex) in txDetails.outputs" :key="output.outpointTransactionHash">
              <tr>
                <td>{{ outputIndex }}</td>
                <td>
                  {{ toCashaddr(output.lockingBytecode).slice(0,25)  + '...' }}
                  <span style="color: hsla(160, 100%, 37%, 1)">
                    {{ toCashaddr(output.lockingBytecode) == store?.wallet?.getDepositAddress() ? "(this wallet)" : "" }}
                  </span>
                </td>
                <td>{{ satoshiToBCHString(output.valueSatoshis) }}</td>
              </tr>
              <tr v-if="output?.token">
                <td></td>
                <td>
                  {{output?.token?.nft && !output?.token?.amount ? 'NFT:' : 'Token:'}}
                  {{ binToHex(output.token.category).slice(0,6)  + '...'}}
                  <span style="font-weight: 600;">{{ BCMR.getTokenInfo(binToHex(output.token.category))?.name }}</span>
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
            ({{ usdBalanceChange }}$)
          </div>
          <div v-for="tokenArrayInput in tokensSpentInputs" :key="tokenArrayInput.category">
            <div v-for="(tokenSpent, index) in tokenArrayInput" :key="tokenArrayInput.category + index">
            - {{tokenArrayInput.nft ? "NFT" : "Token"}}
            {{ BCMR.getTokenInfo(binToHex(tokenSpent.category))?.name ?
              BCMR.getTokenInfo(binToHex(tokenSpent.category))?.name : 
              binToHex(tokenSpent.category).slice(0,6)  + '...'
            }}
            </div>
          </div>
          <div v-for="tokenArrayRecived in tokensReceivedOutputs" :key="tokenArrayRecived.category">
            <div v-for="(tokenReceived, index) in tokenArrayRecived" :key="tokenArrayRecived.category + index">
            + {{tokenReceived.nft ? "NFT" : "Token"}}
            {{ BCMR.getTokenInfo(binToHex(tokenReceived.category))?.name ?
              BCMR.getTokenInfo(binToHex(tokenReceived.category))?.name : 
              binToHex(tokenReceived.category).slice(0,6)  + '...'
            }}
            {{ tokenReceived.amount ? "amount: "+ (tokenReceived.amount / (BCMR.getTokenInfo(binToHex(tokenReceived.category))?.token?.decimals ?? 1)) : ""}}
            </div>
          </div>
          <div class="wc-modal-bottom-buttons">
            <input type="button" class="primaryButton" value="Sign" @click="() => signWCtransaction()" v-close-popup>
            <input type="button" value="Cancel" v-close-popup>
          </div>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style>
  .dialogFieldsetTxRequest{
    padding: .5rem 2rem;
    width: 500px;
    max-height: 90vh;
    background-color: white
  }
  .q-dialog__backdrop {
    backdrop-filter: blur(24px);
    background-color: transparent;
    pointer-events: all  !important;
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
  .wc-data-table {
    font-size: smaller;
    white-space: nowrap;
  }
  .wc-data-table tbody th, .wc-data-table tbody td {
    padding: .3em .3em .3em 0;
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
</style>