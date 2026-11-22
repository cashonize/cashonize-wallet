import { ref } from "vue";

// How amounts are shown: grouping and decimal mark follow the region rather than the language, so this
// is a setting of its own. 'auto' takes the browser's locale, which the desktop app always reports as
// en-US since it ships only that locale. Each format is stored as the locale that produces it.
// Display only: typed amounts, BIP21 and every machine format keep a dot.
export const numberFormats = ["auto", "en-US", "de-DE", "fr-FR", "de-CH"] as const;
export type NumberFormat = typeof numberFormats[number];

export function isNumberFormat(value: string): value is NumberFormat {
  return (numberFormats as readonly string[]).includes(value);
}

// The setting itself, which settingsStore reads from localStorage and exposes. It lives here so the
// format helpers read it without being handed it at each of their many call sites, and reading it at
// render time makes every amount follow a change.
export const numberFormat = ref<NumberFormat>("auto");

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(format: NumberFormat, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${format}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    const locale = format === "auto" ? undefined : format;
    // Latin digits always, so a locale with its own digits shows amounts the rest of the app can read
    cached = new Intl.NumberFormat(locale, { numberingSystem: "latn", ...options });
    formatters.set(key, cached);
  }
  return cached;
}

// A number for display, grouped and with the decimal mark of the user's number format
export function formatDecimal(value: number | bigint, options: Intl.NumberFormatOptions = {}, format = numberFormat.value): string {
  return formatter(format, options).format(value);
}

// Always the given number of decimals, as toFixed would, in the user's number format
export function formatFixed(value: number, digits: number): string {
  return formatDecimal(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// The decimal mark of the user's number format, for amounts put together from digit strings
export function decimalMark(format = numberFormat.value): string {
  const part = formatter(format, {}).formatToParts(1.5).find(part => part.type === "decimal");
  return part?.value ?? ".";
}
