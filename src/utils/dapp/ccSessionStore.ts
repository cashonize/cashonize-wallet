import { PrivateKey } from "@cashconnect-js/core/primitives";
import { LocalStorageStore, type Store } from "@cashconnect-js/nostr";
import type { WalletSession } from "@cashconnect-js/nostr/wallet";

// the library's default namespace, so sessions paired before keep working
const SESSION_KEY_PREFIX = "bch-cc-v1:wallet-session:";

// CashConnect keeps sessions per identity key, which a seed shares across mainnet and chipnet, so
// started on one network the library would restore the dApps paired on the other. Only the sessions
// of `chain` are listed; the others stay saved until their network is active again.
export function sessionStoreForChain(cashConnectPrivateKey: Uint8Array, chain: string): Store<WalletSession> {
  const publicKeyHex = PrivateKey.from(cashConnectPrivateKey).derivePublicKey().toHex();
  const store = new LocalStorageStore<WalletSession>(`${SESSION_KEY_PREFIX}${publicKeyHex}:`);
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    async list() {
      const keys = await store.list();
      const sessions = await Promise.all(keys.map((key) => store.get(key)));
      return keys.filter((_, index) => sessions[index]?.chain === chain);
    },
  };
}

// Un-pairing through the library reaches only the sessions of the network it was started on
export function removeAllCashConnectSessions() {
  const sessionKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(SESSION_KEY_PREFIX)) sessionKeys.push(key);
  }
  for (const key of sessionKeys) localStorage.removeItem(key);
}
