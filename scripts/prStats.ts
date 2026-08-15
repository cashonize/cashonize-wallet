// Categorises a pull request's changed lines so reviewers can see how much of it
// is actual code, as opposed to tests, translations or generated files.
//
// Usage: node scripts/prStats.ts <base-revision>

import { execFileSync } from 'node:child_process';

type Category = 'code' | 'tests' | 'copy' | 'translations' | 'docs' | 'generated';

// Order matters: the first matching rule wins.
const categoryRules: { category: Category; matches: (filePath: string) => boolean }[] = [
  { category: 'tests', matches: (filePath) => filePath.startsWith('test/') },
  // en.json is where new interface strings are written; the other locales repeat them.
  { category: 'copy', matches: (filePath) => filePath === 'src/i18n/locales/en.json' },
  { category: 'translations', matches: (filePath) => filePath.startsWith('src/i18n/locales/') },
  { category: 'docs', matches: (filePath) => filePath.endsWith('.md') || filePath.startsWith('docs/') },
  {
    category: 'generated',
    matches: (filePath) => filePath.endsWith('pnpm-lock.yaml') || filePath.startsWith('src-capacitor/android/'),
  },
];

function categorise(filePath: string): Category {
  return categoryRules.find((rule) => rule.matches(filePath))?.category ?? 'code';
}

interface FileChange {
  filePath: string;
  added: number;
  removed: number;
}

// Parses the output of `git diff --numstat`, one "<added>\t<removed>\t<path>" line
// per file. Binary files report "-" for both counts and are left out.
function parseNumstat(numstat: string): FileChange[] {
  return numstat
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [added, removed, filePath] = line.split('\t');
      return { filePath: filePath ?? '', added: Number(added), removed: Number(removed) };
    })
    .filter((change) => Number.isInteger(change.added) && Number.isInteger(change.removed));
}

interface CategoryTotal {
  category: Category;
  added: number;
  removed: number;
  /** Share of the reviewable churn, or undefined for categories left out of that total. */
  share?: number | undefined;
}

interface Summary {
  totals: CategoryTotal[];
  /** Added plus removed lines over all categories except generated files. */
  reviewableChurn: number;
  /** Test lines changed per line of code changed, or undefined when no code changed. */
  testRatio?: number | undefined;
}

const displayOrder: Category[] = ['code', 'tests', 'copy', 'translations', 'docs', 'generated'];

// Generated files are excluded from the shares: a lockfile update would otherwise
// dwarf every other category and make the percentages meaningless.
const excludedFromShare: Category[] = ['generated'];

function summarise(changes: FileChange[]): Summary {
  const totals = displayOrder.map((category) => {
    const inCategory = changes.filter((change) => categorise(change.filePath) === category);
    return {
      category,
      added: inCategory.reduce((sum, change) => sum + change.added, 0),
      removed: inCategory.reduce((sum, change) => sum + change.removed, 0),
    };
  });

  const churnOf = (category: Category) => {
    const total = totals.find((entry) => entry.category === category);
    return total ? total.added + total.removed : 0;
  };
  const reviewableChurn = totals
    .filter((total) => !excludedFromShare.includes(total.category))
    .reduce((sum, total) => sum + total.added + total.removed, 0);

  const withShares = totals.map((total) => {
    if (excludedFromShare.includes(total.category) || reviewableChurn === 0) return total;
    return { ...total, share: (total.added + total.removed) / reviewableChurn };
  });

  const codeChurn = churnOf('code');
  const testRatio = codeChurn === 0 ? undefined : churnOf('tests') / codeChurn;

  return { totals: withShares, reviewableChurn, testRatio };
}

const categoryLabels: Record<Category, string> = {
  code: 'Code',
  tests: 'Tests',
  copy: 'Interface text (en)',
  translations: 'Translations',
  docs: 'Documentation',
  generated: 'Generated',
};

function formatMarkdown(summary: Summary): string {
  const changed = summary.totals.filter((total) => total.added + total.removed > 0);
  if (changed.length === 0) return 'No line changes in this pull request.';

  const rows = changed.map((total) => {
    const share = total.share === undefined ? '—' : `${Math.round(total.share * 100)}%`;
    return `| ${categoryLabels[total.category]} | +${total.added} | −${total.removed} | ${share} |`;
  });

  const lines = [
    '| | Added | Removed | Share |',
    '|---|---:|---:|---:|',
    ...rows,
    '',
    `Reviewable churn: ${summary.reviewableChurn} lines, generated files excluded.`,
  ];
  if (summary.testRatio !== undefined) {
    lines.push(`Test lines per line of code: ${summary.testRatio.toFixed(2)}.`);
  }
  return lines.join('\n');
}

const baseRevision = process.argv[2];
if (!baseRevision) {
  console.error('Usage: node scripts/prStats.ts <base-revision>');
  process.exit(1);
}

// --no-renames keeps every line a plain path, so a rename cannot be miscategorised
// by the "{old => new}" notation git otherwise uses.
const numstat = execFileSync('git', ['diff', '--numstat', '--no-renames', baseRevision, 'HEAD'], {
  encoding: 'utf8',
});

console.log(formatMarkdown(summarise(parseNumstat(numstat))));
