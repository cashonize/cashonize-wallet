// Private transaction notes, stored in localStorage per wallet per network as a txid → note map.
// Keyed by txid so notes survive rescans and re-imports; notes never leave the device.

export const maxTxNoteLength = 200;

type Network = 'mainnet' | 'chipnet';

function txNotesKey(network: Network, walletName: string): string {
  return `txNotes-${network}-${walletName}`;
}

export function loadTxNotes(network: Network, walletName: string): Record<string, string> {
  const readTxNotes = localStorage.getItem(txNotesKey(network, walletName));
  if (!readTxNotes) return {};
  try {
    return JSON.parse(readTxNotes) as Record<string, string>;
  } catch {
    return {};
  }
}

// Fresh read-modify-write: another tab may have written notes since this tab loaded them,
// so re-read before writing to only ever overwrite the single txid being edited.
// An empty note deletes the entry. Returns the updated map for the caller's reactive state.
export function saveTxNote(
  network: Network,
  walletName: string,
  txid: string,
  note: string
): Record<string, string> {
  const txNotes = loadTxNotes(network, walletName);
  const trimmedNote = note.trim().slice(0, maxTxNoteLength);
  if (trimmedNote) {
    txNotes[txid] = trimmedNote;
  } else {
    delete txNotes[txid];
  }
  localStorage.setItem(txNotesKey(network, walletName), JSON.stringify(txNotes));
  return txNotes;
}

// A future wallet created under the same name must not inherit the old wallet's notes
export function removeTxNotes(walletName: string) {
  localStorage.removeItem(txNotesKey('mainnet', walletName));
  localStorage.removeItem(txNotesKey('chipnet', walletName));
}
