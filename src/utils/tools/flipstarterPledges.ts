// Pledges the wallet has made, stored in localStorage per wallet per network keyed by the
// outpoint of the coin backing each one. The signed pledge is kept so the user can copy it again
// after closing the page; none of this leaves the device.

type Network = 'mainnet' | 'chipnet';

export interface FlipstarterPledge {
  satoshis: string; // bigint, which JSON.stringify throws on
  // every recipient, so the pledge can be described later without the template
  outputs: { address: string; satoshis: string }[];
  expires: number; // unix seconds, from the template
  pledgedAt: number; // unix seconds
  alias: string;
  comment: string;
  signedPledge: string;
}

export type FlipstarterPledges = Record<string, FlipstarterPledge>;

// A pledge is only ever listed while the wallet still holds its coin, so there is no state for a
// coin that is gone: without the campaign backend the wallet cannot tell a completed campaign from
// a cancellation from another device spending it, and has nothing useful to say about any of them.
export type PledgeStatus = 'open' | 'expired';

function pledgesKey(network: Network, walletName: string): string {
  return `flipstarterPledges-${network}-${walletName}`;
}

export function loadPledges(network: Network, walletName: string): FlipstarterPledges {
  const readPledges = localStorage.getItem(pledgesKey(network, walletName));
  if (!readPledges) return {};
  try {
    return JSON.parse(readPledges) as FlipstarterPledges;
  } catch {
    return {};
  }
}

// Fresh read-modify-write: another tab may have pledged or cancelled since this tab loaded them,
// so re-read before writing to only ever change the single pledge in hand.
// Returns the updated map for the caller's reactive state.
export function savePledge(
  network: Network,
  walletName: string,
  outpoint: string,
  pledge: FlipstarterPledge,
): FlipstarterPledges {
  const pledges = loadPledges(network, walletName);
  pledges[outpoint] = pledge;
  localStorage.setItem(pledgesKey(network, walletName), JSON.stringify(pledges));
  return pledges;
}

// Same fresh read-modify-write approach as savePledge.
export function deletePledge(network: Network, walletName: string, outpoint: string): FlipstarterPledges {
  const pledges = loadPledges(network, walletName);
  delete pledges[outpoint];
  localStorage.setItem(pledgesKey(network, walletName), JSON.stringify(pledges));
  return pledges;
}

// A future wallet created under the same name must not inherit the old wallet's pledges
export function removePledges(walletName: string) {
  for (const network of ['mainnet', 'chipnet'] as const) {
    localStorage.removeItem(pledgesKey(network, walletName));
  }
}

export function pledgeStatus(pledge: FlipstarterPledge, nowSeconds: number): PledgeStatus {
  return pledge.expires <= nowSeconds ? 'expired' : 'open';
}
