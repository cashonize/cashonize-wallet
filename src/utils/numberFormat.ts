import { ref } from "vue";
import { i18n } from "src/boot/i18n";

const { t } = i18n.global;

// The region's number format, apart from the language: English unless the user picks another or 'auto',
// the browser's locale (en-US on desktop).
// Machine formats (BIP21, dApp payloads, CSV) always keep a dot.
export const numberFormats = ["en-US", "de-DE", "fr-FR", "de-CH", "auto"] as const;
export type NumberFormat = typeof numberFormats[number];

export function isNumberFormat(value: string): value is NumberFormat {
  return (numberFormats as readonly string[]).includes(value);
}

// Loaded and exposed by settingsStore; kept here so the helpers read it without being passed it
export const numberFormat = ref<NumberFormat>("en-US");

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(format: NumberFormat, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${format}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    const locale = format === "auto" ? undefined : format;
    // Latin digits, so pasting a shown amount back stays readable
    cached = new Intl.NumberFormat(locale, { numberingSystem: "latn", ...options });
    formatters.set(key, cached);
  }
  return cached;
}

// A number for display in the user's number format
export function formatDecimal(value: number | bigint, options: Intl.NumberFormatOptions = {}, format = numberFormat.value): string {
  return formatter(format, options).format(value);
}

// toFixed in the user's number format
export function formatFixed(value: number, digits: number): string {
  return formatDecimal(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function decimalMark(format = numberFormat.value): string {
  const part = formatter(format, {}).formatToParts(1.5).find(part => part.type === "decimal");
  return part?.value ?? ".";
}

const typedAmountProblems = ["invalid", "grouping", "ambiguous", "wholeOnly"] as const;
export type TypedAmountProblem = typeof typedAmountProblems[number];

export function isTypedAmountProblem(value: string): value is TypedAmountProblem {
  return (typedAmountProblems as readonly string[]).includes(value);
}

// A typed amount with a dot decimal mark: a dot or comma is accepted, grouping is not. A shape read two
// ways (1,000 or 1.500) is accepted only with the format's own decimal mark, so it is never misread.
export function readTypedAmount(
  text: string, wholeOnly = false, format = numberFormat.value,
): { amount: string } | { problem: TypedAmountProblem } {
  const amount = text.trim();
  if (/\s|['’]/.test(amount) || (amount.match(/[.,]/g) ?? []).length > 1) return { problem: "grouping" };
  if (!/^[0-9]*[.,]?[0-9]*$/.test(amount) || !/[0-9]/.test(amount)) return { problem: "invalid" };
  if (wholeOnly && /[.,]/.test(amount)) return { problem: "wholeOnly" };
  const ambiguous = amount.match(/^[1-9][0-9]{0,2}([.,])[0-9]{3}$/);
  if (ambiguous && ambiguous[1] !== typingDecimalMark(format)) return { problem: "ambiguous" };
  return { amount: amount.replace(",", ".") };
}

export function typedAmountMessage(problem: TypedAmountProblem): string {
  switch (problem) {
    case "invalid": return t("common.errors.amountInvalid");
    case "grouping": return t("common.errors.amountGrouping");
    case "ambiguous": return t("common.errors.amountAmbiguous", { example: `1${typingDecimalMark()}5` });
    case "wholeOnly": return t("common.errors.amountWholeOnly");
  }
}

// readTypedAmount for callers that report a problem by throwing it
export function parseTypedAmount(text: string, wholeOnly = false): string {
  const read = readTypedAmount(text, wholeOnly);
  if ("problem" in read) throw new Error(typedAmountMessage(read.problem));
  return read.amount;
}

// An amount the app fills into a field, in the mark the user types, so 1.500 is not refused as ambiguous
export function toTypedAmount(dotAmount: string, format = numberFormat.value): string {
  return dotAmount.replace(".", typingDecimalMark(format));
}

// a format whose decimal mark is neither (Arabic) is typed with a dot
function typingDecimalMark(format = numberFormat.value): "." | "," {
  return decimalMark(format) === "," ? "," : ".";
}
