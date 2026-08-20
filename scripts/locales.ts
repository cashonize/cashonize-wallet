// Shared reading of the locale files, used by the i18n check and by the pull request stats.
// Neither imports from src, so both run under plain node without a build step.

export const localesDirectory = 'src/i18n/locales';
// where new interface text is written; every other locale repeats its keys
export const referenceLocale = 'en.json';

export function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    flattenKeys(nested, prefix === '' ? key : `${prefix}.${key}`),
  );
}

export function flattenEntries(value: unknown, prefix = ''): [string, string][] {
  if (typeof value !== 'object' || value === null) return [[prefix, String(value)]];
  return Object.entries(value).flatMap(([key, nested]) =>
    flattenEntries(nested, prefix === '' ? key : `${prefix}.${key}`),
  );
}

// JSON.parse keeps the last of a repeated key and says nothing, so a duplicate is invisible to
// anything working from the parsed object. Writing the parsed object back out and comparing
// catches it, because the repeat is gone by then. The locale files are written in exactly this
// form, so the same comparison keeps their formatting from drifting.
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// A placeholder is part of the contract with the code that renders the string: en.json says
// which ones exist, and a translation that drops or renames one shows it as literal text.
//
// ICU messages like {count, plural, one {Token} other {Tokens}} put message text inside braces
// too, and telling that apart from a placeholder needs a real parser. Those are left uncompared
// rather than compared wrongly, since a translation is free to word its branches differently.
export function usesIcuSyntax(text: string): boolean {
  return /\{[a-zA-Z0-9_]+,\s*(plural|select|selectordinal)\s*,/.test(text);
}

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map(match => match[0]).sort();
}
