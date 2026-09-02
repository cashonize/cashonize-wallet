// Everything the wallet knows about the identities it follows: which ones are listed, where each
// one's authhead sits now, what its published metadata serves, and the keys and guards around it.
// Split out of the main store the way the dapp-connection stores are, reaching back to it for the
// wallet, its coins and the reservations - because holding a coin back is the main store's job,
// and deciding which coin that is, is this one's.

import { defineStore } from "pinia"
import { ref, computed } from 'vue'
import type { Utxo } from "mainnet-js"
import { useStore } from "./store"
import { useSettingsStore } from "./settingsStore"
import {
  loadIdentityList,
  addToIdentityList,
  removeFromIdentityList,
  clearIdentityList,
  loadAuthheadNaming,
  saveAuthheadNaming,
  deleteAuthheadNaming,
  resolveIdentities,
  describeChainLinks,
  checkPublicationUri,
  identityKeyCoin,
  type AuthheadNaming,
  type IdentityState,
  type IdentityScanSummary,
  type IdentityStatus,
  type DescribedLink,
  type GuardedIdentity,
  type PublicationUriCheck,
} from "src/utils/tools/authchainIdentity"
import { detectIdentities, nameChainByWalkingBack, publicationTxids } from "src/utils/tools/identityDetection"
import { authGuardAddresses, isAuthKeyCandidate, guardContentsFromUtxos } from "src/utils/tools/authGuard"
import { queryAuthHeadWithOutputs, queryAuthchainLinks, type ChaingraphSpentOutput } from "src/queryChainGraph"
import { outpointOf } from "src/utils/wallet/reservedUtxos"


export const useIdentitiesStore = defineStore('identities', () => {
  const mainStore = useStore()
  const settingsStore = useSettingsStore()

  // Token categories whose authhead this wallet keeps custody of, and where those authheads sit
  // now. Only the categories persist, the resolved state is rebuilt from Chaingraph every time
  // (see utils/tools/authchainIdentity.ts).
  const identityCategories = ref([] as string[]);
  // AuthKey categories this wallet watches without holding the key
  const watchedAuthKeys = ref([] as string[]);
  // Categories the user took off the list, which the automatic detection must not put back
  const dismissedIdentities = ref([] as string[]);
  // Listed by the wallet itself and not yet seen: what the marker on the wallet tools entry is
  // for, and what marks the cards as found automatically on the visit that clears it
  const unseenIdentities = ref([] as string[]);
  // Key candidates already put to the user once. The shape of an identity key is a shape ordinary
  // NFTs can have, so an unexamined one is worth asking about exactly once.
  const examinedKeyCandidates = ref([] as string[]);
  // Authheads held here that the detection could not name, and how far naming each one got.
  // Protected either way: naming is a convenience, an unspendable coin is the point.
  const authheadNaming = ref({} as Record<string, AuthheadNaming>);
  // The wallet's own transactions that carried a metadata publication, read off the same walk, so
  // the history can tell a metadata update from the wallet's other identity operations
  const identityPublicationTxids = ref([] as string[]);
  const identities = ref(undefined as (IdentityState[] | undefined));
  // What each listed identity's published registry locations actually serve, keyed by category.
  // Kept beside the identities rather than on them: resolution reads the chain, this reads the
  // hosting, and one can be present without the other.
  const publicationChecks = ref({} as Record<string, PublicationUriCheck[]>);
  const publicationChecksRunning = ref(false);
  // Identity outputs a covenant holds for this wallet, keyed by category, rebuilt on every resolve
  // like everything else about an authhead. Never stored: a key's guard is derived from it.
  const guardedIdentities = ref({} as Record<string, GuardedIdentity>);
  // Guarded outputs found but not nameable without a lookup this version does not have, per key
  // category, so a key that guards only those does not read as guarding nothing.
  const unidentifiedGuarded = ref({} as Record<string, number>);
  // Candidates whose covenant turned out to hold nothing, so they are ordinary NFTs after all.
  // Session-local on purpose: a stored answer would be a stored derivation, and asking again after
  // a restart costs one listing.
  let settledNonKeys: string[] = [];
  // One resolve at a time: a pass writes the identities list and the 'auth' reservations derived
  // from it whole, so two overlapping passes would undo each other's result
  const identitiesResolving = ref(false);

  // Called when a wallet becomes the active one: the lists are its own, and everything derived
  // from the chain starts empty rather than carrying the last wallet's answers.
  function loadForWallet(network: 'mainnet' | 'chipnet', walletName: string) {
    identityCategories.value = loadIdentityList('categories', network, walletName);
    watchedAuthKeys.value = loadIdentityList('authKeys', network, walletName);
    dismissedIdentities.value = loadIdentityList('dismissed', network, walletName);
    unseenIdentities.value = loadIdentityList('unseen', network, walletName);
    examinedKeyCandidates.value = loadIdentityList('examinedKeys', network, walletName);
    announced.value = loadIdentityList('announced', network, walletName);
    authheadNaming.value = loadAuthheadNaming(network, walletName);
    identities.value = undefined;
    publicationChecks.value = {};
    identityHistories.value = {};
    guardedIdentities.value = {};
    unidentifiedGuarded.value = {};
    settledNonKeys = [];
  }

  // Identities these keys made, found in the walk rather than asked for. This is the one place
  // the wallet lists something the user did not: the creator whose authhead sits here as an
  // anonymous coin is exactly the one who never opens the page, and an ordinary send spends it.
  // Deliberately amends the rule that only listed identities are reserved: the walk is evidence,
  // not a guess, and the coin is an authhead.
  function listDetectedIdentities(spentOutputs: ChaingraphSpentOutput[]) {
    const heldAuthheads = (mainStore.walletUtxos ?? []).filter(utxo => utxo.vout === 0);
    const found = detectIdentities(spentOutputs).filter(
      identity => heldAuthheads.some(utxo => utxo.txid === identity.authheadTxid)
    );
    const listed: string[] = [];
    for (const identity of found) {
      // a chain the markers cannot name is protected all the same, by outpoint: naming it comes
      // after, and is never a condition of protecting it
      if (!identity.category) {
        if (dismissedIdentities.value.includes(identity.authheadTxid)) continue;
        if (identity.authheadTxid in authheadNaming.value) continue;
        // already named by the list, which resolved before this ran: not unnamed, not news
        if ((identities.value ?? []).some(listed => listed.authheadTxid === identity.authheadTxid)) continue;
        authheadNaming.value = saveAuthheadNaming(
          mainStore.network, mainStore.wallet.name, identity.authheadTxid, 'pending'
        );
        listed.push(identity.authheadTxid);
        continue;
      }
      if (dismissedIdentities.value.includes(identity.category)) continue;
      if (identityCategories.value.includes(identity.category)) continue;
      identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, identity.category);
      listed.push(identity.category);
    }
    // on the unseen list right away, so the count and the card's box do not wait on naming
    if (listed.length) unseenIdentities.value = addToIdentityList('unseen', mainStore.network, mainStore.wallet.name, listed);
    return listed;
  }

  // The wallet listed identities the user never asked for, so it says so once per wallet, with
  // names, at the moment the balance changes; later finds only count in the menus. Set after the
  // resolve so the dialog can say what each one carries; the wallet page opens it and clears this.
  const announced = ref([] as string[]);
  const announcement = ref<string[] | undefined>(undefined);
  function announceFound(ids: string[]) {
    if (!ids.length || announced.value.length) return;
    announced.value = addToIdentityList('announced', mainStore.network, mainStore.wallet.name, 'shown');
    announcement.value = ids;
  }

  // The registries of what is about to be shown, fetched so a dialog or the page can name it. A
  // fetch that fails leaves the id standing in for the name, which is honest, so it never throws.
  async function fetchMetadataFor(categories: string[]) {
    const missing = categories
      .filter(category => identityCategories.value.includes(category) && !mainStore.bcmrRegistries?.[category])
      .map(category => ({ category, amount: 0n }));
    if (!missing.length) return;
    try {
      await mainStore.fetchTokenMetadata(missing, false);
    } catch (error) {
      console.error("Failed to fetch metadata for identities:", error);
    }
  }

  // Protection first, so it never waits on naming; the announcement last, so it has names to say
  async function detectWalletIdentities(spentOutputs: ChaingraphSpentOutput[]) {
    identityPublicationTxids.value = publicationTxids(spentOutputs);
    const unseenBefore = unseenIdentities.value;
    if (!listDetectedIdentities(spentOutputs).length) return;
    await refreshIdentities();
    if (await nameUnnamedAuthheads()) await refreshIdentities();
    // what this pass added to the unseen list, under the category where naming found one
    const toAnnounce = unseenIdentities.value.filter(id => !unseenBefore.includes(id));
    await fetchMetadataFor(toAnnounce);
    announceFound(toAnnounce);
  }

  // The explicit check's deeper half: every held vout-0 coin that is not already accounted for is
  // walked back to see whether it is the authhead of some category. The same primitive naming
  // already uses, pointed at coins rather than at publications.
  async function deepScanHeldCoins() {
    const fetchTransaction = (txid: string) => mainStore.wallet.provider.getRawTransactionObject(txid);
    const listedAuthheads = (identities.value ?? []).map(identity => identity.authheadTxid);
    const candidates = (mainStore.walletUtxos ?? []).filter(utxo =>
      utxo.vout === 0
      && !listedAuthheads.includes(utxo.txid)
      && !(utxo.txid in authheadNaming.value)
      && !dismissedIdentities.value.includes(utxo.txid)
    );
    let found = 0;
    for (const coin of candidates) {
      const initialization = mainStore.currentInitializationToken();
      const walked = await nameChainByWalkingBack(coin.txid, fetchTransaction);
      if (initialization !== mainStore.currentInitializationToken()) return found;
      if (walked.outcome !== 'named') continue;
      const category = walked.category;
      if (identityCategories.value.includes(category)) continue;
      if (dismissedIdentities.value.includes(category)) continue;
      // the walk says which genesis, the forward query says that genesis still ends at this coin
      const confirmed = await queryAuthHeadWithOutputs(category, settingsStore.chaingraph)
        .then(result => result.txid === coin.txid)
        .catch(() => false);
      if (initialization !== mainStore.currentInitializationToken()) return found;
      if (!confirmed) continue;
      identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
      found += 1;
    }
    return found;
  }

  // Naming what is already protected. Each unnamed authhead is walked back to its genesis over
  // electrum, and the category that walk returns is confirmed forward through the authhead query
  // the rest of the page uses: the walk says which genesis, and the confirmation says that genesis
  // still ends here. A name that does not confirm is discarded and the coin stays protected.
  async function nameUnnamedAuthheads() {
    const coins = unnamedAuthheadCoins();
    if (!coins.length) return 0;
    const fetchTransaction = (txid: string) => mainStore.wallet.provider.getRawTransactionObject(txid);
    let named = 0;
    for (const coin of coins) {
      if (authheadNaming.value[coin.txid] === 'walkConcluded') continue;
      const initialization = mainStore.currentInitializationToken();
      const walked = await nameChainByWalkingBack(coin.txid, fetchTransaction);
      if (initialization !== mainStore.currentInitializationToken()) return named;
      if (walked.outcome === 'unnameable') {
        authheadNaming.value = saveAuthheadNaming(
          mainStore.network, mainStore.wallet.name, coin.txid, 'walkConcluded'
        );
        continue;
      }
      // 'unavailable' says nothing about the chain, so it is simply tried again next time
      if (walked.outcome !== 'named') continue;
      const category = walked.category;
      const confirmed = await queryAuthHeadWithOutputs(category, settingsStore.chaingraph)
        .then(result => result.txid === coin.txid)
        .catch(() => false);
      if (initialization !== mainStore.currentInitializationToken()) return named;
      if (!confirmed) continue;
      authheadNaming.value = deleteAuthheadNaming(mainStore.network, mainStore.wallet.name, coin.txid);
      // what was listed as a txid is now known by its category, and everything that reads the
      // unseen list, the dialog, the count and the card's box, looks it up by category
      if (unseenIdentities.value.includes(coin.txid)) {
        removeFromIdentityList('unseen', mainStore.network, mainStore.wallet.name, coin.txid);
        unseenIdentities.value = addToIdentityList('unseen', mainStore.network, mainStore.wallet.name, category);
      }
      if (identityCategories.value.includes(category)) continue;
      identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
      named += 1;
    }
    return named;
  }

  // An identity's own history, which is the chain itself: what each link did, and the reserve
  // read down the list, which is the issuance schedule. One query, and only when a card asks for
  // it: this is the one identity query that grows with a chain's length.
  const identityHistories = ref({} as Record<string, DescribedLink[]>);

  async function fetchIdentityHistory(category: string) {
    if (identityHistories.value[category]) return;
    const links = await queryAuthchainLinks(category, settingsStore.chaingraph);
    identityHistories.value = {
      ...identityHistories.value,
      [category]: describeChainLinks(links),
    };
  }

  // The page has been opened, so what it found on its own is no longer news
  // Coins shaped like an identity key that this wallet has never put to the user. Local and free:
  // the shape is read off the wallet's own coins, and what a candidate actually guards is looked
  // up by the identity resolve rather than here.
  const unexaminedKeyCandidates = computed(() => {
    const candidates = (mainStore.walletUtxos ?? []).filter(isAuthKeyCandidate);
    const categories = candidates.map(utxo => utxo.token!.category);
    return categories.filter(category => !examinedKeyCandidates.value.includes(category));
  });

  // What the notification trail counts: identities listed without being asked for, answered by
  // opening the page. A key candidate is a shape guess about an NFT and gets no wallet-level
  // marker; the token item carries that nudge.
  const unseenCount = computed(() => unseenIdentities.value.length);
  const identitiesNeedAttention = computed(() => unseenCount.value > 0);

  // Asked once. A candidate that turns out to guard nothing is still examined: the wallet keeps
  // looking every session, the user is not asked again.
  function markKeyCandidatesExamined() {
    const unexamined = unexaminedKeyCandidates.value;
    if (!unexamined.length) return;
    examinedKeyCandidates.value = addToIdentityList(
      'examinedKeys', mainStore.network, mainStore.wallet.name, unexamined
    );
  }

  function markIdentitiesSeen() {
    const unseen = unseenIdentities.value;
    clearIdentityList('unseen', mainStore.network, mainStore.wallet.name);
    unseenIdentities.value = [];
    return unseen;
  }

  // What the AuthKeys this wallet holds are guarding. The fingerprint is local and free, the guard
  // listing is not, so it runs only where resolution runs and skips candidates already settled as
  // ordinary NFTs. A key is confirmed by its covenant holding something, never by shape alone:
  // freezing an innocent NFT on a lucky commitment would be protection nobody asked for.
  async function resolveAuthKeys() {
    const heldCandidates = (mainStore.walletUtxos ?? []).filter(
      utxo => isAuthKeyCandidate(utxo) && !settledNonKeys.includes(utxo.token!.category)
    );
    // A watched key has no coin here; its guard is derived and listed the same way, and what it
    // holds reads as watched rather than held.
    const candidates: { category: string, keyUtxo?: Utxo }[] = [
      ...heldCandidates.map(keyUtxo => ({ category: keyUtxo.token!.category, keyUtxo })),
      ...watchedAuthKeys.value
        .filter(category => !heldCandidates.some(utxo => utxo.token!.category === category))
        .map(category => ({ category })),
    ];
    const guarded: Record<string, GuardedIdentity> = {};
    const unidentified: Record<string, number> = {};
    for (const { category, keyUtxo } of candidates) {
      const guardAddresses = authGuardAddresses(category, mainStore.wallet.networkPrefix);
      // both hash lengths a covenant address can use, since deployments exist in both
      const guardUtxos = await Promise.all([
        mainStore.wallet.provider.getUtxos(guardAddresses.p2sh20.tokenAddress),
        mainStore.wallet.provider.getUtxos(guardAddresses.p2sh32.tokenAddress),
      ]);
      const contents = [
        { addresses: guardAddresses.p2sh20, contents: guardContentsFromUtxos(guardUtxos[0]) },
        { addresses: guardAddresses.p2sh32, contents: guardContentsFromUtxos(guardUtxos[1]) },
      ];
      const found = contents.reduce((total, guard) =>
        total + guard.contents.identified.length + guard.contents.unidentified, 0);
      if (!found) {
        // only a held candidate is a guess worth settling; a watched one the user named stays
        if (keyUtxo) settledNonKeys.push(category);
        continue;
      }
      unidentified[category] = contents.reduce((total, guard) => total + guard.contents.unidentified, 0);
      for (const guard of contents) {
        for (const output of guard.contents.identified) {
          guarded[output.category] = {
            category: output.category,
            authheadTxid: output.utxo.txid,
            identityOutput: output.utxo,
            ...(keyUtxo ? { keyUtxo } : {}),
            guardAddress: guard.addresses.tokenAddress,
          };
        }
      }
    }
    guardedIdentities.value = guarded;
    unidentifiedGuarded.value = unidentified;
    return guarded;
  }

  // Re-resolved rather than restored: an authhead moves to a new outpoint whenever the metadata is
  // updated elsewhere. One owner for both the list and the 'auth' reservations rewritten from it.
  async function resolveListedIdentities() {
    const currentUtxos = mainStore.walletUtxos;
    if (!currentUtxos) return;
    // before the listing is read, since a guarded identity found here joins it
    const guarded = await resolveAuthKeys();
    const foundByKey: string[] = [];
    for (const category of Object.keys(guarded)) {
      if (identityCategories.value.includes(category)) continue;
      identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
      foundByKey.push(category);
    }
    // listed without being asked for, so the page owes the user the same notice the walk gives
    if (foundByKey.length) {
      unseenIdentities.value = addToIdentityList('unseen', mainStore.network, mainStore.wallet.name, foundByKey);
    }
    if (!identityCategories.value.length) {
      identities.value = [];
      // still runs: it reserves the unnamed authheads, and clears an 'auth' reservation left
      // behind by an identity that is no longer listed
      await syncAuthReservations([]);
      return;
    }
    const initialization = mainStore.currentInitializationToken();
    const resolved = await resolveIdentities(
      identityCategories.value, settingsStore.chaingraph, currentUtxos, guarded
    );
    if (initialization !== mainStore.currentInitializationToken()) return;
    identities.value = resolved;
    forgetStaleHistories(resolved);
    await syncAuthReservations(resolved);
  }

  // A cached chain ends at the authhead it was fetched for, so an authhead that has moved since
  // means the cache is missing its newest link. Keyed on the authhead rather than on this wallet
  // having spent it, so an update made elsewhere with the same keys invalidates it too.
  function forgetStaleHistories(resolved: IdentityState[]) {
    const stale = resolved.filter(identity => {
      const cached = identityHistories.value[identity.category];
      return cached?.length && cached[cached.length - 1]!.hash !== identity.authheadTxid;
    });
    if (!stale.length) return;
    const histories = { ...identityHistories.value };
    for (const identity of stale) delete histories[identity.category];
    identityHistories.value = histories;
  }

  async function refreshIdentities() {
    if (identitiesResolving.value) return;
    identitiesResolving.value = true;
    try {
      await resolveListedIdentities();
    } finally {
      identitiesResolving.value = false;
    }
  }

  // Held authheads that carry no identity of their own on the list: same protection, no name
  // Unnamed is derived, never stored: a coin the resolved list accounts for is not unnamed,
  // whichever list found it first, so a naming entry left in the map renders nothing
  function unnamedAuthheadCoins() {
    const named = (identities.value ?? []).map(identity => identity.authheadTxid);
    return (mainStore.walletUtxos ?? []).filter(
      utxo => utxo.vout === 0 && utxo.txid in authheadNaming.value && !named.includes(utxo.txid)
    );
  }

  // Holds back every authhead this wallet has and drops an 'auth' reservation on a coin that is no
  // longer one - never while an identity is unresolved though, since a failed lookup says nothing
  // about where its authhead went: an outage leaves coins locked rather than releasing them.
  // The writes go under whichever wallet is active when they run, so a wallet switch landing
  // between two of them is checked for before every write, not once on entry.
  async function syncAuthReservations(resolved: IdentityState[]) {
    const initialization = mainStore.currentInitializationToken();
    const walletChanged = () => initialization !== mainStore.currentInitializationToken();
    const authOutpoints: string[] = [];
    for (const coin of unnamedAuthheadCoins()) {
      const outpoint = outpointOf(coin);
      authOutpoints.push(outpoint);
      if (walletChanged()) return;
      if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveUtxo(coin, 'auth');
    }
    for (const identity of resolved) {
      // the identity output when this wallet holds it, the AuthKey when a covenant does: either
      // way it is the coin the authority rides on, and one key can carry several identities
      const keyCoin = identityKeyCoin(identity);
      if (!keyCoin) continue;
      const outpoint = outpointOf(keyCoin);
      authOutpoints.push(outpoint);
      // A reservation already made for another reason is left alone: the coin is held back either
      // way, and rewriting the reason would take it away from whatever made it
      if (walletChanged()) return;
      if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveUtxo(keyCoin, 'auth');
    }
    if (resolved.some(identity => identity.status === 'unresolved')) return;
    for (const [outpoint, reservation] of Object.entries(mainStore.reservedUtxos)) {
      if (reservation.reason !== 'auth') continue;
      if (authOutpoints.includes(outpoint)) continue;
      if (walletChanged()) return;
      await mainStore.dropReservation(outpoint);
    }
  }

  // The explicit check for authhead ownership, over the categories this wallet holds tokens of.
  // A found authhead joins the list the same way a manual add does, whether or not it carries a
  // reserve. Categories with no held supply are not covered here and stay a manual add.
  // The category half of the check: every held token category not yet listed gets its authhead
  // resolved and compared against the wallet's coins, one query each. A find joins the list.
  // Undefined when the wallet changed underneath it.
  async function resolveHeldCategories() {
    const currentUtxos = mainStore.walletUtxos;
    if (!currentUtxos) return undefined;
    const heldCategories = (mainStore.tokenList ?? []).map(token => token.category);
    const listedCount = heldCategories.filter(category => identityCategories.value.includes(category)).length;
    const categoriesToCheck = heldCategories.filter(category => !identityCategories.value.includes(category));
    const initialization = mainStore.currentInitializationToken();
    const resolved = await resolveIdentities(categoriesToCheck, settingsStore.chaingraph, currentUtxos);
    if (initialization !== mainStore.currentInitializationToken()) return undefined;
    const found = resolved.filter(
      identity => identity.authUtxo && !dismissedIdentities.value.includes(identity.category)
    );
    const dismissed = resolved.filter(
      identity => identity.authUtxo && dismissedIdentities.value.includes(identity.category)
    ).length;
    for (const identity of found) {
      identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, identity.category);
    }
    return { resolved, found, dismissed, listedCount };
  }

  // Every category failing the same way is the server being down, not a hundred separate
  // answers; the one reason is what the caller should show
  function outageReason(resolved: IdentityState[]) {
    if (!resolved.length || !resolved.every(identity => identity.status === 'unresolved')) return undefined;
    return resolved[0]?.unresolvedReason;
  }

  async function scanForIdentities(): Promise<IdentityScanSummary | undefined> {
    if (identitiesResolving.value) return undefined;
    identitiesResolving.value = true;
    try {
      const categories = await resolveHeldCategories();
      if (!categories) return undefined;
      const { resolved, found, dismissed, listedCount } = categories;
      // a check that could not ask has no answer to report, and "none found" would be a wrong one
      const outage = outageReason(resolved);
      if (outage) throw new Error(outage);
      // The one case the categories cannot reach: an authhead received from elsewhere, with no
      // token of its own held here and no activity by these keys to have been walked. Its coin is
      // walked back to a genesis instead, which costs a fetch a hop, hence only on the user's word.
      const deepScanned = await deepScanHeldCoins();

      // The list and its reservations are resolved whole rather than merged into here: a few
      // repeated queries for what the scan just found buy a single owner of that state.
      await resolveListedIdentities();
      return {
        found: found.length + deepScanned,
        alreadyListed: listedCount,
        carriesTokens: resolved.filter(identity => identity.fungibleSupply && identity.authUtxo?.token?.amount).length,
        mintingNfts: resolved.filter(identity => identity.authUtxo?.token?.nft?.capability === 'minting').length,
        failed: resolved.filter(identity => identity.status === 'unresolved').length,
        dismissed,
        deepScanned,
      };
    } finally {
      identitiesResolving.value = false;
    }
  }

  // What went wrong in a pass the wallet ran on its own at open, shown on the page where the
  // result would be rather than toasted on every open; cleared by the next pass that runs
  const openCheckError = ref<string | undefined>(undefined);

  // The developer option: the category half on every open, for wallets that receive identities.
  // A find enters the list and the trail the way a detected one does.
  async function checkHeldCategoriesOnOpen() {
    if (identitiesResolving.value) return;
    identitiesResolving.value = true;
    try {
      const categories = await resolveHeldCategories();
      if (!categories) return;
      const outage = outageReason(categories.resolved);
      if (outage) {
        openCheckError.value = outage;
        return;
      }
      if (!categories.found.length) return;
      const found = categories.found.map(identity => identity.category);
      unseenIdentities.value = addToIdentityList('unseen', mainStore.network, mainStore.wallet.name, found);
      await resolveListedIdentities();
      await fetchMetadataFor(found);
      announceFound(found);
    } finally {
      identitiesResolving.value = false;
    }
  }

  // Fetches every listed identity's published locations and compares what they serve against the
  // hash on chain. Only ever on the user opening the page: this reaches out to the identity's
  // hosting, which is not something to do quietly in the background on every wallet start.
  async function checkPublications() {
    const listed = identities.value?.filter(identity => identity.publication) ?? [];
    if (!listed.length) return;
    publicationChecksRunning.value = true;
    try {
      const initialization = mainStore.currentInitializationToken();
      const checked = await Promise.all(listed.map(async identity => {
        const publication = identity.publication!;
        const checks = await Promise.all(publication.uris.map(
          uri => checkPublicationUri(uri, publication.hash, settingsStore.ipfsGateway)
        ));
        return [identity.category, checks] as const;
      }));
      if (initialization !== mainStore.currentInitializationToken()) return;
      publicationChecks.value = Object.fromEntries(checked);
    } finally {
      publicationChecksRunning.value = false;
    }
  }

  // The identities an AuthKey of this category guards, so the token list can render a key as what
  // it is rather than as an NFT with no metadata. Empty for anything that is not a confirmed key.
  function identitiesGuardedByKey(keyCategory: string) {
    return identities.value?.filter(
      identity => identity.keyUtxo?.token?.category === keyCategory
    ) ?? [];
  }

  // The identity of a token this wallet holds the authority over, directly or through a key, so
  // the token list can say so beside the token and point here. Nothing for a watched identity.
  function heldIdentityOf(category: string) {
    const identity = identities.value?.find(identity => identity.category === category);
    if (!identity) return undefined;
    const heldStatuses: IdentityStatus[] = ['held', 'carriesTokens', 'heldViaKey'];
    return heldStatuses.includes(identity.status) ? identity : undefined;
  }

  // A token category and an AuthKey category are both 64 hex, so the add input does not ask which
  // one it was given: it tries both readings and reports what each found.
  async function inspectCategory(category: string) {
    const guardAddresses = authGuardAddresses(category, mainStore.wallet.networkPrefix);
    const [authchain, p2sh20Utxos, p2sh32Utxos] = await Promise.all([
      queryAuthHeadWithOutputs(category, settingsStore.chaingraph).then(() => true).catch(() => false),
      mainStore.wallet.provider.getUtxos(guardAddresses.p2sh20.tokenAddress),
      mainStore.wallet.provider.getUtxos(guardAddresses.p2sh32.tokenAddress),
    ]);
    const contents = [guardContentsFromUtxos(p2sh20Utxos), guardContentsFromUtxos(p2sh32Utxos)];
    return {
      isTokenIdentity: authchain,
      guardedCategories: contents.flatMap(guard => guard.identified.map(output => output.category)),
      unidentifiedGuarded: contents.reduce((total, guard) => total + guard.unidentified, 0),
    };
  }

  async function addAuthKey(category: string) {
    watchedAuthKeys.value = addToIdentityList('authKeys', mainStore.network, mainStore.wallet.name, category);
    await refreshIdentities();
  }

  function removeAuthKey(category: string) {
    watchedAuthKeys.value = removeFromIdentityList('authKeys', mainStore.network, mainStore.wallet.name, category);
  }

  async function addIdentity(category: string) {
    // adding by hand undoes a dismissal: the user changed their mind, which is the whole point
    dismissedIdentities.value = removeFromIdentityList('dismissed', mainStore.network, mainStore.wallet.name, category);
    identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
    await refreshIdentities();
  }

  // An identity this wallet just created, token or not: its authhead is output 0 of the
  // transaction, so the coin is held back straight away rather than when Chaingraph or this
  // wallet's own view catches up.
  async function listCreatedIdentity(category: string, authheadTxId: string, authheadSatoshis: bigint) {
    dismissedIdentities.value = removeFromIdentityList('dismissed', mainStore.network, mainStore.wallet.name, category);
    identityCategories.value = addToIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
    const outpoint = `${authheadTxId}:0`;
    if (!mainStore.reservedUtxos[outpoint]) await mainStore.reserveOutpoint(outpoint, authheadSatoshis, 'auth');
    await refreshIdentities();
  }

  // The wallet's only way to stop holding an authhead back, for when the user wants to spend that
  // coin outside the identities page. Adding the identity again, by category or through the
  // ownership check, reserves its authhead again.
  async function removeUnnamedAuthhead(txid: string) {
    dismissedIdentities.value = addToIdentityList('dismissed', mainStore.network, mainStore.wallet.name, txid);
    authheadNaming.value = deleteAuthheadNaming(mainStore.network, mainStore.wallet.name, txid);
    const coin = (mainStore.walletUtxos ?? []).find(utxo => utxo.vout === 0 && utxo.txid === txid);
    if (coin && mainStore.reservedUtxos[outpointOf(coin)]?.reason === 'auth') {
      await mainStore.dropReservation(outpointOf(coin));
    }
  }

  async function removeIdentity(category: string) {
    // remembered, so the automatic detection does not put it back on the next wallet open
    dismissedIdentities.value = addToIdentityList('dismissed', mainStore.network, mainStore.wallet.name, category);
    const removed = identities.value?.find(identity => identity.category === category);
    identityCategories.value = removeFromIdentityList('categories', mainStore.network, mainStore.wallet.name, category);
    identities.value = identities.value?.filter(identity => identity.category !== category);
    if (!removed?.authUtxo) return;
    const outpoint = outpointOf(removed.authUtxo);
    if (mainStore.reservedUtxos[outpoint]?.reason === 'auth') await mainStore.dropReservation(outpoint);
  }

  return {
    identityCategories,
    watchedAuthKeys,
    dismissedIdentities,
    unseenIdentities,
    examinedKeyCandidates,
    unexaminedKeyCandidates,
    identitiesNeedAttention,
    unseenCount,
    announcement,
    authheadNaming,
    identityPublicationTxids,
    identities,
    identitiesResolving,
    publicationChecks,
    publicationChecksRunning,
    unidentifiedGuarded,
    identityHistories,
    loadForWallet,
    refreshIdentities,
    resolveListedIdentities,
    scanForIdentities,
    checkHeldCategoriesOnOpen,
    openCheckError,
    fetchMetadataFor,
    detectWalletIdentities,
    nameUnnamedAuthheads,
    unnamedAuthheadCoins,
    identitiesGuardedByKey,
    heldIdentityOf,
    inspectCategory,
    checkPublications,
    fetchIdentityHistory,
    markIdentitiesSeen,
    markKeyCandidatesExamined,
    addIdentity,
    listCreatedIdentity,
    removeIdentity,
    addAuthKey,
    removeAuthKey,
    removeUnnamedAuthhead,
  }
})
