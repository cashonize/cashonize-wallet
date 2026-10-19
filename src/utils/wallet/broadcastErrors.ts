import { BroadcastRejectedError, ElectrumTimeoutError } from '@cashonize/bch-wallet-lib'
import { i18n } from 'src/boot/i18n'
import { displayAndLogError } from 'src/utils/errorHandling'
const { t } = i18n.global

// A refused broadcast is a BroadcastRejectedError carrying the node's reject reason, e.g.
// "txn-mempool-conflict"; a broadcast that timed out is an ElectrumTimeoutError, never resent
export type BroadcastErrorKind = 'conflict' | 'missing-inputs' | 'not-yet-final' | 'timeout' | 'other';

// BCHN's reject reasons
const conflictReasons = ['txn-mempool-conflict'];
const missingInputsReasons = ['Missing inputs', 'bad-txns-inputs-missingorspent'];
const notFinalReasons = ['non-final', 'bad-txns-nonfinal', 'non-BIP68-final'];

export function classifyBroadcastError(error: unknown): BroadcastErrorKind {
  if (error instanceof ElectrumTimeoutError) return 'timeout';
  if (!(error instanceof BroadcastRejectedError)) return 'other';
  const { reason } = error;
  if (conflictReasons.includes(reason)) return 'conflict';
  if (missingInputsReasons.includes(reason)) return 'missing-inputs';
  if (notFinalReasons.includes(reason)) return 'not-yet-final';
  return 'other';
}

// A dApp's transaction can only be rebuilt by the dApp, while the wallet's own sends select their
// UTXOs again on retry; for 'other' the node's own words are all there is
export function broadcastErrorMessage(kind: Exclude<BroadcastErrorKind, 'other'>, fromDapp: boolean): string {
  switch (kind) {
    case 'conflict':
      if (fromDapp) return t('common.errors.broadcast.conflictDapp');
      return t('common.errors.broadcast.conflict');
    case 'missing-inputs':
      if (fromDapp) return t('common.errors.broadcast.missingInputsDapp');
      return t('common.errors.broadcast.missingInputs');
    case 'not-yet-final': return t('common.errors.broadcast.notYetFinal');
    case 'timeout': return t('common.errors.broadcast.timeout');
  }
}

// Shows a dApp broadcast's failure in the user's terms, keeping the node's own words in the log
export function displayBroadcastError(error: unknown) {
  const kind = classifyBroadcastError(error);
  if (kind === 'other') {
    displayAndLogError(error);
    return;
  }
  console.error(error);
  displayAndLogError(broadcastErrorMessage(kind, true));
}
