<script setup lang="ts">
  import { ref, computed, watch, onActivated } from 'vue'
  import type { Utxo } from 'mainnet-js'
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useI18n } from 'vue-i18n'
  import { convert } from 'mainnet-js'
  import { CurrencyShortNames } from 'src/interfaces/interfaces'
  import { calculateTokenFiatValue } from 'src/utils/cauldronApi'
  import { formatFiatAmount, satsToBch } from 'src/utils/utils'
  import { extractDominantIconColor, colorDistance, clampColorLightness } from 'src/utils/iconColorUtils'
  import TokenIcon from '../general/TokenIcon.vue'
  import InfoPopup from '../general/InfoPopup.vue'
  import loanKeyItem from './loanKeyItem.vue'
  import stakingReceiptItem from './stakingReceiptItem.vue'
  import cauldronPoolItem from './cauldronPoolItem.vue'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  // number of individually colored chart segments, all further assets group into 'Other'
  const MAX_SEGMENTS = 4
  // gap between chart segments, in percent of the circle
  const SEGMENT_GAP = 0.4
  // smallest arc a segment is drawn at, in percent of the circle, so that tiny
  // holdings stay visible; capped to the segment's own share when that is smaller
  const MIN_SEGMENT_LENGTH = 0.4

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

  // ParyonUSD staking receipt category and shared segment color
  const PARYON_STAKING_CATEGORY = '7708645a7f30e97003573d9322202960a560a87527bef3666a30044a0dfdfa81'
  const STAKING_COLOR = '#378df5'

  // shared color for all Cauldron liquidity pool segments
  const POOL_COLOR = '#d6336c'

  const amountFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 })
  const bchValueFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 })

  // holdings below this share of the total collapse into the 'small balances' section
  const SMALL_SHARE_THRESHOLD = 0.001

  const displayUnit = ref<'currency' | 'bch'>('currency')
  const showSmallBalances = ref(false)
  const showUnpriced = ref(false)
  // chipnet balances are shown in the mainnet BCH price here just like on the wallet
  // page, marked with the same 't' prefix on the unit and currency names
  const bchUnitName = computed(() => store.network === 'mainnet' ? 'BCH' : 'tBCH')
  const currencyName = computed(() => {
    return (store.network === 'mainnet' ? '' : 't') + CurrencyShortNames[settingsStore.currency]
  })
  // fall back to BCH display while no exchange rate is available
  const effectiveUnit = computed(() => store.exchangeRate === undefined ? 'bch' : displayUnit.value)

  // Look up the wallet's Cauldron pools and fetch prices whenever the token list is (re)loaded
  // and on entering the view; 'force' bypasses the fiat-value display setting since the user
  // explicitly opened the portfolio (the underlying price fetches are cached for 5 minutes).
  // Prices are fetched after the pools so the pools' tokens are priced along with the held ones.
  async function loadPoolsAndPrices() {
    await store.fetchWalletCauldronPools()
    await store.fetchCauldronPricesForTokens(true)
  }
  // the view is kept alive, so onActivated covers the first visit as well as later ones
  watch(() => store.tokenList, () => void loadPoolsAndPrices())
  onActivated(() => void loadPoolsAndPrices())

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

  // undefined while the wallet balance or the token list has not loaded yet
  const assets = computed(() => {
    if (store.balance === undefined || store.tokenList === null) return undefined

    const bchBalance = Number(store.balance) / 100_000_000
    const bchEntry: PricedAsset = {
      name: 'Bitcoin Cash',
      symbol: bchUnitName.value,
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

  // Cauldron liquidity pools the wallet owns. Both sides of a pool are still the user's funds,
  // the tokens in it are valued like held tokens are
  interface PoolAsset {
    id: string
    category: string
    name: string
    bchDisplay: string
    tokenDisplay: string
    bchValue: number
  }
  const poolAssets = computed<PoolAsset[]>(() => {
    return (store.cauldronPools ?? []).map(pool => {
      const metadata = store.bcmrRegistries?.[pool.tokenId]
      const symbol = metadata?.token?.symbol
      const poolBch = satsToBch(pool.satoshis)
      const priceInfo = store.cauldronPrices?.[pool.tokenId]
      const tokenBchValue = priceInfo ? calculateTokenFiatValue(pool.tokenAmount, priceInfo, 1) : null
      // a pool holds the same value on both sides at its own price, so where the Cauldron price
      // is missing the BCH side is the closest estimate of what the tokens in it are worth. The
      // liquidity minimum that leaves a held token unpriced therefore does not apply to pools.
      return {
        id: `${pool.txid}:${pool.vout}`,
        category: pool.tokenId,
        name: metadata?.name ?? pool.tokenId.slice(0, 8) + '...',
        bchDisplay: bchValueFormatter.format(poolBch) + ' ' + bchUnitName.value,
        tokenDisplay: formatTokenAmount(pool.tokenAmount, metadata?.token?.decimals) + (symbol ? ' ' + symbol : ''),
        bchValue: poolBch + (tokenBchValue ?? poolBch)
      }
    })
  })

  const totalBchValue = computed(() => {
    if (!assets.value) return undefined
    const pricedTotal = assets.value.priced.reduce((sum, asset) => sum + asset.bchValue, 0)
    const poolsTotal = poolAssets.value.reduce((sum, pool) => sum + pool.bchValue, 0)
    const loansTotal = chartedLoans.value.reduce((sum, loan) => sum + loan.netBch, 0)
    let stakingTotal = 0
    if (includeStaking.value) {
      stakingTotal = stakingReceiptNfts.value.reduce(
        (sum, receipt) => sum + Math.max(stakingState(receipt.utxo)?.stakeBch ?? 0, 0), 0
      )
    }
    return pricedTotal + poolsTotal + loansTotal + stakingTotal
  })

  // split the priced list for display while keeping the original index, since
  // the chart segment colors are assigned by position in the full priced list;
  // BCH is always shown in the main list no matter how small its share
  const pricedWithIndex = computed(() => {
    return (assets.value?.priced ?? []).map((asset, index) => ({ asset, index }))
  })
  interface AssetRow { kind: 'asset', asset: PricedAsset, index: number, value: number }
  interface PoolRow { kind: 'pool', pool: PoolAsset, value: number }
  interface LoanRow { kind: 'loan', loan: { category: string, utxo: Utxo, name: string }, value: number }
  interface StakingRow { kind: 'staking', receipt: { category: string, utxo: Utxo, name: string }, value: number }
  type DisplayRow = AssetRow | PoolRow | LoanRow | StakingRow

  // priced assets, pools, loans and staking receipts merged and sorted big to small for
  // display; an underwater loan sorts with value 0 but stays visible in the main list
  const displayRows = computed<DisplayRow[]>(() => {
    const assetRows: DisplayRow[] = pricedWithIndex.value.map(({ asset, index }) => (
      { kind: 'asset', asset, index, value: asset.bchValue }
    ))
    const poolRows: DisplayRow[] = poolAssets.value.map(pool => (
      { kind: 'pool', pool, value: pool.bchValue }
    ))
    const loanRows: DisplayRow[] = loanKeyNfts.value.map(loan => (
      { kind: 'loan', loan, value: Math.max(loanState(loan.utxo)?.netBch ?? 0, 0) }
    ))
    const stakingRows: DisplayRow[] = stakingReceiptNfts.value.map(receipt => (
      { kind: 'staking', receipt, value: stakingState(receipt.utxo)?.stakeBch ?? 0 }
    ))
    return [...assetRows, ...poolRows, ...loanRows, ...stakingRows].sort((a, b) => b.value - a.value)
  })

  // BCH, pools, loans and staking receipts always show in the main list, small token holdings collapse
  const mainRows = computed(() => {
    return displayRows.value.filter(row =>
      row.kind !== 'asset' || row.index === 0 || assetShare(row.value) >= SMALL_SHARE_THRESHOLD
    )
  })
  const smallAssetRows = computed(() => {
    return displayRows.value.filter((row): row is AssetRow =>
      row.kind === 'asset' && row.index !== 0 && assetShare(row.value) < SMALL_SHARE_THRESHOLD
    )
  })

  function rowKey(row: DisplayRow) {
    if (row.kind === 'asset') return row.asset.category ?? 'bch'
    if (row.kind === 'pool') return row.pool.id
    return nftUtxoId(row.kind === 'loan' ? row.loan.utxo : row.receipt.utxo)
  }

  // ParyonUSD loan key NFTs are listed with the priced assets, showing both
  // collateral and debt, and are charted by their net value
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

  function nftUtxoId(utxo: Utxo) {
    return `${utxo.txid}:${utxo.vout}`
  }
  function loanState(utxo: Utxo) {
    return loanStates.value[nftUtxoId(utxo)]
  }
  function loanNetDisplay(utxo: Utxo) {
    const netBch = loanState(utxo)?.netBch
    if (netBch === undefined) return undefined
    return formatBchValue(netBch)
  }
  function loanShareDisplay(utxo: Utxo) {
    const netBch = loanState(utxo)?.netBch
    if (netBch === undefined || netBch <= 0) return undefined
    return formatShare(assetShare(netBch))
  }

  // Loan state lives on-chain and is fetched through the paryonusd BCMR extension.
  // Parsed as soon as the loan keys are known since the net values feed the chart
  watch(loanKeyNfts, (loans) => {
    for (const loan of loans) {
      const utxoId = nftUtxoId(loan.utxo)
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

  // ParyonUSD staking receipts. The commitment records the amount staked at an
  // epoch, but the live stake can have been reduced since, so their value is an
  // estimate, excluded from the chart and total unless the user opts in
  const includeStaking = ref(false)

  const stakingReceiptNfts = computed(() => {
    const receipts: { category: string, utxo: Utxo, name: string }[] = []
    for (const token of store.tokenList ?? []) {
      if (!('nfts' in token) || token.category !== PARYON_STAKING_CATEGORY) continue
      const metadata = store.bcmrRegistries?.[token.category]
      for (const utxo of token.nfts) {
        receipts.push({ category: token.category, utxo, name: metadata?.name ?? 'ParyonUSD Staking Receipt' })
      }
    }
    return receipts
  })

  interface StakingState {
    stakedDisplay: string | undefined
    epochDisplay: string | undefined
    stakeBch: number | undefined  // estimated, used for sorting and the value column
  }
  const stakingStates = ref<Record<string, StakingState>>({})

  function stakingState(utxo: Utxo) {
    return stakingStates.value[nftUtxoId(utxo)]
  }
  function stakingValueDisplay(utxo: Utxo) {
    const stakeBch = stakingState(utxo)?.stakeBch
    if (stakeBch === undefined) return undefined
    return formatBchValue(stakeBch)
  }
  function stakingShareDisplay(utxo: Utxo) {
    const stakeBch = stakingState(utxo)?.stakeBch
    if (!includeStaking.value || stakeBch === undefined || stakeBch <= 0) return undefined
    return formatShare(assetShare(stakeBch))
  }

  // receipt commitments parse locally (no extension), so this is cheap
  watch(stakingReceiptNfts, (receipts) => {
    for (const receipt of receipts) {
      const utxoId = nftUtxoId(receipt.utxo)
      if (stakingStates.value[utxoId]) continue
      // receipts are detected by category before the BCMR metadata has loaded;
      // parsing needs the metadata's parse info, so skip without recording a
      // result and let a later pass retry once the registries are in
      if (!store.bcmrRegistries?.[receipt.category]) continue
      void store.parseNftCommitment(receipt.category, receipt.utxo).then(async result => {
        const namedFields = (result?.success ? result.namedFields : undefined) ?? []
        const stakedParsed = namedFields.find(field => field.fieldId === 'amountStakedReceipt')?.parsedValue
        const epochParsed = namedFields.find(field => field.fieldId === 'epochReceipt')?.parsedValue

        // estimated value: the staked PUSD amount, treated as USD
        let stakeBch: number | undefined
        if (stakedParsed?.type === 'number') {
          try {
            const stakedUsd = Number(stakedParsed.value) / (10 ** (stakedParsed.decimals ?? 0))
            stakeBch = Number(await convert(stakedUsd, 'usd', 'bch'))
          } catch {
            // exchange rate unavailable, leave the estimated value out
          }
        }
        stakingStates.value = {
          ...stakingStates.value,
          [utxoId]: { stakedDisplay: stakedParsed?.formatted, epochDisplay: epochParsed?.formatted, stakeBch }
        }
      })
    }
  }, { immediate: true })

  const hasFungibleTokens = computed(() => (store.tokenList ?? []).some(token => 'amount' in token))

  // Safety valve for the loading gate: a hanging icon fetch or a wedged electrum
  // request would otherwise keep the view loading forever, so after a generous
  // timeout the page renders with whatever has settled (missing icon colors fall
  // back to the palette, unresolved loan and staking rows keep their spinners)
  const READY_TIMEOUT_MS = 10_000
  const readyTimeoutElapsed = ref(false)
  setTimeout(() => { readyTimeoutElapsed.value = true }, READY_TIMEOUT_MS)

  // True once metadata, prices and the icon colors for the colored segments have all
  // settled. The chart is held in a loading state until then, so it appears in its
  // final form instead of visibly repainting as async data arrives.
  const portfolioReady = computed(() => {
    if (!assets.value) return false
    if (readyTimeoutElapsed.value) return true
    // any token needs the BCMR registries: fungible display data and the
    // loan/staking detection both come from the metadata
    if ((store.tokenList?.length ?? 0) > 0 && !store.bcmrRegistries) return false
    if (hasFungibleTokens.value && store.cauldronPrices === null) return false
    // pools are looked up on entering the view and add to the total and the chart
    if (store.cauldronPools === null) return false
    if (!settingsStore.disableTokenIcons) {
      // without fungible tokens this loop only sees the BCH entry and no-ops
      for (const { asset } of pricedWithIndex.value.slice(0, MAX_SEGMENTS)) {
        if (!asset.category) continue
        const url = store.tokenIconUrl(asset.category)
        if (url && !(asset.category in iconColors.value)) return false
      }
    }
    // loan net values feed the chart and total, so wait for their on-chain state too
    if (loanKeyNfts.value.some(loan => !loanState(loan.utxo))) return false
    if (stakingReceiptNfts.value.some(receipt => !stakingState(receipt.utxo))) return false
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
    return bchValueFormatter.format(bchValue) + ' ' + bchUnitName.value
  }

  // Custom hover tooltip for the chart, positioned relative to the donut wrapper
  const donutWrapRef = ref<HTMLElement | null>(null)
  const hoveredSegmentIndex = ref<number | null>(null)
  const tooltipPosition = ref({ x: 0, y: 0 })

  const hoveredSegment = computed(() => {
    if (hoveredSegmentIndex.value === null) return undefined
    return chartSegments.value[hoveredSegmentIndex.value]
  })

  function moveSegmentTooltip(event: MouseEvent, index: number) {
    hoveredSegmentIndex.value = index
    const wrapRect = donutWrapRef.value?.getBoundingClientRect()
    if (!wrapRect) return
    tooltipPosition.value = { x: event.clientX - wrapRect.left, y: event.clientY - wrapRect.top }
  }

  // Chart segments as stroke-dasharray fractions of a circle with circumference 100.
  // Drawn in display-list order so the slices visually map to the rows, with the
  // 'Other' bucket (tokens beyond the individually colored ones) at the end
  const chartSegments = computed(() => {
    const total = totalBchValue.value
    if (!assets.value || !total) return []

    const segments: { label: string, bchValue: number, color: string }[] = []
    let otherValue = 0
    for (const row of displayRows.value) {
      if (row.kind === 'asset') {
        // an asset gets its own slice only when it shows in the main list (BCH
        // always, tokens above the small-balance threshold) and is within the
        // color budget; everything else folds into 'Other' with the small balances
        const hasOwnSegment = row.index < MAX_SEGMENTS
          && (row.index === 0 || assetShare(row.value) >= SMALL_SHARE_THRESHOLD)
        if (hasOwnSegment) {
          segments.push({ label: row.asset.name, bchValue: row.asset.bchValue, color: segmentColorAt(row.index) })
        } else {
          otherValue += row.asset.bchValue
        }
      } else if (row.kind === 'pool' && row.value > 0) {
        segments.push({ label: row.pool.name, bchValue: row.value, color: POOL_COLOR })
      } else if (row.kind === 'loan' && row.value > 0) {
        segments.push({ label: row.loan.name, bchValue: row.value, color: LOAN_COLOR })
      } else if (row.kind === 'staking' && includeStaking.value && row.value > 0) {
        segments.push({ label: row.receipt.name, bchValue: row.value, color: STAKING_COLOR })
      }
    }
    if (otherValue > 0) segments.push({ label: t('portfolio.other'), bchValue: otherValue, color: otherColor.value })

    const shown = segments.filter(segment => segment.bchValue > 0)
    const gap = shown.length > 1 ? SEGMENT_GAP : 0
    let cumulative = 0
    return shown.map(segment => {
      const length = (segment.bchValue / total) * 100
      const result = {
        ...segment,
        share: segment.bchValue / total,
        // never draw an arc longer than the share it owns, a sliver smaller than the
        // minimum would otherwise run past its slice and paint over the next segment
        dashLength: Math.min(Math.max(length - gap, MIN_SEGMENT_LENGTH), length),
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
      <div class="unit-toggle">
        <button
          :class="{ active: effectiveUnit === 'currency' }"
          :disabled="store.exchangeRate === undefined"
          @click="displayUnit = 'currency'"
        >{{ currencyName }}</button>
        <button :class="{ active: effectiveUnit === 'bch' }" @click="displayUnit = 'bch'">{{ bchUnitName }}</button>
      </div>
    </div>

    <div class="page-description">
      {{ t('portfolio.description') }}
      <InfoPopup>
        <div>{{ t('portfolio.pricesInfo') }}</div>
        <div class="info-popup-note">{{ t('portfolio.nftsExcluded') }}</div>
      </InfoPopup>
    </div>

    <div v-if="!assets || !portfolioReady" style="text-align: center;">
      <template v-if="store.walletInitFailed">{{ t('portfolio.loadingFailed') }}</template>
      <template v-else>{{ t('portfolio.loading') }} <q-spinner-dots size="1.2em" /></template>
    </div>

    <div v-else-if="!totalBchValue && !assets.unpriced.length" class="page-note">
      {{ t('portfolio.noAssets') }}
    </div>

    <template v-else>
      <div class="donut-wrap" ref="donutWrapRef">
        <svg viewBox="0 0 42 42" aria-hidden="true">
          <g transform="rotate(-90 21 21)" fill="none" stroke-width="4.5">
            <circle
              v-for="(segment, index) in chartSegments"
              :key="index"
              cx="21" cy="21" r="15.9155"
              pathLength="100"
              stroke="currentColor"
              :class="{ hovered: hoveredSegmentIndex === index }"
              :style="{ color: segment.color }"
              :stroke-dasharray="`${segment.dashLength} ${100 - segment.dashLength}`"
              :stroke-dashoffset="segment.dashOffset"
              @mousemove="moveSegmentTooltip($event, index)"
              @mouseleave="hoveredSegmentIndex = null"
            />
          </g>
        </svg>
        <div
          v-if="hoveredSegment"
          class="chart-tooltip"
          :style="{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }"
        >
          <div class="chart-tooltip-title">
            <span class="chart-tooltip-dot" :style="{ backgroundColor: hoveredSegment.color }"></span>
            {{ hoveredSegment.label }}
          </div>
          <div>{{ formatBchValue(hoveredSegment.bchValue) }} ({{ formatShare(hoveredSegment.share) }})</div>
        </div>
        <div class="donut-center">
          <div class="donut-center-label">{{ t('portfolio.totalValue') }}</div>
          <div class="donut-center-amount">{{ formatBchValue(totalBchValue ?? 0) }}</div>
        </div>
      </div>

      <div v-if="stakingReceiptNfts.length" class="include-staking">
        {{ t('portfolio.includeStaked') }} <q-toggle v-model="includeStaking" dense />
      </div>

      <div class="asset-list">
        <template v-for="row in mainRows" :key="rowKey(row)">
          <div v-if="row.kind === 'asset'" class="asset-row">
            <span class="dot" :style="{ color: segmentColorAt(row.index) }"></span>
            <img v-if="!row.asset.category" src="images/bch-icon.png" class="bch-icon">
            <TokenIcon
              v-else
              :token-id="row.asset.category"
              :icon-url="!settingsStore.disableTokenIcons ? store.tokenIconUrl(row.asset.category) : undefined"
              :size="32"
            />
            <div class="asset-name">
              <div>{{ row.asset.name }}</div>
              <div class="sub">{{ row.asset.amountDisplay }} {{ row.asset.symbol }}</div>
            </div>
            <div class="asset-value">
              <div>{{ formatBchValue(row.asset.bchValue) }}</div>
              <div class="sub">{{ formatShare(assetShare(row.asset.bchValue)) }}</div>
            </div>
          </div>
          <cauldronPoolItem
            v-else-if="row.kind === 'pool'"
            :category="row.pool.category"
            :name="row.pool.name"
            :dot-color="POOL_COLOR"
            :bch-display="row.pool.bchDisplay"
            :token-display="row.pool.tokenDisplay"
            :value-display="formatBchValue(row.pool.bchValue)"
            :share-display="row.pool.bchValue > 0 ? formatShare(assetShare(row.pool.bchValue)) : undefined"
          />
          <loanKeyItem
            v-else-if="row.kind === 'loan'"
            :category="row.loan.category"
            :name="row.loan.name"
            :dot-color="LOAN_COLOR"
            :state="loanState(row.loan.utxo)"
            :net-value-display="loanNetDisplay(row.loan.utxo)"
            :share-display="loanShareDisplay(row.loan.utxo)"
          />
          <stakingReceiptItem
            v-else
            :category="row.receipt.category"
            :name="row.receipt.name"
            :dot-color="includeStaking ? STAKING_COLOR : undefined"
            :state="stakingState(row.receipt.utxo)"
            :estimated-value-display="stakingValueDisplay(row.receipt.utxo)"
            :share-display="stakingShareDisplay(row.receipt.utxo)"
          />
        </template>
      </div>

      <template v-if="smallAssetRows.length">
        <div class="section-label collapsible" @click="showSmallBalances = !showSmallBalances">
          <q-icon name="expand_more" class="chevron" :class="{ open: showSmallBalances }" />
          {{ t('portfolio.smallBalances', { count: smallAssetRows.length }) }}
        </div>
        <div v-if="showSmallBalances" class="asset-list">
          <div v-for="{ asset } in smallAssetRows" :key="asset.category ?? 'bch'" class="asset-row">
            <span class="dot" :style="{ color: otherColor }"></span>
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
  border: 1px solid var(--color-lightGrey);
  border-radius: 999px;
  overflow: hidden;
}
/* unselected segments need a raised surface on the black background */
body.dark .unit-toggle button:not(.active) {
  background-color: var(--bg-secondary-color);
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

/* hovered slice thickens slightly as feedback */
.donut-wrap svg circle {
  transition: stroke-width 0.15s;
}
.donut-wrap svg circle.hovered {
  stroke-width: 5.2;
}

/* cursor-following tooltip, styled like the app's info popups */
.chart-tooltip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  background: #2d2d33;
  color: #f5f5f5;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
.chart-tooltip-title {
  font-weight: 600;
}
.chart-tooltip-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 4px;
}

.include-staking {
  text-align: center;
  margin-bottom: 15px;
}

.asset-list {
  max-width: 40rem;
  margin: 0 auto;
}
/* :deep() so the shared row styling also reaches rows rendered by loanKeyItem */
.asset-list :deep(.asset-row) {
  display: grid;
  grid-template-columns: 12px 32px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.asset-list :deep(.asset-row:last-child) {
  border-bottom: none;
}
.asset-list :deep(.dot) {
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
.asset-list :deep(.asset-name) {
  min-width: 0;
  overflow-wrap: anywhere;
}
.asset-list :deep(.asset-value) {
  text-align: right;
  white-space: nowrap;
}
.asset-list :deep(.sub) {
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
