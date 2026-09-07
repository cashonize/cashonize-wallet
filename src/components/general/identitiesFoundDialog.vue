<script setup lang="ts">
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore, type FoundSource } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { formatBch, formatTimestamp, formatTokenAmountWithSymbol, truncateHash } from 'src/utils/utils'
  import { identityCoin } from 'src/utils/tools/authchainIdentity'
  import { maxTokenSupply } from 'src/utils/tools/tokenCreation'

  // Shown whenever the wallet held back identities the user never listed. It interrupts the
  // wallet at open with good news, so it says the least that is true: which token, why it is
  // this wallet's, and that nothing here will spend the coin by accident. The details live on the
  // page the primary button opens.
  const props = defineProps<{
    ids: string[], // categories
    sources: Record<string, FoundSource>, // how each came to be this wallet's
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK } = useDialogPluginComponent()
  const { t } = useI18n()
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const settingsStore = useSettingsStore()

  // An identity coin holds dust by every tool's convention, and printing dust makes a non-event
  // look like money; a coin above this is announced, since its BCH leaves the spendable balance
  const notableBchSats = 100_000n

  // Registries may not have been fetched yet when the walk returns, so a name can be missing and
  // the id stands in for it rather than waiting
  const entries = computed(() => props.ids.map(id => {
    const identity = identitiesStore.identities?.find(identity => identity.category === id)
    const output = identity ? identityCoin(identity) : undefined
    const metadata = store.bcmrRegistries?.[id]
    const token = output?.token
    let carries: string | undefined
    if (token?.nft?.capability === 'minting') carries = t('identities.found.mintingNft')
    else if (token?.nft) carries = t('identities.found.nft')
    const created = identity?.genesisTimestamp
      ? t('identities.found.created', { date: formatTimestamp(identity.genesisTimestamp, settingsStore.dateFormat, true) })
      : undefined
    let reserveLine: string | undefined
    if (token?.amount === maxTokenSupply) reserveLine = t('identities.found.reserveOpenEnded')
    else if (token?.amount) reserveLine = t('identities.found.reserve', { amount: formatTokenAmountWithSymbol(token.amount, metadata) })
    return {
      id,
      name: metadata?.name ?? truncateHash(id),
      iconUrl: settingsStore.disableTokenIcons ? undefined : store.tokenIconUrl(id),
      fungibleSupply: identity?.fungibleSupply ?? false,
      carries,
      created,
      reserveLine,
      bch: output && output.satoshis >= notableBchSats ? formatBch(output.satoshis, store.network) : undefined,
    }
  }))

  const allArrived = computed(() => props.ids.every(id => props.sources[id] === 'arrived'))
  const allKeys = computed(() => props.ids.every(id => props.sources[id] === 'key'))
  const title = computed(() => allArrived.value
    ? t('identities.found.titleArrived', props.ids.length)
    : t('identities.found.title', props.ids.length))
  // what holding the identity lets the wallet do: the supply only where the genesis made one
  const capability = computed(() => {
    if (props.ids.length === 1 && entries.value[0]!.fungibleSupply) return t('identities.found.capabilityWithSupply')
    return t('identities.found.capability', props.ids.length)
  })
  // the coins are kept out of sends, or the keys; a mixed list says both
  const heldBack = computed(() => {
    if (allKeys.value) return t('identities.found.heldBackKey', props.ids.length)
    if (props.ids.some(id => props.sources[id] === 'key')) return t('identities.found.heldBackMixed')
    return t('identities.found.heldBackCoin', props.ids.length)
  })
  const reserveLines = computed(() => entries.value.flatMap(entry => entry.reserveLine ? [entry.reserveLine] : []))
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ title }}</legend>
        <div class="found-list">
          <div v-for="entry in entries" :key="entry.id" class="found-entry">
            <TokenIcon :token-id="entry.id" :icon-url="entry.iconUrl" :size="32" />
            <div>
              <div>{{ entry.name }}</div>
              <div v-if="entry.carries || entry.created || entry.bch" class="found-facts">
                <span v-if="entry.carries">{{ entry.carries }}</span>
                <span v-if="entry.created">{{ entry.created }}</span>
                <span v-if="entry.bch">{{ entry.bch }}</span>
              </div>
            </div>
          </div>
        </div>
        <div>{{ capability }} {{ heldBack }}</div>
        <div v-for="line in reserveLines" :key="line" style="margin-top: 8px;">{{ line }}</div>
        <div class="found-actions">
          <input type="button" class="primaryButton" :value="t('identities.found.view')" @click="onDialogOK({ learn: false })">
          <input type="button" :value="t('identities.learn.link')" @click="onDialogOK({ learn: true })">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset {
    padding: 2rem;
    width: 550px;
    max-width: 100%;
  }
  .found-list {
    margin: 4px 0 12px;
  }
  .found-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .found-facts {
    color: grey;
    font-size: 0.9em;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .found-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
</style>
