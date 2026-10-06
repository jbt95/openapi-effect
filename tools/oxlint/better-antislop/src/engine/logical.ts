import type { ESTree } from '@oxlint/plugins';

/**
 * Logical-operator accounting.
 *
 * A chain of `&&`/`||` is one sequence, read in the order the operators are
 * written. That order is *not* the tree order: `a || b && c || d && e` parses
 * with the outermost `||` at the root, so a preorder walk reads
 * `||, ||, &&, &&` and scores a cognitive total of 2. Reading in order gives
 * `||, &&, ||, &&`, an operator change at every position, and the correct 4.
 */

/** The operators that create a branch point. `??` is deliberately absent. */
export type LogicalOperator = '&&' | '||';

/** The two ways the walk needs to look at a node. */
export interface TreeReader {
  /** The child nodes of `node`, in source order. */
  readonly childrenOf: (node: ESTree.Node) => ReadonlyArray<ESTree.Node>;
  /** True when `node` starts a nested function, which is scored on its own. */
  readonly isFunctionBoundary: (node: ESTree.Node) => boolean;
}

/** What one logical sequence contributes to a function's scores. */
export interface LogicalSequenceScore {
  readonly cyclomatic: number;
  readonly cognitive: number;
}

/**
 * Every `&&` and `||` written inside `node`, in source order.
 *
 * `??` is skipped: it is an ESTree `LogicalExpression` but never a branch.
 * Parentheses do not start a new sequence. Nested function bodies are skipped
 * whole, so their operators never join the enclosing chain.
 */
export function flattenLogicalSequence(
  node: ESTree.Node,
  reader: TreeReader,
): ReadonlyArray<LogicalOperator> {
  const operators: LogicalOperator[] = [];
  collect(node, reader, operators);
  return operators;
}

/**
 * Score one flattened sequence: every operator is a branch point, and the
 * cognitive score pays 1 for the first operator and 1 more on every change of
 * operator. Repeating the same operator adjacently adds nothing.
 */
export function scoreLogicalSequence(
  sequence: ReadonlyArray<LogicalOperator>,
): LogicalSequenceScore {
  let cognitive = 0;
  let previous: LogicalOperator | null = null;
  for (const operator of sequence) {
    if (operator !== previous) cognitive += 1;
    previous = operator;
  }
  return { cyclomatic: sequence.length, cognitive };
}

function collect(node: ESTree.Node, reader: TreeReader, out: LogicalOperator[]): void {
  if (reader.isFunctionBoundary(node)) return;
  if (node.type === 'LogicalExpression') {
    // In order: the left operand's operators are written before this node's
    // operator, and the right operand's after it.
    collect(node.left, reader, out);
    if (node.operator !== '??') out.push(node.operator);
    collect(node.right, reader, out);
    return;
  }
  for (const child of reader.childrenOf(node)) collect(child, reader, out);
}
