<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import { lockingBytecodeToCashAddress, hexToBin, binToHex } from "@bitauth/libauth"
  import { BCMR } from "mainnet-js"
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
    const result = lockingBytecodeToCashAddress(lockingBytecode,prefix);
    if (typeof result !== "string") throw result;
    return result;
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
    height: 600px;
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