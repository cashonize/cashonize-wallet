// The frame every operation on the identities page runs in, shared by the page and its cards.
// One form open at a time across the whole list, and one operation in flight across the page:
// these are deliberate, one-at-a-time operations, and a card with four open forms says otherwise.

import type { Ref } from 'vue'
import { displayAndLogError } from 'src/utils/errorHandling'
import { handleTransactionBroadcastSuccess } from 'src/utils/txHelpers'

export type CardAction = 'publish' | 'issue' | 'addToReserve' | 'transfer' | 'transferKey' | 'remove'
export interface OpenAction { category: string; action: CardAction }

export interface Outcome { txId: string | undefined; message: string; title: string }

// The broadcast reported when a spend went through, an error shown rather than thrown. Each
// handler keeps its own validation, confirmation and outputs, and returns nothing when the user
// declined. True when it went through.
export async function runIdentityAction(
  runningAction: Ref<string | undefined>,
  action: string,
  operate: () => Promise<Outcome | void>,
  closeForm?: () => void,
): Promise<boolean> {
  if (runningAction.value) return false
  runningAction.value = action
  try {
    const outcome = await operate()
    if (!outcome) return false
    closeForm?.()
    await handleTransactionBroadcastSuccess(outcome.message, outcome.txId, outcome.title)
    return true
  } catch (error) {
    displayAndLogError(error)
    return false
  } finally {
    runningAction.value = undefined
  }
}
