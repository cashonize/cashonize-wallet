// Checks the locale files against each other, so a string added to one is not silently missing
// from the rest and a repeated key does not quietly replace the one above it.
//
// Usage: node scripts/checkI18n.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalJson,
  flattenEntries,
  flattenKeys,
  localesDirectory,
  placeholdersOf,
  referenceLocale,
  usesIcuSyntax,
} from './locales.ts';

const problems: string[] = [];

function readLocale(fileName: string): { text: string; data: unknown } {
  const text = readFileSync(join(localesDirectory, fileName), 'utf8');
  try {
    return { text, data: JSON.parse(text) };
  } catch (error) {
    problems.push(`${fileName} is not valid JSON: ${(error as Error).message}`);
    return { text, data: {} };
  }
}

const localeFiles = readdirSync(localesDirectory).filter(name => name.endsWith('.json')).sort();
const reference = readLocale(referenceLocale);
const referenceKeys = new Set(flattenKeys(reference.data));
const referenceEntries = new Map(flattenEntries(reference.data));

for (const fileName of localeFiles) {
  const { text, data } = fileName === referenceLocale ? reference : readLocale(fileName);

  // catches a repeated key, and keeps the files in one shape while it is there
  if (text !== canonicalJson(data)) {
    problems.push(
      `${fileName} is not in canonical form. A repeated key is the usual cause, since parsing drops`
      + ` all but the last. Reformat with JSON.stringify(value, null, 2) and a trailing newline.`,
    );
  }

  for (const [key, value] of flattenEntries(data)) {
    if (value.trim() === '') problems.push(`${fileName} has an empty value at ${key}`);
  }

  if (fileName === referenceLocale) continue;

  const keys = flattenKeys(data);
  const missing = [...referenceKeys].filter(key => !keys.includes(key));
  const extra = keys.filter(key => !referenceKeys.has(key));
  if (missing.length) problems.push(`${fileName} is missing ${missing.length}: ${missing.join(', ')}`);
  if (extra.length) problems.push(`${fileName} has ${extra.length} not in ${referenceLocale}: ${extra.join(', ')}`);

  for (const [key, value] of flattenEntries(data)) {
    const referenceValue = referenceEntries.get(key);
    if (referenceValue === undefined) continue;
    if (usesIcuSyntax(referenceValue) || usesIcuSyntax(value)) continue;
    const expected = placeholdersOf(referenceValue).join(' ');
    const actual = placeholdersOf(value).join(' ');
    if (expected !== actual) {
      problems.push(`${fileName} at ${key} has placeholders [${actual}], ${referenceLocale} has [${expected}]`);
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
  process.exit(1);
}

console.log(`i18n check passed: ${localeFiles.length} locales, ${referenceKeys.size} keys each.`);
