<script setup lang="ts">
  // An identity's history, which is the chain itself: what each link did and how the reserve
  // moved. Fetched when opened, since it is the one identity query that grows with the chain.
  import { computed, onMounted, ref } from 'vue'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useI18n } from 'vue-i18n'
  import { formatTokenAmountFromBigInt } from 'src/utils/utils'
  import type { IdentityState, DescribedLink } from 'src/utils/tools/authchainIdentity'

  const props = defineProps<{ identity: IdentityState }>()
  const store = useStore()
  const identitiesStore = useIdentitiesStore()
  const { t } = useI18n()

  const loading = ref(false)
  // The chain as fetched at this authhead; nothing to show until it is resolved
  const history = computed(() => {
    const authhead = props.identity.authheadTxid
    return authhead ? identitiesStore.identityHistories[authhead] : undefined
  })
  // How long an identity has stood, once its history says
  const establishedYear = computed(() => {
    const since = history.value?.[0]?.timestamp
    return since ? new Date(since * 1000).getFullYear() : undefined
  })
  const tokenDecimals = computed(() => store.bcmrRegistries?.[props.identity.category]?.token?.decimals ?? 0)

  onMounted(async () => {
    if (history.value) return
    loading.value = true
    try {
      await identitiesStore.fetchIdentityHistory(props.identity)
    } catch (error) {
      displayAndLogError(error)
    } finally {
      loading.value = false
    }
  })

  // Told by the wallet's own history: the links made here, and the ones made elsewhere with the
  // same keys, which is the half an explorer cannot show
  function madeByThisWallet(hash: string) {
    return (store.walletHistory ?? []).some(transaction => transaction.hash === hash)
  }
  function reserveDeltaText(link: DescribedLink) {
    const size = link.reserveDelta < 0n ? -link.reserveDelta : link.reserveDelta
    const amount = formatTokenAmountFromBigInt(size, tokenDecimals.value)
    if (link.reserveDelta > 0n) return t('identities.history.reserveUp', { amount })
    return t('identities.history.reserveDown', { amount })
  }
  function linkDate(timestamp?: number) {
    if (!timestamp) return undefined
    return new Date(timestamp * 1000).toLocaleDateString()
  }
</script>

<template>
  <div class="section">
    <div>
      {{ t('identities.history.title') }}
      <span v-if="establishedYear" class="description">
        · {{ t('identities.established.since', { year: establishedYear }) }}
      </span>
    </div>
    <div v-if="loading" class="description">{{ t('identities.history.loading') }}</div>
    <div v-for="link in history ?? []" :key="link.hash" class="chain-link">
      <span v-if="link.kind === 'mint'">{{ t('identities.history.minted', link.minted ?? 0) }}</span>
      <span v-else>{{ t('identities.history.kind.' + link.kind) }}</span>
      <span v-if="link.reserveDelta">{{ reserveDeltaText(link) }}</span>
      <span v-if="linkDate(link.timestamp)">{{ linkDate(link.timestamp) }}</span>
      <span v-if="madeByThisWallet(link.hash)" class="identity-badge">{{ t('identities.history.madeHere') }}</span>
      <a :href="`${store.explorerUrl}/${link.hash}`" target="_blank" class="mono">{{ link.hash.slice(0, 10) }}</a>
    </div>
  </div>
</template>

<style scoped>
.chain-link {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
</style>
