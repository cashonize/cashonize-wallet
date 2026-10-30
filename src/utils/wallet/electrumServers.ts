// The electrum server modes. Failover itself is the library's (createFailoverProvider); the app
// decides which servers it may use, in which order.
//   automatic: the last server that worked first, then the curated list
//   preferred: the user's pick first, then the curated list; back to the pick at the next open
//   single: the user's pick and nothing else, ever

export type ElectrumServerMode = 'automatic' | 'preferred' | 'single'
export type ElectrumNetwork = 'mainnet' | 'chipnet'

export const electrumServerModes: readonly ElectrumServerMode[] = ['automatic', 'preferred', 'single']

// Short on purpose: every server failed over to sees all of a wallet's addresses
export const curatedElectrumServers: Record<ElectrumNetwork, readonly string[]> = {
  mainnet: [
    "electrum.imaginary.cash",
    "bch.imaginary.cash",
    "cashnode.bch.ninja",
    "fulcrum.greyh.at",
    "electroncash.dk",
    "fulcrum.jettscythe.xyz",
    "bch.loping.net",
    "fulcrum.criptolayer.net",
  ],
  chipnet: [
    "chipnet.imaginary.cash",
    "chipnet.c3-soft.com:64004",
    "chipnet.bch.ninja",
  ],
}

// The servers the mode may use, in the order they are tried. A server outside the curated list
// (a custom one) never mixes into it.
export function electrumServerList(
  mode: ElectrumServerMode,
  selected: string,
  lastGood: string | null,
  curated: readonly string[],
): string[] {
  if (mode === 'single') return [selected]
  let first: string | undefined = undefined
  if (mode === 'preferred') {
    if (!curated.includes(selected)) return [selected]
    first = selected
  }
  if (mode === 'automatic' && lastGood && curated.includes(lastGood)) first = lastGood
  if (!first) return [...curated]
  return [first, ...curated.filter(server => server !== first)]
}

export function electrumServersOf(network: ElectrumNetwork, mode: ElectrumServerMode, selected: string): string[] {
  return electrumServerList(mode, selected, loadLastGoodElectrumServer(network), curatedElectrumServers[network])
}

// State rather than an option, so not among the settings menu keys
const lastGoodKey = (network: ElectrumNetwork) => `electrumLastGood-${network}`

export function loadLastGoodElectrumServer(network: ElectrumNetwork): string | null {
  return localStorage.getItem(lastGoodKey(network))
}

export function saveLastGoodElectrumServer(network: ElectrumNetwork, server: string) {
  localStorage.setItem(lastGoodKey(network), server)
}

// A stored server predates the modes and was the user's explicit pick, which only ever meant that
// one server: it stays that, so nothing changes for whoever chose their own server
export function storedElectrumMode(network: ElectrumNetwork): ElectrumServerMode {
  const stored = localStorage.getItem(`electrumMode-${network}`)
  if (electrumServerModes.includes(stored as ElectrumServerMode)) return stored as ElectrumServerMode
  if (localStorage.getItem(`electrum-${network}`)) return 'single'
  return 'automatic'
}
