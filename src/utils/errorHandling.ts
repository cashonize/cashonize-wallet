import { Notify } from "quasar";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function caughtErrorToString(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return t('common.errors.somethingWentWrong');
}

// An error the user can act on from its notification, e.g. a broadcast whose outcome is unknown,
// which broadcasting the same transaction again settles
export class ActionableError extends Error {
  readonly action: { label: string; run: () => Promise<void> };

  constructor(message: string, { cause, action }: { cause?: unknown; action: ActionableError['action'] }) {
    super(message, { cause });
    this.name = 'ActionableError';
    this.action = action;
  }
}

export function displayAndLogError(error: unknown): void {
  const errorMessage = caughtErrorToString(error);
  console.error(errorMessage)
  if (error instanceof ActionableError) {
    const { label, run } = error.action;
    Notify.create({
      message: errorMessage,
      icon: 'warning',
      color: "red",
      // stays until acted on or dismissed, so the action does not time out with it
      timeout: 0,
      actions: [
        { label, color: 'white', handler: () => { run().catch(displayAndLogError) } },
        { label: t('common.actions.dismiss'), color: 'white' },
      ],
    })
    return;
  }
  Notify.create({
    message: errorMessage,
    icon: 'warning',
    color: "red"
  })
}

// Detect IndexedDB quota exceeded errors (browser storage full).
// The library's IndexedDBProvider rejects promises with the raw DOMException,
// so we receive the actual error object in our catch blocks.
export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return true;
    if (error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true; // Firefox
  }
  return false;
}
