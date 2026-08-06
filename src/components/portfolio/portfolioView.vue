<script setup lang="ts">
  import { ref, computed, watch, onActivated } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { convert } from 'mainnet-js'
  import { CurrencyShortNames } from 'src/interfaces/interfaces'
  import { calculateTokenFiatValue } from 'src/utils/cauldronApi'
  import { formatFiatAmount } from 'src/utils/utils'
  import { extractDominantIconColor, colorDistance, clampColorLightness } from 'src/utils/iconColorUtils'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // number of individually colored chart segments, all further assets group into 'Other'
  const MAX_SEGMENTS = 4
  // gap between chart segments, in percent of the circle
  const SEGMENT_GAP = 0.4

  // Chart colors: BCH always keeps the brand green; token segments prefer their
  // icon's dominant color and fall back to the fixed palette when the icon has no
  // dominant hue or it sits too close to an already-assigned color. The fixed
  // palettes are validated for contrast and colorblind separation on their surface.
  // Icon colors are only clamped away from the surface lightness (not too light on
  // the light surface, not too dark on the dark one) so they keep resembling the icon.
  const CHART_COLORS = {
    light: { bch: '#0ac18f', fallbacks: ['#2563eb', '#f59e0b', '#8b5cf6'], other: '#747681', minL: 0.3, maxL: 0.8 },
    dark: { bch: '#0a9e75', fallbacks: ['#2563eb', '#c17d08', '#8b5cf6'], other: '#8a8d96', minL: 0.55, maxL: 0.95 }
  }
  // minimum perceptual distance between chart colors (OKLab distance x100)
  const MIN_COLOR_DISTANCE = 15

  // shared color for all ParyonUSD loan segments, loans don't get individual colors
  const LOAN_COLOR = '#a231c1'

  const amountFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 })
  const bchValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 })

  // holdings below this share of the total collapse into the 'small balances' section
  const SMALL_SHARE_THRESHOLD = 0.001

  const displayUnit = ref<'currency' | 'bch'>('currency')
  const showSmallBalances = ref(false)
  const showUnpriced = ref(false)
  // fall back to BCH display while no exchange rate is available
  const effectiveUnit = computed(() => store.exchangeRate === undefined ? 'bch' : displayUnit.value)

  // fetch Cauldron prices whenever the token list is (re)loaded and on re-entering the
  // view; 'force' bypasses the fiat-value display setting since the user explicitly
  // opened the portfolio (the underlying fetches are cached for 5 minutes)
  watch(() => store.tokenList, () => void store.fetchCauldronPricesForTokens(true), { immediate: true })
  onActivated(() => void store.fetchCauldronPricesForTokens(true))

  interface PricedAsset {
    category?: string  // undefined for the BCH entry
    name: string
    symbol: string | undefined
    amountDisplay: string
    bchValue: number
  }
  interface UnpricedAsset {
    category: string
    name: string
    symbol: string | undefined
    amountDisplay: string
  }

  function formatTokenAmount(amount: bigint, decimals: number | undefined) {
    if (!decimals) return amountFormatter.format(amount)
    return amountFormatter.format(Number(amount) / (10 ** decimals))
  }

  // undefined while the wallet balance has not loaded yet
  const assets = computed(() => {
    if (store.balance === undefined) return undefined

    const bchBalance = Number(store.balance) / 100_000_000
    const bchEntry: PricedAsset = {
      name: 'Bitcoin Cash',
      symbol: 'BCH',
      amountDisplay: amountFormatter.format(bchBalance),
      bchValue: bchBalance
    }

    const pricedTokens: PricedAsset[] = []
    const unpriced: UnpricedAsset[] = []
    for (const token of store.tokenList ?? []) {
      if (!('amount' in token)) continue
      const metadata = store.bcmrRegistries?.[token.category]
      const name = metadata?.name ?? token.category.slice(0, 8) + '...'
      const symbol = metadata?.token?.symbol
      const amountDisplay = formatTokenAmount(token.amount, metadata?.token?.decimals)

      const poolInfo = store.cauldronPrices?.[token.category]
      const bchValue = poolInfo ? calculateTokenFiatValue(token.amount, poolInfo, 1) : null
      if (bchValue !== null) {
        pricedTokens.push({ category: token.category, name, symbol, amountDisplay, bchValue })
      } else {
        unpriced.push({ category: token.category, name, symbol, amountDisplay })
      }
    }
    pricedTokens.sort((a, b) => b.bchValue - a.bchValue)

    // BCH is pinned first so it always gets the primary green segment color
    return { priced: [bchEntry, ...pricedTokens], unpriced }
  })

  // loans with a positive net value (collateral minus debt) count towards the
  // total and the chart; an underwater loan only shows in the loans section
  const chartedLoans = computed(() => {
    return loanKeyNfts.value
      .map(loan => ({ ...loan, netBch: loanState(loan.utxo)?.netBch ?? 0 }))
      .filter(loan => loan.netBch > 0)
  })

  const totalBchValue = computed(() => {
    if (!assets.value) return undefined
    const pricedTotal = assets.value.priced.reduce((sum, asset) => sum + asset.bchValue, 0)
    const loansTotal = chartedLoans.value.reduce((sum, loan) => sum + loan.netBch, 0)
    return pricedTotal + loansTotal
  })

  // split the priced list for display while keeping the original index, since
  // the chart segment colors are assigned by position in the full priced list;
  // BCH is always shown in the main list no matter how small its share
  const pricedWithIndex = computed(() => {
    return (assets.value?.priced ?? []).map((asset, index) => ({ asset, index }))
  })
  const mainPricedAssets = computed(() => {
    return pricedWithIndex.value.filter(({ asset, index }) =>
      index === 0 || assetShare(asset.bchValue) >= SMALL_SHARE_THRESHOLD
    )
  })
  const smallPricedAssets = computed(() => {
    return pricedWithIndex.value.filter(({ asset, index }) =>
      index !== 0 && assetShare(asset.bchValue) < SMALL_SHARE_THRESHOLD
    )
  })

  // ParyonUSD loan key NFTs get their own section: a loan carries both collateral
  // and debt, so it doesn't fit the chart as a single positive value
  const showLoans = ref(false)

  const loanKeyNfts = computed(() => {
    const loans: { category: string, utxo: Utxo, name: string }[] = []
    for (const token of store.tokenList ?? []) {
      if (!('nfts' in token)) continue
      const metadata = store.bcmrRegistries?.[token.category]
      const extensions = metadata?.extensions
      if (!(extensions?.paryonusd ?? extensions?.pusd)) continue
      // only owner loan keys (minting capability) control a loan, management keys don't
      for (const utxo of token.nfts) {
        if (utxo.token?.nft?.capability !== 'minting') continue
        loans.push({ category: token.category, utxo, name: metadata?.name ?? token.category.slice(0, 8) + '...' })
      }
    }
    return loans
  })

  interface LoanState {
    collateralDisplay: string | undefined  // always in BCH, as formatted by the NFT parser
    debtDisplay: string | undefined
    netBch: number | undefined             // collateral minus debt, for the value column
  }
  const loanStates = ref<Record<string, LoanState>>({})

  function loanUtxoId(utxo: Utxo) {
    return `${utxo.txid}:${utxo.vout}`
  }
  function loanState(utxo: Utxo) {
    return loanStates.value[loanUtxoId(utxo)]
  }
  function loanNetDisplay(utxo: Utxo) {
    const netBch = loanState(utxo)?.netBch
    if (netBch === undefined) return undefined
    return formatBchValue(netBch)
  }

  // Loan state lives on-chain and is fetched through the paryonusd BCMR extension.
  // Parsed as soon as the loan keys are known since the net values feed the chart
  watch(loanKeyNfts, (loans) => {
    for (const loan of loans) {
      const utxoId = loanUtxoId(loan.utxo)
      if (loanStates.value[utxoId]) continue
      void store.parseNftCommitment(loan.category, loan.utxo).then(async result => {
        const namedFields = (result?.success ? result.namedFields : undefined) ?? []
        const findField = (word: string) =>
          namedFields.find(field => field.name?.toLowerCase().includes(word))
        const collateralParsed = findField('collateral')?.parsedValue
        const debtParsed = findField('debt')?.parsedValue

        // net position value: collateral (BCH) minus debt (PUSD, treated as USD)
        let netBch: number | undefined
        if (collateralParsed?.type === 'number' && debtParsed?.type === 'number') {
          try {
            const collateralBch = Number(collateralParsed.value) / (10 ** (collateralParsed.decimals ?? 0))
            const debtUsd = Number(debtParsed.value) / (10 ** (debtParsed.decimals ?? 0))
            const debtBch = await convert(debtUsd, 'usd', 'bch')
            netBch = collateralBch - Number(debtBch)
          } catch {
            // exchange rate unavailable, leave the net value out
          }
        }
        loanStates.value = {
          ...loanStates.value,
          [utxoId]: { collateralDisplay: collateralParsed?.formatted, debtDisplay: debtParsed?.formatted, netBch }
        }
      })
    }
  }, { immediate: true })

  const hasFungibleTokens = computed(() => (store.tokenList ?? []).some(token => 'amount' in token))

  // True once metadata, prices and the icon colors for the colored segments have all
  // settled. The chart is held in a loading state until then, so it appears in its
  // final form instead of visibly repainting as async data arrives.
  const portfolioReady = computed(() => {
    if (!assets.value) return false
    if (!hasFungibleTokens.value) return true
    if (!store.bcmrRegistries || store.cauldronPrices === null) return false
    if (!settingsStore.disableTokenIcons) {
      for (const { asset } of pricedWithIndex.value.slice(0, MAX_SEGMENTS)) {
        if (!asset.category) continue
        const url = store.tokenIconUrl(asset.category)
        if (url && !(asset.category in iconColors.value)) return false
      }
    }
    // loan net values feed the chart and total, so wait for their on-chain state too
    if (loanKeyNfts.value.some(loan => !loanState(loan.utxo))) return false
    return true
  })

  const iconColors = ref<Record<string, string | null>>({})
  const pendingIconExtractions = new Set<string>()

  // extract dominant icon colors for the assets that get their own chart segment
  watch(() => pricedWithIndex.value.slice(0, MAX_SEGMENTS), (topAssets) => {
    if (settingsStore.disableTokenIcons) return
    for (const { asset } of topAssets) {
      const category = asset.category
      if (!category || category in iconColors.value || pendingIconExtractions.has(category)) continue
      // tokenIconUrl is undefined until the BCMR metadata has loaded; skip without
      // recording a result so a later pass retries once the registries are in
      const url = store.tokenIconUrl(category)
      if (!url) continue
      pendingIconExtractions.add(category)
      void extractDominantIconColor(url).then(color => {
        pendingIconExtractions.delete(category)
        iconColors.value = { ...iconColors.value, [category]: color }
      })
    }
  }, { immediate: true })

  // Assign chart colors in holding-size order so that on a conflict the larger
  // holding keeps its color and the smaller one falls back to the palette
  const segmentColors = computed<string[]>(() => {
    const theme = settingsStore.darkMode ? CHART_COLORS.dark : CHART_COLORS.light
    const assigned = [theme.bch, theme.other]
    const isDistinct = (color: string) => assigned.every(existing => colorDistance(color, existing) >= MIN_COLOR_DISTANCE)

    const colors: string[] = []
    for (const { asset, index } of pricedWithIndex.value.slice(0, MAX_SEGMENTS)) {
      if (index === 0) {
        colors.push(theme.bch)
        continue
      }
      const candidates: string[] = []
      const iconColor = asset.category ? iconColors.value[asset.category] : null
      if (iconColor) candidates.push(clampColorLightness(iconColor, theme.minL, theme.maxL))
      candidates.push(...theme.fallbacks)
      const lastResort = theme.fallbacks[(index - 1) % theme.fallbacks.length] ?? theme.other
      const chosen = candidates.find(isDistinct) ?? lastResort
      assigned.push(chosen)
      colors.push(chosen)
    }
    return colors
  })

  const otherColor = computed(() => (settingsStore.darkMode ? CHART_COLORS.dark : CHART_COLORS.light).other)

  function segmentColorAt(index: number) {
    return segmentColors.value[index] ?? otherColor.value
  }

  function assetShare(bchValue: number) {
    if (!totalBchValue.value) return 0
    return bchValue / totalBchValue.value
  }

  function formatShare(share: number) {
    if (share > 0 && share < 0.001) return '<0.1%'
    return (share * 100).toFixed(1) + '%'
  }

  function formatBchValue(bchValue: number) {
    if (effectiveUnit.value === 'currency' && store.exchangeRate !== undefined) {
      return formatFiatAmount(bchValue * store.exchangeRate, settingsStore.currency)
    }
    return bchValueFormatter.format(bchValue) + ' BCH'
  }

  // chart segments as stroke-dasharray fractions of a circle with circumference 100
  const chartSegments = computed(() => {
    const priced = assets.value?.priced
    const total = totalBchValue.value
    if (!priced || !total) return []

    const top = priced.slice(0, MAX_SEGMENTS).map((asset, index) => (
      { label: asset.name, bchValue: asset.bchValue, color: segmentColorAt(index) }
    ))
    const restValue = priced.slice(MAX_SEGMENTS).reduce((sum, asset) => sum + asset.bchValue, 0)
    if (restValue > 0) top.push({ label: t('portfolio.other'), bchValue: restValue, color: otherColor.value })
    for (const loan of chartedLoans.value) {
      top.push({ label: loan.name, bchValue: loan.netBch, color: LOAN_COLOR })
    }

    const shown = top.filter(segment => segment.bchValue > 0)
    const gap = shown.length > 1 ? SEGMENT_GAP : 0
    let cumulative = 0
    return shown.map(segment => {
      const length = (segment.bchValue / total) * 100
      const result = {
        ...segment,
        share: segment.bchValue / total,
        dashLength: Math.max(length - gap, 0.4),
        dashOffset: -cumulative
      }
      cumulative += length
      return result
    })
  })
</script>

<template>
  <fieldset class="item" style="padding-bottom: 2.5rem;">
    <legend>{{ t('portfolio.title') }}</legend>

    <div class="top-row">
      <div style="cursor: pointer;" @click="() => store.changeView(1)">
        ← {{ t('portfolio.backToWallet') }}
      </div>
      <div v-if="store.network === 'mainnet'" class="unit-toggle">
        <button
          :class="{ active: effectiveUnit === 'currency' }"
          :disabled="store.exchangeRate === undefined"
          @click="displayUnit = 'currency'"
        >{{ CurrencyShortNames[settingsStore.currency] }}</button>
        <button :class="{ active: effectiveUnit === 'bch' }" @click="displayUnit = 'bch'">BCH</button>
      </div>
    </div>

    <div class="page-description">
      {{ t('portfolio.description') }}
      <InfoPopup>
        <div>{{ t('portfolio.pricesInfo') }}</div>
        <div class="info-popup-note">{{ t('portfolio.nftsExcluded') }}</div>
      </InfoPopup>
    </div>

    <div v-if="store.network !== 'mainnet'" class="page-note">
      {{ t('portfolio.mainnetOnly') }}
    </div>

    <div v-else-if="!assets || !portfolioReady" style="text-align: center;">
      <template v-if="store.walletInitFailed">{{ t('portfolio.loadingFailed') }}</template>
      <template v-else>{{ t('portfolio.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <div v-else-if="!totalBchValue && !assets.unpriced.length" class="page-note">
      {{ t('portfolio.noAssets') }}
    </div>

    <template v-else>
      <div class="donut-wrap">
        <svg viewBox="0 0 42 42" aria-hidden="true">
          <g transform="rotate(-90 21 21)" fill="none" stroke-width="4.5">
            <circle
              v-for="(segment, index) in chartSegments"
              :key="index"
              cx="21" cy="21" r="15.9155"
              stroke="currentColor"
              :style="{ color: segment.color }"
              :stroke-dasharray="`${segment.dashLength} ${100 - segment.dashLength}`"
              :stroke-dashoffset="segment.dashOffset"
            >
              <title>{{ segment.label }}: {{ formatBchValue(segment.bchValue) }} ({{ formatShare(segment.share) }})</title>
            </circle>
          </g>
        </svg>
        <div class="donut-center">
          <div class="donut-center-label">{{ t('portfolio.totalValue') }}</div>
          <div class="donut-center-amount">{{ formatBchValue(totalBchValue ?? 0) }}</div>
        </div>
      </div>

      <div class="asset-list">
        <div v-for="{ asset, index } in mainPricedAssets" :key="asset.category ?? 'bch'" class="asset-row">
          <span class="dot" :style="{ color: segmentColorAt(index) }"></span>
          <img v-if="!asset.category" src="images/bch-icon.png" class="bch-icon">
          <TokenIcon
            v-else
            :token-id="asset.category"
            :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(asset.category) : undefined"
            :size="32"
          />
          <div class="asset-name">
            <div>{{ asset.name }}</div>
            <div class="sub">{{ asset.amountDisplay }} {{ asset.symbol }}</div>
          </div>
          <div class="asset-value">
            <div>{{ formatBchValue(asset.bchValue) }}</div>
            <div class="sub">{{ formatShare(assetShare(asset.bchValue)) }}</div>
          </div>
        </div>
      </div>

      <template v-if="loanKeyNfts.length">
        <div class="section-label collapsible" @click="showLoans = !showLoans">
          <q-icon name="expand_more" class="chevron" :class="{ open: showLoans }" />
          {{ t('portfolio.paryonLoans', { count: loanKeyNfts.length }) }}
        </div>
        <div v-if="showLoans" class="asset-list">
          <div v-for="loan in loanKeyNfts" :key="loanUtxoId(loan.utxo)" class="asset-row">
            <span class="dot" :style="{ color: LOAN_COLOR }"></span>
            <TokenIcon
              :token-id="loan.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(loan.category) : undefined"
              :size="32"
            />
            <div class="asset-name">
              <div>{{ loan.name }}</div>
              <div v-if="loanState(loan.utxo)?.collateralDisplay" class="sub">
                {{ t('portfolio.collateral') }}: {{ loanState(loan.utxo)?.collateralDisplay }}
              </div>
              <div v-if="loanState(loan.utxo)?.debtDisplay" class="sub">
                {{ t('portfolio.debt') }}: {{ loanState(loan.utxo)?.debtDisplay }}
              </div>
            </div>
            <div class="asset-value">
              <template v-if="!loanState(loan.utxo)">
                <q-spinner-dots size="1.2em" />
              </template>
              <template v-else-if="loanNetDisplay(loan.utxo)">
                <div>{{ loanNetDisplay(loan.utxo) }}</div>
                <div class="sub">{{ t('portfolio.netValue') }}</div>
              </template>
            </div>
          </div>
        </div>
      </template>

      <template v-if="smallPricedAssets.length">
        <div class="section-label collapsible" @click="showSmallBalances = !showSmallBalances">
          <q-icon name="expand_more" class="chevron" :class="{ open: showSmallBalances }" />
          {{ t('portfolio.smallBalances', { count: smallPricedAssets.length }) }}
        </div>
        <div v-if="showSmallBalances" class="asset-list">
          <div v-for="{ asset, index } in smallPricedAssets" :key="asset.category ?? 'bch'" class="asset-row">
            <span class="dot" :style="{ color: segmentColorAt(index) }"></span>
            <TokenIcon
              v-if="asset.category"
              :token-id="asset.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(asset.category) : undefined"
              :size="32"
            />
            <div class="asset-name">
              <div>{{ asset.name }}</div>
              <div class="sub">{{ asset.amountDisplay }} {{ asset.symbol }}</div>
            </div>
            <div class="asset-value">
              <div>{{ formatBchValue(asset.bchValue) }}</div>
              <div class="sub">{{ formatShare(assetShare(asset.bchValue)) }}</div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="assets.unpriced.length">
        <div class="section-label collapsible" @click="showUnpriced = !showUnpriced">
          <q-icon name="expand_more" class="chevron" :class="{ open: showUnpriced }" />
          {{ t('portfolio.noPriceData', { count: assets.unpriced.length }) }}
        </div>
        <div v-if="showUnpriced" class="asset-list">
          <div v-for="asset in assets.unpriced" :key="asset.category" class="asset-row">
            <span class="dot"></span>
            <TokenIcon
              :token-id="asset.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(asset.category) : undefined"
              :size="32"
            />
            <div class="asset-name">
              <div>{{ asset.name }}</div>
              <div class="sub">{{ asset.amountDisplay }} {{ asset.symbol }}</div>
            </div>
            <div class="asset-value"></div>
          </div>
        </div>
      </template>

    </template>
  </fieldset>
</template>

<style scoped>
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.unit-toggle {
  display: flex;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 999px;
  overflow: hidden;
}
.unit-toggle button {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 4px 14px;
  font-size: 0.9em;
  color: var(--font-color);
  cursor: pointer;
}
.unit-toggle button.active {
  background-color: var(--color-primary);
  color: white;
}
.unit-toggle button:disabled {
  opacity: 0.4;
  cursor: default;
}

.page-description {
  text-align: center;
  margin-bottom: 15px;
}
.page-note {
  text-align: center;
  color: grey;
  margin: 20px 0;
}

.donut-wrap {
  position: relative;
  width: min(260px, 70vw);
  margin: 10px auto 20px;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.donut-center-label {
  font-size: 0.85em;
  color: grey;
}
.donut-center-amount {
  font-size: 1.25em;
  font-weight: 600;
}

.asset-list {
  max-width: 40rem;
  margin: 0 auto;
}
.asset-row {
  display: grid;
  grid-template-columns: 12px 32px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.asset-row:last-child {
  border-bottom: none;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: currentColor;
  color: transparent;
}
.bch-icon {
  width: 32px;
  height: 32px;
}
.asset-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.asset-value {
  text-align: right;
  white-space: nowrap;
}
.sub {
  font-size: 0.85em;
  color: grey;
}
.section-label {
  max-width: 40rem;
  margin: 20px auto 5px;
  font-size: 0.85em;
  color: grey;
}
.section-label.collapsible {
  cursor: pointer;
  user-select: none;
}
.chevron {
  transform: rotate(-90deg);
  transition: transform 0.2s;
  vertical-align: -0.2em;
}
.chevron.open {
  transform: rotate(0deg);
}

</style>
