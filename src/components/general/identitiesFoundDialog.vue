<script setup lang="ts">
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore, type FoundSource } from 'src/stores/identitiesStore'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { formatBch, formatTimestamp, truncateHash } from 'src/utils/utils'

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
  // the id stands in for it rather than waiting. The facts line answers what the wallet holds
  // for this identity, which for a guarded one is the AuthKey: its reserve and NFT sit in the
  // covenant, where nothing is held back and nothing is the user's to act on.
  const entries = computed(() => props.ids.map(id => {
    const identity = identitiesStore.identities?.find(identity => identity.category === id)
    const viaAuthKey = identity?.status === 'heldViaKey'
    const heldUtxo = identity?.authUtxo
    const metadata = store.bcmrRegistries?.[id]
    const token = heldUtxo?.token
    let carries: string | undefined
    if (viaAuthKey) carries = t('identities.found.authKey')
    else if (token?.nft?.capability === 'minting') carries = t('identities.found.mintingNft')
    else if (token?.nft) carries = t('identities.found.nft')
    const created = identity?.genesisTimestamp
      ? t('identities.found.created', { date: formatTimestamp(identity.genesisTimestamp, settingsStore.dateFormat, true) })
      : undefined
    return {
      id,
      name: metadata?.name ?? truncateHash(id),
      iconUrl: settingsStore.disableTokenIcons ? undefined : store.tokenIconUrl(id),
      fungibleSupply: identity?.fungibleSupply ?? false,
      viaAuthKey,
      carries,
      created,
      bch: heldUtxo && heldUtxo.satoshis >= notableBchSats ? formatBch(heldUtxo.satoshis, store.network) : undefined,
    }
  }))

  const allArrived = computed(() => props.ids.every(id => props.sources[id] === 'arrived'))
  const heldHere = computed(() => entries.value.filter(entry => !entry.viaAuthKey))
  const title = computed(() => allArrived.value
    ? t('identities.found.titleArrived', props.ids.length)
    : t('identities.found.title', props.ids.length))
  // What holding the identity lets the wallet do, and only for the ones held outright: what an
  // AuthKey can do is the card's to explain, next to the covenant it opens.
  const capability = computed(() => {
    if (!heldHere.value.length) return undefined
    if (heldHere.value.length === 1 && heldHere.value[0]!.fungibleSupply) return t('identities.found.capabilityWithSupply')
    return t('identities.found.capability', heldHere.value.length)
  })
  // the UTXOs are kept out of sends, or the AuthKeys; a mixed list says both
  const heldBack = computed(() => {
    if (!heldHere.value.length) return t('identities.found.heldBackKey', props.ids.length)
    if (heldHere.value.length < props.ids.length) return t('identities.found.heldBackMixed')
    return t('identities.found.heldBackCoin', props.ids.length)
  })
  // Joined here rather than in the template: a space beside an interpolation is the last child
  // of its element, which Vue's whitespace condensing drops, running the two sentences together.
  const summary = computed(() => [capability.value, heldBack.value].filter(Boolean).join(' '))
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ title }}</legend>
        <div class="found-list">
          <div v-for="entry in entries" :key="entry.id" class="found-entry">
            <div class="iconWithBadge">
              <TokenIcon :token-id="entry.id" :icon-url="entry.iconUrl" :size="32" />
              <!-- the row depicts the AuthKey, which the token list shows with the same stamp -->
              <img v-if="entry.viaAuthKey" class="authKeyBadge small" src="images/keyWhite.svg">
            </div>
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
        <div>{{ summary }}</div>
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
