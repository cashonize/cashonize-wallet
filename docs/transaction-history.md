# Transaction history

How the wallet reads its own transactions: the history view, which shows them, and the
transaction index, which finds the few that identity detection and the portfolio need. Both
start from the same electrum data, the txids and heights of every address the wallet holds,
and differ in how much of each transaction they decode. Read this before changing what loads
at open, what a refresh loads, or what the index keeps.

## The history view

**A history item is expensive.** bch-wallet-lib's `getHistory` builds each item from the
transaction and every transaction its inputs spend (the prevouts), decoded with libauth, for
what the view shows: the value to the wallet, the fee and the token changes. A full load
fetches all of them once and reads them back from the library's IndexedDB cache after, but
decodes every one again on every load, on the main thread.

**So it loads only when the user needs it.** An open loads the newest 100. The full history
loads once per wallet session, when the history view shows (it stays alive, so a watch on the
view and on the history shown asks, not mounting) or the token picker opens, behind the page
already shown; the count reads "100+" and "Loading full history" shows until it is in. A CSV
export loads it first and refuses to write a partial one.

**A send or receive refreshes only the newest page**, its one or two refreshes sharing one
load. Once the full history is loaded the page is merged into it: the page replaces the items
it holds, so their confirmations update, puts new ones in front, and an item the wallet's
history no longer has, a replaced unconfirmed transaction, is dropped. The older items stay
as loaded, each one's balance being the balance after it. What a page cannot bring, an HD
wallet finding an old address mid-session, shows at the next open.

**What it cost, measured on a mainnet address of 1,541 transactions** (Node, without the
cache, October 2026):

| | bch-wallet-lib 0.1.3 | 0.1.4 |
|---|---|---|
| Full load | ~37 s, 2,592 transactions and 783 headers fetched | the same requests |
| Heap the result keeps | about 1.2 KB per output | about 190 B per output |
| Longest main-thread block | ~350 ms | not measured |

0.1.4 builds the hex strings of an item flat, where libauth's `binToHex` leaves V8 a chain of
two-character pieces for as long as the string lives, and decodes a history transaction that is
another one's parent once rather than twice. The requests and the decoding per load are
unchanged; what the view still needs from the library is paging, below.

## The transaction index

Identity detection, at every open, and the portfolio's TapSwap and hodl lookup, on a visit,
read the wallet's history for markers and announcements (`contract-asset-discovery.md`,
`bcmr-identities.md`). They need outputs and input outpoints only, never a prevout, so they read
`src/utils/history/transactionIndex.ts` instead of the history view's items.

**What it keeps**, per wallet per network in localStorage: the identity markers and the
authchain links the wallet's transactions took their chains on to, and the TapSwap and hodl
announcements, each trimmed to what the detectors read (inputs 0 and 1, and the others spending
an output 0; outputs 0 and 1, the OP_RETURNs, and the first output of each token category). An
AuthGuard spend keeps the token of its input 1, the AuthKey it opened the guard with, read off
the transaction that created that input. Not kept: the other transactions, values, fees,
addresses, which are derived from the locking bytecode when needed. For the address above it
is about 70 KB; for an ordinary wallet a few.

**When it scans.** Each update decodes the transactions above the last scanned height, every
unconfirmed one, and the last 10 blocks again. A transaction that left the history leaves the
index. Below that window it compares the number of confirmed transactions with the number it
recorded; another number means old transactions came or went, a deeper reorg or an HD wallet
finding an address used long ago, and everything is scanned again. A stored index of another
format version is scanned again too, which is how a change to what is kept repairs indexes
already written. This covers reorgs that drop, replace or move transactions within the window,
and any that change the count below it; a deeper reorg that replaces one confirmed transaction
by another at the same count is not caught until the next full scan.

**A cold start.** The first open on a device, after a restore or a cleared cache, scans the
whole history once. It fetches every raw transaction through one sliding window of 32 requests,
the bound a history load uses, and decodes them in slices of 50 with a yield to the event loop
between, so a tap never waits long behind it. The chain is followed from those same
transactions; a first scan fetches only an input 1 funded from outside the history, and later
scans read the funding transactions back from the cache. At open it starts
after the balance, the token list and the first history page are shown; a portfolio visit before
then starts it sooner. Measured on the address above (Node, without the cache, October 2026):
18 s, 1,541 transactions fetched, longest block 50 ms, about 26 MB of heap while it ran; the next
open under 500 ms, 1 transaction fetched.

**A failed write**, a full localStorage say, keeps the computed result for that open and is
logged; the next open scans again. An index over 512 KB, a wallet that minted thousands from its
authhead, is not kept at all, so it scans at every open rather than crowd out reservations.
Clearing the history cache in the settings clears the indexes too.

## How other wallets do it

Electron Cash, Selene and Paytaca: none decodes the whole history again on a wallet event.

## What could come next

- **An indexer instead of the scan**, once one can return the wallet's announcements without
  walking its history, keeps up with electrum and stays up; Chaingraph does none of that today
  (`contract-asset-discovery.md`).
- **Electron Cash's own-output map in bch-wallet-lib**, the long-term direction: it would make the
  full history cheap and could serve the detectors instead of this index.
- **Paging in the library**: `getHistory` takes a count but no start.
- **No worker**: nothing decodes at length on its own.
