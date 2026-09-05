<script setup lang="ts">
  // A token coin on two lines: what it is, then where it is and what can be done with it. One
  // copy for the fungible, NFT and FT+NFT lists, which only differ in what the first line says
  // about the token. The actions belong to the page, so the menu only emits them, and the page
  // decides whose label editor is open, since one is open at a time across all its lists.
  import { computed, ref } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import EmojiItem from 'src/components/general/emojiItem.vue'
  import InlineTextEdit from 'src/components/general/InlineTextEdit.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import utxoRowStatus from 'src/components/settings/utxoRowStatus.vue'
  import { copyToClipboard, formatBch, formatTokenAmountFromBigInt, truncateHash } from 'src/utils/utils'
  import { isFeatureReservation, outpointOf } from 'src/utils/wallet/reservedUtxos'
  import { maxUtxoLabelLength } from 'src/utils/wallet/utxoLabels'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    utxo: Utxo,
    // the list the coin is in: its first line shows a fungible amount, an NFT, or both
    kind: 'fungible' | 'nft' | 'ftNft',
    // whether the coin holds BCH worth a warning, by the page's threshold
    holdsSignificantBch: boolean,
    editingLabel: boolean,
  }>()

  const emit = defineEmits<{
    toggleFreeze: [],
    editLabel: [],
    menuHidden: [],
    saveLabel: [label: string],
    cancelLabel: [],
  }>()

  const reservation = computed(() => store.reservedUtxos[outpointOf(props.utxo)])
  const heldByFeature = computed(() => isFeatureReservation(reservation.value))
  const freezeLabel = computed(() => {
    if (reservation.value === 'manual') return t('utxoManagement.markers.unfreeze')
    return t('utxoManagement.freeze.button')
  })
  const label = computed(() => store.utxoLabels[outpointOf(props.utxo)])

  const category = computed(() => props.utxo.token?.category ?? '')
  const metadata = computed(() => store.bcmrRegistries?.[category.value])
  const tokenName = computed(() => metadata.value?.name || truncateHash(category.value, 8, 6))
  const tokenSymbol = computed(() => metadata.value?.token?.symbol ?? '')

  const fungibleAmount = computed(() => {
    const token = props.utxo.token
    if (!token) return '' // should never happen
    const decimals = metadata.value?.token?.decimals ?? 0
    return formatTokenAmountFromBigInt(token.amount, decimals)
  })

  const nftCapability = computed(() => {
    const capability = props.utxo.token?.nft?.capability
    if (!capability) return '' // should never happen
    return capability === 'none' ? t('tokenItem.info.immutable') : capability
  })

  // Commitments are up to 40 bytes and most are far shorter, so the column shows what fits and
  // its own ellipsis takes the rest. Unlike a hash there is no tail worth keeping, and leaving
  // the shortening to css is what lets the column be narrow without cutting a value twice.
  const nftCommitment = computed(() => props.utxo.token?.nft?.commitment || t('tokenItem.empty'))

  // The page opens the editor from the menu action the way it opens a grid row's, by ref once
  // the label line is in the DOM, so the row forwards that to its editor
  const labelEdit = ref<InstanceType<typeof InlineTextEdit> | null>(null)
  async function startEdit() {
    await labelEdit.value?.startEdit()
  }
  defineExpose({ startEdit })
</script>

<template>
  <div class="utxo-line-row">
    <div class="utxo-line">
      <TokenIcon
        :token-id="utxo.token!.category"
        :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(utxo.token!.category) : undefined"
        :size="24"
      />
      <span class="token-name">{{ tokenName }}</span>
      <span
        v-if="kind === 'fungible' || kind === 'ftNft'"
        class="mono amount-value"
        :title="`${fungibleAmount} ${tokenSymbol}`"
      >{{ fungibleAmount }}</span>
      <template v-if="kind === 'nft' || kind === 'ftNft'">
        <span class="mono muted commitment-value" :title="utxo.token!.nft!.commitment">{{ nftCommitment }}</span>
        <span class="description">{{ nftCapability }}</span>
      </template>
      <EmojiItem v-if="holdsSignificantBch" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
    </div>
    <div class="utxo-line utxo-line-meta">
      <span class="mono bch-value">{{ formatBch(utxo.satoshis, store.network) }}</span>
      <span class="copy-target" :title="outpointOf(utxo)" @click="copyToClipboard(outpointOf(utxo))">
        <span class="mono muted">{{ truncateHash(utxo.txid, 8, 6) }}:{{ utxo.vout }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
      <utxoRowStatus :utxo="utxo" compact />
      <q-icon v-if="!heldByFeature" name="more_vert" size="18px" class="row-menu-trigger">
        <q-menu anchor="bottom right" self="top right" class="utxo-actions-menu" @hide="emit('menuHidden')">
          <q-list dense>
            <q-item clickable v-close-popup @click="emit('toggleFreeze')">
              <q-item-section avatar><q-icon name="ac_unit" size="18px" /></q-item-section>
              <q-item-section>{{ freezeLabel }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup @click="emit('editLabel')">
              <q-item-section avatar><q-icon name="edit" size="18px" /></q-item-section>
              <q-item-section>{{ t('utxoManagement.label.title') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-icon>
    </div>
    <div v-if="label || editingLabel" class="utxo-line utxo-label-line">
      <InlineTextEdit
        ref="labelEdit"
        class="utxo-label-edit"
        :value="label"
        :hint="t('utxoManagement.label.placeholder')"
        :max-length="maxUtxoLabelLength"
        @save="(newLabel) => emit('saveLabel', newLabel)"
        @cancel="emit('cancelLabel')"
      />
    </div>
  </div>
</template>
