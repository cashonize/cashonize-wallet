import { Notify } from "quasar";
import { i18n } from 'src/boot/i18n'
const { t } = i18n.global

export function caughtErrorToString(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return t('common.errors.somethingWentWrong');
}

export function displayAndLogError(error: unknown): void {
  const errorMessage = caughtErrorToString(error);
  console.error(errorMessage)
  Notify.create({
    message: errorMessage,
    icon: 'warning',
    color: "red"
  })
}

// Detect IndexedDB quota exceeded errors (browser storage full).
// mainnet-js's IndexedDBProvider rejects promises with the raw DOMException,
// so we receive the actual error object in our catch blocks.
export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return true;
    if (error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true; // Firefox
  }
  return false;
}
