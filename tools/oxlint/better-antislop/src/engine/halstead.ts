import type { ESTree } from '@oxlint/plugins';

import type { HalsteadMetrics } from './types.ts';

/**
 * Halstead accounting.
 *
 * Operator tokens and control keywords are operators; identifiers, literals,
 * `this`, `super` and template fragments are operands. Both occurrences and
 * distinct values are counted, and distinctness is by token text.
 *
 * The accounting is node-level. An ESTree node folds each token it wrote into a
 * field rather than exposing the token itself, so `recordTokens` recovers the
 * tokens from the node that carries them. Reading the tree by node is the only
 * shape the parser supports, and it is also the shape the walk needs: a node is
 * visited once, so a construct whose tokens depend on what it says — an
 * optional call, a delegating `yield` — is resolved by a function instead of a
 * lookup in a flat token list.
 */

/** Operator and operand occurrences for one function, in source order. */
export interface HalsteadTally {
  /** One entry per operator occurrence; repeats are kept. */
  readonly operators: string[];
  /** One entry per operand occurrence; repeats are kept. */
  readonly operands: string[];
}

/**
 * The tokens one node writes, and the tally they are counted in.
 *
 * A node may write more than one token: `a ? b : c` writes `?` and `:`.
 */
interface TokenGroup {
  /** The tally these tokens are pushed onto. */
  readonly tally: keyof HalsteadTally;
  /** The tokens the node writes, in source order. */
  readonly tokens: readonly string[];
}

/**
 * How a construct recovers the tokens it wrote, or `null` when it wrote none.
 *
 * A reader names the one field of its own construct that decides the answer,
 * and returns the tokens the node wrote. `null` is a real answer: `?` is not
 * written by every optional call, and `*` by every function.
 */
type TokenReader = (node: ESTree.Node) => TokenGroup | null;

/** The operator tokens a node writes, in source order. */
function operator(...tokens: string[]): TokenGroup {
  return { tally: 'operators', tokens };
}

/** The single operand token a node writes. */
function operand(token: string): TokenGroup {
  return { tally: 'operands', tokens: [token] };
}

/**
 * The reader for a construct whose tokens never change.
 *
 * The group is built once, at load, and shared by every node of the construct;
 * `recordTokens` only ever reads it.
 */
function writes(group: TokenGroup): TokenReader {
  return () => group;
}

/** Every Halstead measure at zero, for a signature that has no body. */
export const EMPTY_HALSTEAD = Object.freeze({
  distinctOperators: 0,
  distinctOperands: 0,
  totalOperators: 0,
  totalOperands: 0,
  vocabulary: 0,
  length: 0,
  volume: 0,
  difficulty: 0,
  effort: 0,
});

/** A fresh tally, for callers that drive `recordTokens` themselves. */
export function createTally(): HalsteadTally {
  return { operators: [], operands: [] };
}

/**
 * The tokens each construct writes, keyed by node type.
 *
 * Leaf operator tokens and control keywords are operators; identifiers,
 * literals, `this`, `super` and template fragments are operands. A construct
 * that writes the same tokens for every node of its kind names them here, so
 * adding a keyword is one entry. The constructs whose tokens depend on what
 * the node says read the one field of their own that decides the answer, and
 * are named below.
 *
 * Declaration keywords (`class`, `function`, `const`, `extends`, `static`,
 * `import`, `export`, `as`, `satisfies`) are absent on purpose: they declare
 * a name or a shape rather than combine or transform a value, so they are not
 * operators. `try` and `finally` are absent for the same reason.
 */
const TOKEN_READERS: { readonly [K in ESTree.Node['type']]?: TokenReader } = {
  ArrowFunctionExpression: writes(operator('=>')),
  AssignmentExpression: writtenOperator,
  AssignmentPattern: writes(operator('=')),
  AwaitExpression: writes(operator('await')),
  BinaryExpression: writtenOperator,
  BreakStatement: writes(operator('break')),
  CallExpression: optionalChain,
  CatchClause: writes(operator('catch')),
  ConditionalExpression: writes(operator('?', ':')),
  ContinueStatement: writes(operator('continue')),
  DoWhileStatement: writes(operator('do', 'while')),
  ForInStatement: writes(operator('for', 'in')),
  ForOfStatement: forOfTokens,
  ForStatement: writes(operator('for')),
  FunctionDeclaration: generatorStar,
  FunctionExpression: generatorStar,
  Identifier: nameToken,
  IfStatement: ifTokens,
  JSXIdentifier: nameToken,
  LabeledStatement: writes(operator(':')),
  Literal: literalToken,
  LogicalExpression: writtenOperator,
  MemberExpression: optionalChain,
  MetaProperty: metaProperty,
  NewExpression: writes(operator('new')),
  PrivateIdentifier: privateName,
  Property: propertyColon,
  ReturnStatement: writes(operator('return')),
  Super: writes(operand('super')),
  SwitchCase: caseTokens,
  SwitchStatement: writes(operator('switch')),
  TemplateLiteral: templateOperands,
  ThisExpression: writes(operand('this')),
  ThrowStatement: writes(operator('throw')),
  TSNonNullExpression: writes(operator('!')),
  UnaryExpression: writtenOperator,
  UpdateExpression: writtenOperator,
  WhileStatement: writes(operator('while')),
  YieldExpression: yieldTokens,
};

/** The operator the expression wrote, read from the `operator` field it holds. */
function writtenOperator(node: ESTree.Node): TokenGroup | null {
  switch (node.type) {
    case 'AssignmentExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'UnaryExpression':
    case 'UpdateExpression':
      return operator(node.operator);
    default:
      return null;
  }
}

/** `?.`, which only an optional call or member writes. */
function optionalChain(node: ESTree.Node): TokenGroup | null {
  if (node.type === 'CallExpression' || node.type === 'MemberExpression') {
    return node.optional ? operator('?.') : null;
  }
  return null;
}

/** `new.target` writes the `new` keyword; `import.meta` writes no operator. */
function metaProperty(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'MetaProperty') return null;
  return node.meta.name === 'new' ? operator('new') : null;
}

/** The `*` of a generator function; an ordinary function writes none. */
function generatorStar(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression') return null;
  return node.generator ? operator('*') : null;
}

/** `yield`, plus `*` when the yield delegates to another iterator. */
function yieldTokens(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'YieldExpression') return null;
  return node.delegate ? operator('yield', '*') : operator('yield');
}

/**
 * The colon of `{ a: 1 }`, and the method shorthand `{ a() {} }`. `{ a }`
 * writes none, and neither does a `get`/`set` accessor, whose kind is `get`
 * or `set`.
 */
function propertyColon(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'Property') return null;
  return node.kind === 'init' && !node.shorthand ? operator(':') : null;
}

/** `if`, plus `else` when the statement has an alternate arm. */
function ifTokens(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'IfStatement') return null;
  return node.alternate === null ? operator('if') : operator('if', 'else');
}

/** `case` when the arm has a test; `case X:` and `default:` both write `:`. */
function caseTokens(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'SwitchCase') return null;
  return node.test === null ? operator(':') : operator('case', ':');
}

/** `for` and `of`, plus `await` when the iteration is async. */
function forOfTokens(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'ForOfStatement') return null;
  return node.await ? operator('for', 'of', 'await') : operator('for', 'of');
}

/** The text each quasi of a template contributes, in source order. */
function templateOperands(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'TemplateLiteral') return null;
  const texts = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
  return { tally: 'operands', tokens: texts };
}

/** The name an identifier writes. */
function nameToken(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'Identifier' && node.type !== 'JSXIdentifier') return null;
  return operand(node.name);
}

/** The `#name` a private identifier writes. */
function privateName(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'PrivateIdentifier') return null;
  return operand(`#${node.name}`);
}

/**
 * The literal as it was written.
 *
 * ESTree gives every literal shape the same `type: "Literal"`, so `raw` is the
 * only evidence of the token that was written. It is always present; the value
 * fallback would drop a string literal's quotes. `true`, `false` and `null`
 * are literals too, and reach the tally as their written text.
 */
function literalToken(node: ESTree.Node): TokenGroup | null {
  if (node.type !== 'Literal') return null;
  return operand(node.raw ?? String(node.value));
}

/**
 * Record the tokens `node` itself contributes.
 *
 * Its children are walked separately, so an identifier is counted once, at its
 * own node, and never again by the node that holds it.
 */
export function recordTokens(tally: HalsteadTally, node: ESTree.Node): void {
  const group = tokenGroup(node);
  if (group === null) return;
  tally[group.tally].push(...group.tokens);
}

/** The tokens `node` writes, or `null` when it writes none of them. */
function tokenGroup(node: ESTree.Node): TokenGroup | null {
  const read = TOKEN_READERS[node.type];
  if (read === undefined) return null;
  return read(node);
}

/**
 * The four Halstead formulas.
 *
 * A zero denominator yields zero, never `NaN`, so a function with no operands
 * reports a difficulty of zero instead of a broken number.
 */
export function finalizeHalstead(tally: HalsteadTally): HalsteadMetrics {
  const distinctOperators = new Set(tally.operators).size;
  const distinctOperands = new Set(tally.operands).size;
  const totalOperators = tally.operators.length;
  const totalOperands = tally.operands.length;
  const vocabulary = distinctOperators + distinctOperands;
  const length = totalOperators + totalOperands;
  const volume = vocabulary === 0 ? 0 : length * Math.log2(vocabulary);
  const difficulty =
    distinctOperands === 0 ? 0 : (distinctOperators / 2) * (totalOperands / distinctOperands);
  return {
    distinctOperators,
    distinctOperands,
    totalOperators,
    totalOperands,
    vocabulary,
    length,
    volume,
    difficulty,
    effort: difficulty * volume,
  };
}

/**
 * The normalized maintainability index.
 *
 * Volume and line count use a floor of one so their logarithms stay defined,
 * and the result is clamped into `0..100`.
 */
export function maintainabilityIndex(volume: number, cyclomatic: number, lines: number): number {
  const index =
    ((171 -
      5.2 * Math.log(Math.max(volume, 1)) -
      0.23 * cyclomatic -
      16.2 * Math.log(Math.max(lines, 1))) *
      100) /
    171;
  return Math.min(100, Math.max(0, index));
}
