// Categorises a pull request's changed lines so reviewers can see how much of it is
// actual code, as opposed to markup, styling, tests, translations or generated files.
//
// Usage: node scripts/prStats.ts <base-revision>

import { execFileSync } from 'node:child_process';

function requireBaseRevision(): string {
  const revision = process.argv[2];
  if (!revision) {
    console.error('Usage: node scripts/prStats.ts <base-revision>');
    process.exit(1);
  }
  return revision;
}

const baseRevision = requireBaseRevision();

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Returns an empty string when the file does not exist at that revision, which is the
// case on either side of an addition or a deletion. Git reports that on stderr, which
// is silenced here so it does not read as a failure in the workflow log.
function fileAt(revision: string, filePath: string): string {
  try {
    return execFileSync('git', ['show', `${revision}:${filePath}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

type Category =
  | 'code'
  | 'markup'
  | 'styling'
  | 'tests'
  | 'copy'
  | 'translations'
  | 'docs'
  | 'dependencies'
  | 'generated';

// Order matters: the first matching rule wins.
const categoryRules: { category: Category; matches: (filePath: string) => boolean }[] = [
  { category: 'tests', matches: (filePath) => filePath.startsWith('test/') },
  // en.json is where new interface strings are written; the other locales repeat them.
  { category: 'copy', matches: (filePath) => filePath === 'src/i18n/locales/en.json' },
  { category: 'translations', matches: (filePath) => filePath.startsWith('src/i18n/locales/') },
  { category: 'docs', matches: (filePath) => filePath.endsWith('.md') || filePath.startsWith('docs/') },
  {
    category: 'dependencies',
    matches: (filePath) =>
      filePath.endsWith('package.json') ||
      filePath.endsWith('pnpm-workspace.yaml') ||
      filePath.startsWith('patches/'),
  },
  {
    category: 'generated',
    matches: (filePath) => filePath.endsWith('pnpm-lock.yaml') || filePath.startsWith('src-capacitor/android/'),
  },
  { category: 'styling', matches: (filePath) => filePath.endsWith('.css') || filePath.endsWith('.scss') },
];

function categorise(filePath: string): Category {
  return categoryRules.find((rule) => rule.matches(filePath))?.category ?? 'code';
}

interface FileChange {
  filePath: string;
  added: number;
  removed: number;
}

// Parses the output of `git diff --numstat`, one "<added>\t<removed>\t<path>" line per
// file. Binary files report "-" for both counts and are left out.
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

interface DiffLine {
  side: 'added' | 'removed';
  /** Line number in the new revision for an added line, the old one for a removed line. */
  lineNumber: number;
  content: string;
}

// Asking for no context lines makes every line of a hunk either added or removed, so
// walking the hunk from the line numbers in its header numbers every line it holds.
function diffLinesOf(filePath: string): DiffLine[] {
  const diff = git(['diff', '-U0', '--no-renames', baseRevision, 'HEAD', '--', filePath]);
  const diffLines: DiffLine[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLineNumber = Number(header[1]);
      newLineNumber = Number(header[2]);
      continue;
    }
    // The "+++ b/path" and "--- a/path" headers carry the same prefixes as the lines.
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      diffLines.push({ side: 'added', lineNumber: newLineNumber, content: line.slice(1) });
      newLineNumber++;
    } else if (line.startsWith('-')) {
      diffLines.push({ side: 'removed', lineNumber: oldLineNumber, content: line.slice(1) });
      oldLineNumber++;
    }
  }

  return diffLines;
}

type SfcBlock = 'script' | 'template' | 'style';

// A single file component's blocks open and close at the start of a line, while the
// <template> tags Vue allows inside a template are always indented, so the opening
// column is enough to tell the two apart.
function sfcBlockReader(content: string): (lineNumber: number) => SfcBlock | undefined {
  const blocks: { block: SfcBlock; from: number; to: number }[] = [];
  let openBlock: { block: SfcBlock; from: number } | undefined;

  content.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    const opening = /^<(script|template|style)[ >]/.exec(line);
    if (opening && !openBlock) {
      openBlock = { block: opening[1] as SfcBlock, from: lineNumber };
      return;
    }
    const closing = /^<\/(script|template|style)>/.exec(line);
    if (closing && openBlock) {
      blocks.push({ ...openBlock, to: lineNumber });
      openBlock = undefined;
    }
  });

  return (lineNumber) => blocks.find((block) => lineNumber >= block.from && lineNumber <= block.to)?.block;
}

// A component's script block is code, its template is markup and its style block is
// styling. Lines between blocks are blank separators and go with the markup.
const blockCategories: Record<SfcBlock, Category> = {
  script: 'code',
  template: 'markup',
  style: 'styling',
};

interface Contribution {
  category: Category;
  added: number;
  removed: number;
}

interface FileAnalysis {
  contributions: Contribution[];
  /** Contents of the added lines that count as code, for the comment share. */
  addedCodeLines: string[];
}

// Only code is read line by line: every other category is counted whole, which keeps
// the diff of a lockfile or a locale file out of this entirely.
function analyse(change: FileChange): FileAnalysis {
  const category = categorise(change.filePath);
  if (category !== 'code') {
    return { contributions: [{ category, added: change.added, removed: change.removed }], addedCodeLines: [] };
  }

  const isComponent = change.filePath.endsWith('.vue');
  // Removed lines are read against the old revision, since the blocks may have moved.
  const blockBefore = isComponent ? sfcBlockReader(fileAt(baseRevision, change.filePath)) : undefined;
  const blockAfter = isComponent ? sfcBlockReader(fileAt('HEAD', change.filePath)) : undefined;

  const contributions: Contribution[] = [];
  const addedCodeLines: string[] = [];

  for (const line of diffLinesOf(change.filePath)) {
    const blockReader = line.side === 'added' ? blockAfter : blockBefore;
    const block = blockReader?.(line.lineNumber);
    const lineCategory = isComponent ? (block === undefined ? 'markup' : blockCategories[block]) : 'code';

    contributions.push({
      category: lineCategory,
      added: line.side === 'added' ? 1 : 0,
      removed: line.side === 'removed' ? 1 : 0,
    });
    if (lineCategory === 'code' && line.side === 'added') addedCodeLines.push(line.content);
  }

  return { contributions, addedCodeLines };
}

const displayOrder: Category[] = [
  'code',
  'markup',
  'styling',
  'tests',
  'copy',
  'translations',
  'docs',
  'dependencies',
  'generated',
];

// Generated files are excluded from the shares: a lockfile update would otherwise
// dwarf every other category and make the percentages meaningless.
const excludedFromShare: Category[] = ['generated'];

const categoryLabels: Record<Category, string> = {
  code: 'Code',
  markup: 'Markup',
  styling: 'Styling',
  tests: 'Tests',
  copy: 'Interface text (en)',
  translations: 'Translations',
  docs: 'Documentation',
  dependencies: 'Dependencies',
  generated: 'Generated',
};

interface CategoryTotal {
  category: Category;
  added: number;
  removed: number;
  /** Share of the reviewable churn, or undefined for categories left out of that total. */
  share?: number | undefined;
}

const changes = parseNumstat(git(['diff', '--numstat', '--no-renames', baseRevision, 'HEAD']));
const analyses = changes.map(analyse);
const contributions = analyses.flatMap((analysis) => analysis.contributions);

const totals: CategoryTotal[] = displayOrder.map((category) => {
  const inCategory = contributions.filter((contribution) => contribution.category === category);
  return {
    category,
    added: inCategory.reduce((sum, contribution) => sum + contribution.added, 0),
    removed: inCategory.reduce((sum, contribution) => sum + contribution.removed, 0),
  };
});

const churnOf = (category: Category) => {
  const total = totals.find((entry) => entry.category === category);
  return total ? total.added + total.removed : 0;
};
const reviewableChurn = totals
  .filter((total) => !excludedFromShare.includes(total.category))
  .reduce((sum, total) => sum + total.added + total.removed, 0);

for (const total of totals) {
  if (excludedFromShare.includes(total.category) || reviewableChurn === 0) continue;
  total.share = (total.added + total.removed) / reviewableChurn;
}

// Lines carrying nothing but a comment: the line form, and the opening, body and
// closing of the block form, which this codebase writes with a leading asterisk.
function isComment(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

const addedCodeLines = analyses.flatMap((analysis) => analysis.addedCodeLines);
const addedComments = addedCodeLines.filter(isComment);
// Blank lines are left out of both sides, so the share is comment against statement.
const addedStatements = addedCodeLines.filter((line) => line.trim() !== '' && !isComment(line));

// Files added by this pull request, which say how much of it is new surface rather
// than edits to code that already had reviewers.
const newFiles = git(['diff', '--name-status', '--no-renames', baseRevision, 'HEAD'])
  .split('\n')
  .filter((line) => line.startsWith('A\t'))
  .map((line) => line.slice(2))
  .filter((filePath) => categorise(filePath) !== 'generated');

function declaredDependencies(content: string): Record<string, string> {
  if (content === '') return {};
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...parsed.dependencies, ...parsed.devDependencies };
  } catch {
    return {};
  }
}

// Which packages the pull request brings in or drops, as opposed to how many lines of
// package.json moved. A new dependency is the part that warrants a look of its own.
const addedDependencies: string[] = [];
const removedDependencies: string[] = [];
for (const change of changes.filter((change) => change.filePath.endsWith('package.json'))) {
  const before = declaredDependencies(fileAt(baseRevision, change.filePath));
  const after = declaredDependencies(fileAt('HEAD', change.filePath));
  for (const [name, version] of Object.entries(after)) {
    if (!(name in before)) addedDependencies.push(`\`${name}@${version}\``);
  }
  for (const name of Object.keys(before)) {
    if (!(name in after)) removedDependencies.push(`\`${name}\``);
  }
}

const localesDirectory = 'src/i18n/locales';
const referenceLocale = 'en.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    flattenKeys(nested, prefix === '' ? key : `${prefix}.${key}`),
  );
}

function localeKeys(fileName: string): string[] {
  const content = fileAt('HEAD', `${localesDirectory}/${fileName}`);
  if (content === '') return [];
  try {
    return flattenKeys(JSON.parse(content));
  } catch {
    return [];
  }
}

function listSome(keys: string[]): string {
  const shown = keys.slice(0, 5).map((key) => `\`${key}\``);
  return keys.length > shown.length ? `${shown.join(', ')} and ${keys.length - shown.length} more` : shown.join(', ');
}

// Every locale has to carry the same keys as the english one, so a string added to the
// interface without its translations is worth saying out loud.
const referenceKeys = localeKeys(referenceLocale);
const otherLocales = git(['ls-tree', '--name-only', 'HEAD', `${localesDirectory}/`])
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.endsWith('.json'))
  .map((filePath) => filePath.slice(localesDirectory.length + 1))
  .filter((fileName) => fileName !== referenceLocale);

const translationProblems: string[] = [];
for (const locale of otherLocales) {
  const keys = localeKeys(locale);
  const missing = referenceKeys.filter((key) => !keys.includes(key));
  const unused = keys.filter((key) => !referenceKeys.includes(key));
  if (missing.length > 0) {
    translationProblems.push(`\`${locale}\` is missing ${missing.length}: ${listSome(missing)}`);
  }
  if (unused.length > 0) {
    translationProblems.push(`\`${locale}\` has ${unused.length} no longer in english: ${listSome(unused)}`);
  }
}

// Rewording an existing string keeps the keys in step while leaving four translations
// saying the old thing, which only the set of files touched can reveal.
const changedPaths = changes.map((change) => change.filePath);
const untouchedLocales = changedPaths.includes(`${localesDirectory}/${referenceLocale}`)
  ? otherLocales.filter((locale) => !changedPaths.includes(`${localesDirectory}/${locale}`))
  : [];

const changed = totals.filter((total) => total.added + total.removed > 0);
if (changed.length === 0) {
  console.log('No line changes in this pull request.');
  process.exit(0);
}

const lines = [
  '| | Added | Removed | Share |',
  '|---|---:|---:|---:|',
  ...changed.map((total) => {
    const share = total.share === undefined ? '—' : `${Math.round(total.share * 100)}%`;
    return `| ${categoryLabels[total.category]} | +${total.added} | −${total.removed} | ${share} |`;
  }),
  '',
  `Reviewable churn: ${reviewableChurn} lines, generated files excluded.`,
];

const codeChurn = churnOf('code');
if (codeChurn > 0) {
  lines.push(`Test lines per line of code: ${(churnOf('tests') / codeChurn).toFixed(2)}.`);
}

const commentable = addedComments.length + addedStatements.length;
if (commentable > 0) {
  const share = Math.round((addedComments.length / commentable) * 100);
  lines.push(`Comments: ${addedComments.length} of ${commentable} added code lines, ${share}%.`);
}

if (addedDependencies.length > 0) lines.push(`Dependencies added: ${addedDependencies.join(', ')}.`);
if (removedDependencies.length > 0) lines.push(`Dependencies removed: ${removedDependencies.join(', ')}.`);

const listedNewFiles = 10;
if (newFiles.length > 0) {
  lines.push('', `New files: ${newFiles.length}`);
  lines.push(...newFiles.slice(0, listedNewFiles).map((filePath) => `- \`${filePath}\``));
  if (newFiles.length > listedNewFiles) lines.push(`- and ${newFiles.length - listedNewFiles} more`);
}

if (translationProblems.length > 0) {
  lines.push('', 'Translation keys out of step with english:');
  lines.push(...translationProblems.map((problem) => `- ${problem}`));
}

if (untouchedLocales.length > 0) {
  const names = untouchedLocales.map((locale) => `\`${locale}\``).join(', ');
  lines.push('', `Interface text changed in \`${referenceLocale}\` while ${names} stayed the same.`);
}

const touchedInterfaceText = changes.some((change) => {
  const category = categorise(change.filePath);
  return category === 'copy' || category === 'translations';
});
if (touchedInterfaceText && translationProblems.length === 0 && untouchedLocales.length === 0) {
  lines.push('', 'All locales carry the same keys.');
}

console.log(lines.join('\n'));
