<script setup lang="ts">
  // An identity's history, which is the chain itself: what each link did and how the reserve
  // moved. Fetched when opened, since it is the one identity query that grows with the chain.
  import { computed, onMounted, ref } from 'vue'
  import { displayAndLogError } from 'src/utils/errorHandling'
  import { useStore } from 'src/stores/store'
  import { useIdentitiesStore } from 'src/stores/identitiesStore'
  import { useI18n } from 'vue-i18n'
  import { formatTokenAmountWithSymbol } from 'src/utils/utils'
  import { maxTokenSupply } from 'src/utils/tools/tokenCreation'
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
  // What the pill says. A plain operation is named by what the reserve did, which is the only
  // thing such a link changes that the chain can show.
  function pillKindOf(link: DescribedLink) {
    // the authbase is "pre-genesis" only when a genesis follows: a non-token identity has none
    if (link.kind === 'authbase' && history.value?.[1]?.kind !== 'genesis') return 'authbaseNoGenesis'
    if (link.kind !== 'operation') return link.kind
    if (link.reserveDelta < 0n) return 'issued'
    if (link.reserveDelta > 0n) return 'reserved'
    return 'operation'
  }
  function reserveDeltaText(link: DescribedLink) {
    const size = link.reserveDelta < 0n ? -link.reserveDelta : link.reserveDelta
    // the largest amount a category can hold is the AuthGuard mark for a supply with no ceiling,
    // said in the card's words rather than as nineteen digits
    let amount = formatTokenAmountWithSymbol(size, store.bcmrRegistries?.[props.identity.category])
    if (size === maxTokenSupply) amount = t('identities.history.openEndedSupply')
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
      <span class="description chain-date">{{ linkDate(link.timestamp) }}</span>
      <span class="chain-kinds">
        <!-- a burn that did nothing else is told by its marker alone -->
        <span v-if="!(link.burned && pillKindOf(link) === 'operation')" class="chain-kind" :class="pillKindOf(link)">
          {{ t('identities.history.kind.' + pillKindOf(link)) }}
        </span>
        <span v-if="link.burned" class="chain-kind burned">{{ t('identities.history.kind.burned') }}</span>
      </span>
      <span class="chain-detail">
        <span v-if="link.kind === 'mint'">{{ t('identities.history.minted', link.minted ?? 0) }}</span>
        <span v-if="link.reserveDelta">{{ reserveDeltaText(link) }}</span>
        <span v-if="link.publication && link.kind !== 'publication'">{{ t('identities.history.publishedToo') }}</span>
        <span v-if="madeByThisWallet(link.hash)" class="identity-badge">{{ t('identities.history.madeHere') }}</span>
      </span>
      <a :href="`${store.explorerUrl}/${link.hash}`" target="_blank" class="chain-explorer-link">
        {{ t('identities.history.viewTransaction') }}
      </a>
    </div>
  </div>
</template>

<style scoped>
/* date, pill, detail, link: a chronology reads from the date, the pills line up as labels,
   the detail wraps within its column, and the link keeps its place at the end of every row */
.chain-link {
  display: grid;
  grid-template-columns: max-content max-content 1fr max-content;
  gap: 4px 12px;
  align-items: center;
  margin-top: 6px;
}
/* The pills have a palette of their own, tinted per kind the way a block explorer does it: the
   events holders notice get a colour, the bookkeeping stays neutral. Each tone is a text colour
   with its own tint behind it, lightened on the dark surface. */
.chain-kinds {
  display: flex;
  gap: 6px;
  justify-self: start;
}
/* the bookkeeping kinds read as muted text on their tint; the coloured kinds carry the weight */
.chain-kind {
  font-size: 0.85em;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1px solid var(--color-grey);
  background: rgba(128, 128, 128, 0.12);
  color: var(--color-grey);
  white-space: nowrap;
}
.chain-kind.genesis,
.chain-kind.publication,
.chain-kind.transfer,
.chain-kind.mint,
.chain-kind.issued,
.chain-kind.burned {
  font-weight: 600;
}
.chain-kind.authbase,
.chain-kind.authbaseNoGenesis {
  color: #3d6b8e;
  background: #e9f2f8;
  border-color: #c5dbe8;
}
.chain-kind.genesis {
  color: #1c5bb8;
  background: #e8f1fe;
  border-color: #c3d8f6;
}
.chain-kind.publication {
  color: #0a7d55;
  background: #e6f7ef;
  border-color: #b7e6cf;
}
.chain-kind.transfer {
  color: #92660a;
  background: #fef5e5;
  border-color: #f4dea8;
}
.chain-kind.mint {
  color: #5b3ca8;
  background: #f1ecfb;
  border-color: #dbccf3;
}
.chain-kind.issued {
  color: #0891b2;
  background: #e0f7fa;
  border-color: #a5e8f2;
}
.chain-kind.burned {
  color: #c0392b;
  background: #fdeceb;
  border-color: #f5c5c0;
}
body.dark .chain-kind.authbase,
body.dark .chain-kind.authbaseNoGenesis {
  color: #9fc4de;
  background: rgba(61, 107, 142, 0.28);
  border-color: rgba(159, 196, 222, 0.4);
}
body.dark .chain-kind.genesis {
  color: #8ab4f8;
  background: rgba(28, 91, 184, 0.25);
  border-color: rgba(138, 180, 248, 0.4);
}
body.dark .chain-kind.publication {
  color: #5fd3a5;
  background: rgba(10, 125, 85, 0.25);
  border-color: rgba(95, 211, 165, 0.4);
}
body.dark .chain-kind.transfer {
  color: #f0c060;
  background: rgba(146, 102, 10, 0.25);
  border-color: rgba(240, 192, 96, 0.4);
}
body.dark .chain-kind.mint {
  color: #c4a8f5;
  background: rgba(91, 60, 168, 0.3);
  border-color: rgba(196, 168, 245, 0.4);
}
body.dark .chain-kind.issued {
  color: #5fd4e8;
  background: rgba(8, 145, 178, 0.28);
  border-color: rgba(95, 212, 232, 0.4);
}
body.dark .chain-kind.burned {
  color: #f28b82;
  background: rgba(192, 57, 43, 0.25);
  border-color: rgba(242, 139, 130, 0.45);
}
.chain-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
}
.chain-date {
  white-space: nowrap;
}
.chain-explorer-link {
  white-space: nowrap;
  text-decoration: none;
}
/* narrow: the date and the pill on one line, the detail and the link on the next */
@media (max-width: 500px) {
  .chain-link {
    grid-template-columns: max-content 1fr;
  }
  .chain-detail {
    grid-column: 1 / -1;
  }
  .chain-explorer-link {
    grid-column: 1 / -1;
  }
}
</style>
