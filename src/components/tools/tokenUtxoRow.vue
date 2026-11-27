<script setup lang="ts">
  // A token coin on two lines: what it is and what can be done with it, then where it is. Fungible,
  // NFT and FT+NFT coins only differ in what the first line says about the token. The actions
  // belong to the page, so the menu only emits them, and the page decides whose label editor is
  // open, since one is open at a time across both its lists.
  import { computed, ref } from 'vue'
  import type { Utxo } from '@cashonize/bch-wallet-lib'
  import EmojiItem from 'src/components/general/emojiItem.vue'
  import InfoPopup from 'src/components/general/InfoPopup.vue'
  import InlineTextEdit from 'src/components/general/InlineTextEdit.vue'
  import TokenIcon from 'src/components/general/TokenIcon.vue'
  import utxoRowStatus from 'src/components/tools/utxoRowStatus.vue'
  import { copyToClipboard, formatBch, formatTokenAmount, truncateAddressBody, truncateHash } from 'src/utils/utils'
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
    // off for a single-address wallet, where every coin is on the same address
    showAddress: boolean,
    // what the coin holds: its first line shows a fungible amount, an NFT, or both
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
    return formatTokenAmount(token.amount, decimals)
  })

  // Says NFT out loud, so a row in the mixed list reads as what it is: "immutable NFT"
  const nftType = computed(() => {
    const capability = props.utxo.token?.nft?.capability
    if (!capability) return '' // should never happen
    let capabilityText = t('tokenItem.info.minting')
    if (capability === 'none') capabilityText = t('tokenItem.info.immutable')
    if (capability === 'mutable') capabilityText = t('tokenItem.info.mutable')
    return t('tokenItem.info.nftTypeValue', { capability: capabilityText })
  })

  // Commitments are up to 40 bytes of hex and most are far shorter: a short one is shown whole,
  // a long one loses its middle, and a click copies the full value either way
  const fullCommitment = computed(() => props.utxo.token?.nft?.commitment ?? '')
  const nftCommitment = computed(() => {
    if (fullCommitment.value.length > 20) return truncateHash(fullCommitment.value, 8, 8)
    return fullCommitment.value
  })

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
      <span v-if="kind === 'fungible' || kind === 'ftNft'" class="mono amount-value" :title="`${fungibleAmount} ${tokenSymbol}`">{{ fungibleAmount }} {{ tokenSymbol }}</span>
      <span v-if="kind === 'nft' || kind === 'ftNft'" class="muted nft-type">{{ nftType }}</span>
      <EmojiItem v-if="holdsSignificantBch" class="warn-marker" emoji="⚠️" :sizePx="16" :title="t('utxoManagement.markers.bchOnToken')"/>
      <span class="line-spacer"></span>
      <utxoRowStatus :utxo="utxo" compact />
      <q-icon v-if="!heldByFeature" name="more_vert" size="18px" class="row-menu-trigger">
        <q-menu anchor="bottom right" self="top right" @hide="emit('menuHidden')">
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
    <!-- every value but the BCH amount, which carries its unit, says what it is -->
    <div class="utxo-line utxo-line-meta">
      <span class="mono bch-value">{{ formatBch(utxo.satoshis, store.network) }}</span>
      <span class="meta-field">
        <span class="meta-label">{{ t('utxoManagement.tableHeaders.tokenId') }}</span>
        <span class="copy-target" :title="category" @click="copyToClipboard(category)">
          <span class="mono">{{ truncateHash(category, 8, 6) }}<img class="copyIcon" src="images/copyGrey.svg"></span>
        </span>
      </span>
      <span v-if="kind === 'nft' || kind === 'ftNft'" class="meta-field">
        <span class="meta-label">{{ t('utxoManagement.tableHeaders.commitment') }}</span>
        <span v-if="fullCommitment" class="copy-target" :title="fullCommitment" @click="copyToClipboard(fullCommitment)">
          <span class="mono">{{ nftCommitment }}<img class="copyIcon" src="images/copyGrey.svg"></span>
        </span>
        <span v-else>{{ t('tokenItem.empty') }}</span>
      </span>
      <span v-if="showAddress" class="meta-field">
        <span class="meta-label">{{ t('utxoManagement.tableHeaders.address') }}</span>
        <span class="copy-target" :title="utxo.address" @click="copyToClipboard(utxo.address)">
          <span class="mono">{{ truncateAddressBody(utxo.address) }}<img class="copyIcon" src="images/copyGrey.svg"></span>
        </span>
      </span>
      <span class="meta-field">
        <InfoPopup>
          <template #trigger>
            <span class="meta-label info-popup-text-trigger">{{ t('utxoManagement.tableHeaders.outpoint') }}</span>
          </template>
          {{ t('utxoManagement.tableHeaders.outpointHint') }}
        </InfoPopup>
        <span class="copy-target" :title="outpointOf(utxo)" @click="copyToClipboard(outpointOf(utxo))">
          <span class="mono">{{ truncateHash(utxo.txid, 8, 6) }}:{{ utxo.vout }}<img class="copyIcon" src="images/copyGrey.svg"></span>
        </span>
      </span>
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
