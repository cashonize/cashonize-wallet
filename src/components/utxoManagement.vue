<script setup lang="ts">
  import { computed } from 'vue';
  import { formatFiatAmount, getFungibleTokenBalances, getTokenUtxos, satsToBch } from 'src/utils/utils';
  import { ExchangeRate, TokenSendRequest, type UtxoI } from 'mainnet-js';
  import EmojiItem from './general/emojiItem.vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

  const exchangeRate = +(await ExchangeRate.get(settingsStore.currency, true)).toFixed(2)

  // TODO: consider lowering this to 1000 satoshis in the future
  // note: the bliss airdrop tool uses 2000 sats so from that point, many users would have combined UTXOs
  const utxosWithBchAndTokens = computed(() => {
    return store.walletUtxos!.filter(utxo => utxo.token?.tokenId && utxo.satoshis > 10_000n);
  });

  const satsToSplit = computed(() => {
    return utxosWithBchAndTokens.value.reduce((sum:bigint, utxo) => sum + BigInt(utxo.satoshis) - 1000n, 0n)
  })

  async function consollidateBchUtxos() {
    if(!store.wallet) return // should not happen
    try{
      $q.notify({
        spinner: true,
        message: 'Consollidating BCH UTXOs...',
        color: 'grey-5',
        timeout: 1000
      })
      await store.wallet.sendMax(store.wallet.address as string)
      $q.notify({
        type: 'positive',
        message: 'Consollidated BCH UTXOs successfully!'
      })
      // update wallet state
      await store.updateWalletUtxos()
      // update wallet history
      store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }

  async function splitBchFromTokenUtxos() {
    if(!store.wallet || !utxosWithBchAndTokens.value || !store.walletUtxos) return // should not happen
    try{
      const tokenUtxos = getTokenUtxos(store.walletUtxos);
      const fungibleTokensResult = getFungibleTokenBalances(tokenUtxos);
      const uniqueTokenIdsToSplit: Set<string> = new Set()
      utxosWithBchAndTokens.value.forEach(utxo => {
        if(utxo.token?.amount && !utxo.token?.capability) {
          uniqueTokenIdsToSplit.add(utxo.token.tokenId)
        }
      })
      $q.notify({
        spinner: true,
        message: 'Splitting BCH from Token UTXOs...',
        color: 'grey-5',
        timeout: 1000 * uniqueTokenIdsToSplit.size
      })
      // splitBchFromTokenUtxos esentially sends all fungible tokens 
      for(const uniqueTokenIdToSplit of uniqueTokenIdsToSplit) {
        const { txId } = await store.wallet.send([
          new TokenSendRequest({
            cashaddr: store.wallet.tokenaddr as string,
            amount: fungibleTokensResult[uniqueTokenIdToSplit] as bigint,
            tokenId: uniqueTokenIdToSplit,
          }),
        ]);
        console.log(`Split BCH from Token UTXO ${uniqueTokenIdToSplit} with txid: ${txId}`);
      }
      $q.notify({
        type: 'positive',
        message: 'Split BCH from Token UTXO successfully!'
      })
      // update wallet state once at the end
      await store.updateWalletUtxos()
      store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }
</script>

<template>
  <fieldset class="item" style="padding-bottom: 20px;">
    <legend>UTXO Management</legend>
    <div>Total number of Wallet UTXOs: {{ store.walletUtxos?.length }}</div>
    <div>Total number of BCH-only UTXOs: {{ store.walletUtxos?.filter(utxo => !utxo.token)?.length }}</div>

    <div style="margin: 8px 0px;">
      <div>Some Dapps may ask you to consollidate your BCH UTXOs <br/>
        Easily combine the balance of all your BCH-only UTXOs to 1 UTXO:</div>
      <input @click="consollidateBchUtxos()" type="button" class="primaryButton" style="margin-top: 8px;" value="Consolidate BCH">
    </div>

    <div style="margin-bottom: 8px;">Number of token UTXOs: {{ getTokenUtxos(store.walletUtxos as UtxoI[]).length }}</div>

    <div>Some Dapps may return a UTXO which combines BCH with Tokens </div>
    <div>Combined BCH + Tokens on UTXOs is currently not well supported in Cashonize</div>
    <div>
      Number of UTXOs with BCH + Tokens: {{ utxosWithBchAndTokens?.length }}
      <span style="font-size: large;">
        <EmojiItem :emoji="utxosWithBchAndTokens?.length ? '⚠️' : '✅'" :sizePx="20" style="margin: 0 5px;vertical-align: sub;"/>
      </span>
    </div>
    <div v-if="utxosWithBchAndTokens.filter(utxo => utxo.token?.capability).length" style="margin-bottom: 10px;">
      Note: The tool currently is only able to split BCH from UTXOs with fungible tokens
    </div>
    <div v-if="utxosWithBchAndTokens?.length" style="margin-bottom: 10px;">
      <details>
        <summary style="display: list-item">List of problematic UTXO(s)</summary>
        <div style="margin-left: 15px;">
          <div v-for="(utxo, index) in utxosWithBchAndTokens.sort((utxo0, utxo1) => utxo1.satoshis - utxo0.satoshis)" :key="index">
            <div>UTXO #{{ index +1 }}</div>
            <div style="margin-left: 15px;">
              {{ satsToBch(utxo.satoshis) }} BCH
              ({{formatFiatAmount(exchangeRate * satsToBch(utxo.satoshis), settingsStore.currency) }}) 
              <EmojiItem v-if="utxo.satoshis > 100_000n" emoji="⚠️" :sizePx="20"/><br/>
              TokenId: {{ utxo.token?.tokenId }} <br/>
              Token: {{ store.bcmrRegistries?.[utxo.token!.tokenId]?.name }} <br/>
              TokenType: {{ utxo.token?.amount && utxo.token.capability ? 'both fungible tokens & NFT' : (
                utxo.token?.amount ? 'fungible token' : 'NFT'
              ) }} <br/>
              TxId: {{ utxo.txid }} <br/>
              Vout : {{ utxo.vout }} <br/>
            </div>
          </div>
        </div>
      </details>
      <div>
        <span style="color: orange;">Important:</span> Split {{ satsToBch(satsToSplit) }} BCH 
        ({{ formatFiatAmount(exchangeRate * satsToBch(satsToSplit), settingsStore.currency) }}) from Token UTXOs:</div>
      <input @click="splitBchFromTokenUtxos()" type="button" class="secondaryButton" style="margin-top: 8px; background-color: orange; color:white" value="Split BCH from Tokens">
    </div>
  </fieldset>
  
</template>