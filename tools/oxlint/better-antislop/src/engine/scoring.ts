import type { ESTree } from '@oxlint/plugins';

import { isFunctionBoundary } from './boundary.ts';
import { childrenOf } from './children.ts';
import { createTally, finalizeHalstead, recordTokens } from './halstead.ts';
import type { HalsteadTally } from './halstead.ts';
import { flattenLogicalSequence, scoreLogicalSequence } from './logical.ts';
import type { TreeReader } from './logical.ts';
import type { HalsteadMetrics } from './types.ts';

/**
 * Scoring one function.
 *
 * Owns the walk that reads a single function's own syntax and turns it into
 * every score the report carries: logical lines, cyclomatic complexity, cognitive
 * complexity, maximum nesting, direct self-recursion and the Halstead tally.
 *
 * The scoring rules are the ones specified in `docs/complexity.md`, §3 to §6. The
 * decision constructs are read from a table, so adding one is an entry rather
 * than another branch.
 */

/** One node still to score, with the context the scores depend on. */
interface Frame {
  readonly node: ESTree.Node;
  /** Structural depth the node sits at inside the function. */
  readonly nesting: number;
  /** True when an enclosing `&&`/`||` chain already owns this subtree. */
  readonly insideLogical: boolean;
  /** True for the `if` of an `else if`, which continues its parent chain. */
  readonly elseIf: boolean;
  /** True when this is a shorthand property's default pattern value. */
  readonly shorthandDefault: boolean;
}

/** Every score one function earns from its own syntax. */
export interface FunctionScores {
  readonly logicalLines: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly maxNesting: number;
  readonly recursive: boolean;
  readonly halstead: HalsteadMetrics;
}

/** What one function has earned from the nodes visited so far. */
interface WalkScores {
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
  logicalLines: number;
  recursive: boolean;
  readonly tally: HalsteadTally;
}

/** What one decision construct adds to the function it stands in. */
interface ConstructScore {
  /** Points added to the function's cyclomatic complexity. */
  readonly cyclomatic: number;
  /** Cognitive points, with the nesting the construct was found at already in. */
  readonly cognitive: number;
  /** True when the construct also adds a structural level to its descendants. */
  readonly nests: boolean;
}

/** The reader both walks share, so logical flattening and scoring agree. */
const READER: TreeReader = { childrenOf, isFunctionBoundary };

/**
 * The cost of the decision constructs whose score does not read a field of the
 * node, keyed by node type.
 *
 * These are the rows of the specification's table that hold for every instance
 * of their construct, so adding one is an entry. The three that depend on what
 * the node says — `if`, a `switch` arm and a jump — are answered by name in
 * `constructScore`.
 */
const CONSTRUCT_SCORES: { readonly [K in ESTree.Node['type']]?: ConstructScore } = {
  CatchClause: { cyclomatic: 1, cognitive: 1, nests: true },
  ConditionalExpression: { cyclomatic: 1, cognitive: 1, nests: true },
  DoWhileStatement: { cyclomatic: 1, cognitive: 1, nests: true },
  ForInStatement: { cyclomatic: 1, cognitive: 1, nests: true },
  ForOfStatement: { cyclomatic: 1, cognitive: 1, nests: true },
  ForStatement: { cyclomatic: 1, cognitive: 1, nests: true },
  IfStatement: { cyclomatic: 1, cognitive: 1, nests: true },
  SwitchStatement: { cyclomatic: 0, cognitive: 1, nests: true },
  ThrowStatement: { cyclomatic: 1, cognitive: 0, nests: false },
  WhileStatement: { cyclomatic: 1, cognitive: 1, nests: true },
};

/** A `switch` arm with a test is a branch point; a `default:` arm is not. */
const CASE_SCORE: ConstructScore = { cyclomatic: 1, cognitive: 0, nests: false };

/** A labeled `break` or `continue` sends the reader somewhere new. */
const JUMP_SCORE: ConstructScore = { cyclomatic: 0, cognitive: 1, nests: false };

/**
 * Score one function from its own syntax.
 *
 * `anchor` is where a report points: the member node for a method, the
 * function node otherwise. `ownFunction` is the function inside it. Both are
 * walked, because the member's key and the function's own header are part of
 * what the source says about the function.
 */
export function scoreFunction(
  anchor: ESTree.Node,
  ownFunction: ESTree.Node,
  name: string | null,
): FunctionScores {
  const scores: WalkScores = {
    cyclomatic: 1,
    cognitive: 0,
    maxNesting: 0,
    logicalLines: 0,
    recursive: false,
    tally: createTally(),
  };
  walkFunction(anchor, ownFunction, name, scores);
  // Direct self-recursion is one extra cognitive point for the function as a
  // whole, not one per call site: reading the same cycle twice costs the
  // reader no more than reading it once.
  if (scores.recursive) scores.cognitive += 1;
  return {
    logicalLines: scores.logicalLines,
    cyclomatic: scores.cyclomatic,
    cognitive: scores.cognitive,
    maxNesting: scores.maxNesting,
    recursive: scores.recursive,
    halstead: finalizeHalstead(scores.tally),
  };
}

/** Read every node of one function, from its anchor down, and score each one. */
function walkFunction(
  anchor: ESTree.Node,
  ownFunction: ESTree.Node,
  name: string | null,
  scores: WalkScores,
): void {
  const stack: Frame[] = [
    { node: anchor, nesting: 0, insideLogical: false, elseIf: false, shorthandDefault: false },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const node = frame.node;
    if (node !== anchor && node !== ownFunction && isFunctionBoundary(node)) continue;
    if (countsAsLogicalLine(node)) scores.logicalLines += 1;
    scoreConstruct(node, frame, scores);
    scoreSequence(node, frame, scores);
    scoreRecursion(node, name, scores);
    recordTokens(scores.tally, node);
    pushChildFrames(stack, node, frame);
  }
}

/** Add what `node` contributes as a decision to the scores of its function. */
function scoreConstruct(node: ESTree.Node, frame: Frame, scores: WalkScores): void {
  const score = constructScore(node, frame);
  if (score === null) return;
  scores.cyclomatic += score.cyclomatic;
  scores.cognitive += score.cognitive;
  if (score.nests) scores.maxNesting = Math.max(scores.maxNesting, frame.nesting + 1);
}

/**
 * What `node` contributes as a decision, under the nesting it was found at.
 *
 * A plain construct is read from the table and has its nesting weight applied.
 * An `if`, a `switch` arm and a jump read a field of their own, so each gets a
 * named answer instead of a row.
 */
function constructScore(node: ESTree.Node, frame: Frame): ConstructScore | null {
  if (node.type === 'IfStatement') return ifScore(node, frame);
  if (node.type === 'SwitchCase') return node.test === null ? null : CASE_SCORE;
  if (node.type === 'BreakStatement' || node.type === 'ContinueStatement') {
    return node.label === null ? null : JUMP_SCORE;
  }
  const score = CONSTRUCT_SCORES[node.type];
  if (score === undefined) return null;
  return score.nests ? { ...score, cognitive: score.cognitive + frame.nesting } : score;
}

/**
 * What one `if` contributes, counting the arm that follows it.
 *
 * An `else if` adds a flat point and continues the chain: the depth the chain
 * was reached at already accounts for every branch in it, so the chain never
 * nests twice. A trailing `else` adds one point and no nesting.
 */
function ifScore(node: ESTree.IfStatement, frame: Frame): ConstructScore {
  const elseArm = node.alternate !== null && node.alternate.type !== 'IfStatement' ? 1 : 0;
  if (frame.elseIf) return { cyclomatic: 1, cognitive: 1 + elseArm, nests: false };
  return { cyclomatic: 1, cognitive: 1 + frame.nesting + elseArm, nests: true };
}

/** True for the constructs that add a structural level to their descendants. */
function raisesNesting(node: ESTree.Node): boolean {
  return CONSTRUCT_SCORES[node.type]?.nests === true;
}

/** True for declarations, control flow, jumps, returns and throws. */
function countsAsLogicalLine(node: ESTree.Node): boolean {
  switch (node.type) {
    case 'VariableDeclaration':
    case 'ExpressionStatement':
    case 'IfStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'SwitchStatement':
    case 'SwitchCase':
    case 'CatchClause':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;
    default:
      return false;
  }
}

/**
 * Score the `&&`/`||` chain written at `node`, once.
 *
 * A chain already owned by an enclosing operator was scored when it opened, so
 * walking into it again would count the same operators twice.
 */
function scoreSequence(node: ESTree.Node, frame: Frame, scores: WalkScores): void {
  if (!startsLogicalSequence(node) || frame.insideLogical) return;
  const score = scoreLogicalSequence(flattenLogicalSequence(node, READER));
  scores.cyclomatic += score.cyclomatic;
  scores.cognitive += score.cognitive;
}

/** True when `node` opens a chain the walk has not already scored. */
function startsLogicalSequence(node: ESTree.Node): boolean {
  // `??` is a logical expression in the tree but never a branch point.
  return node.type === 'LogicalExpression' && node.operator !== '??';
}

/** Note a direct self-call. The function pays for the first one only. */
function scoreRecursion(node: ESTree.Node, name: string | null, scores: WalkScores): void {
  if (name === null || scores.recursive) return;
  if (node.type === 'CallExpression' && callsSelf(node, name)) scores.recursive = true;
}

/**
 * True when a call is the function calling itself.
 *
 * Only the bare name and `this.<name>` are a cycle. `super.<name>` dispatches
 * to the parent class, and any other receiver is a different object.
 */
function callsSelf(call: ESTree.CallExpression, name: string): boolean {
  const callee = call.callee;
  if (callee.type === 'Identifier') return callee.name === name;
  if (callee.type === 'MemberExpression') {
    if (callee.object.type !== 'ThisExpression') return false;
    return callee.property.type === 'Identifier' && callee.property.name === name;
  }
  return false;
}

/** The depth the children of one node inherit. */
function nestingForChildren(node: ESTree.Node, frame: Frame): number {
  return frame.elseIf || !raisesNesting(node) ? frame.nesting : frame.nesting + 1;
}

/** The alternate `if` that continues its parent chain. */
function elseIfArmOf(node: ESTree.Node): ESTree.Node | null {
  return node.type === 'IfStatement' && node.alternate?.type === 'IfStatement'
    ? node.alternate
    : null;
}

/** The alternate arm inherits the parent `if` depth. */
function childNesting(
  node: ESTree.Node,
  child: ESTree.Node,
  frame: Frame,
  nesting: number,
): number {
  return node.type === 'IfStatement' && child === node.alternate ? frame.nesting : nesting;
}

/** The value node that repeats a shorthand key in the AST. */
function duplicateShorthandNode(node: ESTree.Node): ESTree.Node | null {
  if (node.type !== 'Property' || !node.shorthand) return null;
  if (node.value.type === 'Identifier') return node.value;
  if (node.value.type === 'AssignmentPattern' && node.value.left.type === 'Identifier') {
    return node.value;
  }
  return null;
}

/** True when a child is the second AST node for a shorthand name. */
function isDuplicateShorthandName(
  node: ESTree.Node,
  child: ESTree.Node,
  frame: Frame,
  duplicate: ESTree.Node | null,
): boolean {
  if (child === duplicate && child.type === 'Identifier') return true;
  return frame.shorthandDefault && node.type === 'AssignmentPattern' && child === node.left;
}

/** Queue a node's children so the stack pops them in source order. */
function pushChildFrames(stack: Frame[], node: ESTree.Node, frame: Frame): void {
  // `try` and alternate `if` arms group statements without adding a level.
  const nesting = nestingForChildren(node, frame);
  const elseIfArm = elseIfArmOf(node);
  const insideLogical = frame.insideLogical || startsLogicalSequence(node);
  const duplicate = duplicateShorthandNode(node);
  const children = childrenOf(node);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child === undefined) continue;
    // The key node already counts the single name written by a shorthand.
    if (isDuplicateShorthandName(node, child, frame, duplicate)) continue;
    stack.push({
      node: child,
      // An alternate arm inherits the `if` depth; it does not open a level.
      nesting: childNesting(node, child, frame, nesting),
      insideLogical,
      elseIf: child === elseIfArm,
      shorthandDefault: child === duplicate && child.type === 'AssignmentPattern',
    });
  }
}
