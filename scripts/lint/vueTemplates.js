// Lints the <template> of every .vue file, which oxlint never sees: its JS plugins get only the
// <script> block. Replaces eslint-plugin-vue's no-v-html, no-restricted-v-bind and
// no-restricted-static-attribute (markup from token or dApp metadata reaching the page), plus
// no-use-v-if-with-v-for and require-v-for-key. An HTML comment containing "lint-allow-html" on
// the finding's line or the line above makes an HTML sink a reviewed exception.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'vue/compiler-sfc';

// @vue/compiler-core's NodeTypes, a const enum that vue does not export at runtime
const NodeTypes = { ELEMENT: 1, COMMENT: 3, SIMPLE_EXPRESSION: 4, ATTRIBUTE: 6 };

// innerHTML/outerHTML, and the QSelect and QChatMessage props that render their value as HTML,
// compared without dashes and case so every spelling and the .camel modifier match
const htmlProps = ['innerhtml', 'outerhtml', 'optionshtml', 'displayvaluehtml', 'labelhtml', 'namehtml', 'texthtml', 'stamphtml'];
const normalize = (name) => name.replace(/-/g, '').toLowerCase();

function* vueFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* vueFiles(full);
    else if (entry.name.endsWith('.vue')) yield full;
  }
}

function lintFile(file) {
  const findings = [];
  const { descriptor, errors } = parse(fs.readFileSync(file, 'utf8'), { filename: file });
  for (const error of errors) {
    findings.push({ line: error.loc?.start.line ?? 1, column: error.loc?.start.column ?? 1, message: error.message });
  }
  const ast = descriptor.template?.ast;
  if (!ast) return findings;

  const allowedLines = new Set();
  const htmlSinks = [];
  const report = (loc, message) => findings.push({ line: loc.start.line, column: loc.start.column, message });
  const reportSink = (loc, message) => htmlSinks.push({ line: loc.start.line, column: loc.start.column, message });

  const visit = (node) => {
    if (node.type === NodeTypes.COMMENT && node.content.includes('lint-allow-html')) {
      allowedLines.add(node.loc.start.line);
      allowedLines.add(node.loc.start.line + 1);
    }
    if (node.type !== NodeTypes.ELEMENT) {
      node.children?.forEach(visit);
      return;
    }
    let hasFor = false;
    let hasIf = false;
    let hasKey = false;
    for (const prop of node.props) {
      if (prop.type === NodeTypes.ATTRIBUTE) {
        if (prop.name === 'key') hasKey = true;
        if (htmlProps.includes(normalize(prop.name))) reportSink(prop.loc, `${prop.name} renders its value as HTML.`);
        continue;
      }
      if (prop.name === 'html') reportSink(prop.loc, 'v-html renders its value as HTML.');
      if (prop.name === 'for') hasFor = true;
      if (prop.name === 'if') hasIf = true;
      if (prop.name !== 'bind') continue;
      if (!prop.arg) {
        // v-bind="{ innerHTML: x }" binds the object's keys as props
        const source = normalize(prop.exp?.loc.source ?? '');
        if (htmlProps.some((htmlProp) => source.includes(htmlProp))) reportSink(prop.loc, 'This v-bind object binds a prop that renders HTML.');
        continue;
      }
      if (prop.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !prop.arg.isStatic) {
        reportSink(prop.loc, 'A dynamic v-bind argument can name a prop that renders HTML.');
        continue;
      }
      if (prop.arg.content === 'key') hasKey = true;
      if (htmlProps.includes(normalize(prop.arg.content))) reportSink(prop.loc, `${prop.arg.content} renders its value as HTML.`);
    }
    if (hasFor && hasIf) report(node.loc, 'v-if and v-for on the same element: v-if runs first, without the loop variable.');
    if (hasFor && !hasKey) report(node.loc, `<${node.tag} v-for> needs a :key.`);
    node.children.forEach(visit);
  };
  ast.children.forEach(visit);

  const unreviewedSinks = htmlSinks.filter((sink) => !allowedLines.has(sink.line));
  return [...findings, ...unreviewedSinks];
}

let count = 0;
for (const file of vueFiles('src')) {
  for (const finding of lintFile(file)) {
    count++;
    console.log(`${file}:${finding.line}:${finding.column} ${finding.message}`);
  }
}
if (count > 0) {
  console.log(`\n${count} problem${count === 1 ? '' : 's'} in .vue templates`);
  process.exitCode = 1;
}
