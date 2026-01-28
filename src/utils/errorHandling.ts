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

// Types for the result object with discriminated union
type Success<T> = {
  data: T;
  error: null;
};

type Failure<E> = {
  data: null;
  error: E;
};

type Result<T, E = Error> = Success<T> | Failure<E>;

// Main wrapper function
export async function tryCatch<T, E = Error>(
  promise: Promise<T>,
): Promise<Result<T, E>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as E };
  }
}
