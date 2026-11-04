// Spending must go through store.spend, which narrows the library's coin selection to the
// spendable pool so a reserved coin can never be picked up as an incidental input. Calling the
// wallet's spending methods directly bypasses that, and the result does not fail: the transaction
// is built and broadcast, having quietly spent a coin something was holding. This guards against
// forgetting, not against evasion: it matches store.wallet.send(), the shape the codebase actually
// writes, and not a destructured wallet ref.
const spendMethods = ['send', 'sendMax', 'tokenGenesis', 'tokenMint', 'tokenBurn', 'getMaxAmountToSend'];

const noDirectWalletSpend = {
  meta: { type: 'problem' },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        if (!spendMethods.includes(callee.property.name)) return;
        const object = callee.object;
        if (object.type !== 'MemberExpression' || object.property.type !== 'Identifier') return;
        if (object.property.name !== 'wallet') return;
        const method = callee.property.name;
        context.report({
          node,
          message: `Use store.spend.${method}() instead of store.wallet.${method}(), so coin selection stays narrowed to the spendable pool and cannot pick up a reserved coin.`,
        });
      },
    };
  },
};

export default {
  meta: { name: 'cashonize' },
  rules: { 'no-direct-wallet-spend': noDirectWalletSpend },
};
