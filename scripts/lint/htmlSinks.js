// A wallet renders untrusted text (token metadata, dApp metadata, labels) next to its keys, so
// markup only enters the DOM through an explicit, reviewed exception. oxlint has no
// no-restricted-syntax, so the script-side sinks are matched here. A JS plugin sees only the
// <script> block of a .vue file: v-html, :innerHTML and Quasar's *-html props in templates are
// not checked by this plugin.
const assignedSinks = ['innerHTML', 'outerHTML'];
const insertingMethods = ['insertAdjacentHTML', 'createContextualFragment'];
const documentWrites = ['write', 'writeln'];

const noHtmlSink = {
  meta: { type: 'problem' },
  create(context) {
    return {
      Property(node) {
        if (node.key.type !== 'Identifier' || node.key.name !== 'html') return;
        if (node.value.type !== 'Literal' || node.value.value !== true) return;
        context.report({
          node,
          message: 'Quasar renders the message as HTML with html: true. Keep it text, with white-space: pre-line for line breaks.',
        });
      },
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== 'MemberExpression' || left.property.type !== 'Identifier') return;
        if (!assignedSinks.includes(left.property.name)) return;
        context.report({ node, message: 'Build DOM nodes or use textContent instead of assigning HTML.' });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        if (insertingMethods.includes(callee.property.name)) {
          context.report({ node, message: 'Build DOM nodes instead of inserting HTML.' });
        } else if (
          documentWrites.includes(callee.property.name)
          && callee.object.type === 'Identifier' && callee.object.name === 'document'
        ) {
          context.report({ node, message: 'Build DOM nodes instead of writing HTML into the document.' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'html-sinks' },
  rules: { 'no-html-sink': noHtmlSink },
};
