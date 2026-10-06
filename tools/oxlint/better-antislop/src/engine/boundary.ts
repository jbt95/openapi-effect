import type { ESTree } from '@oxlint/plugins';

/**
 * The function boundary.
 *
 * Owns the one question every walk asks: does this node hold a function? The
 * answer decides where a function's own syntax ends. A node found to hold one
 * is scored on its own, so the function around it never walks into it, never
 * counts its decisions, and never lets its nesting raise its own depth.
 */

/**
 * True when `node` holds a function.
 *
 * This is the scoring boundary. A function found here is scored on its own, so
 * the function around it never walks into it, never counts its decisions, and
 * never lets its nesting raise its own depth.
 */
export function isFunctionBoundary(node: ESTree.Node): boolean {
  if (isFunctionNode(node)) return true;
  switch (node.type) {
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      return true;
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
      return isFunctionValue(node.value);
    case 'Property':
      // `{ a() {} }` sets `method: true`; the function is then the site in its
      // own right and the property only supplies its name and kind.
      return !node.method && isFunctionValue(node.value);
    default:
      return false;
  }
}

/** True for the node kinds that are a function in their own right. */
export function isFunctionNode(node: ESTree.Node): boolean {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      return true;
    default:
      return false;
  }
}

/** The function a site node holds; a function node is its own function. */
export function functionValueOf(node: ESTree.Node): ESTree.Node | null {
  switch (node.type) {
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
    case 'Property':
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
      return node.value;
    default:
      return node;
  }
}

/** True for the `function`-shaped nodes that carry a `params` and a `body`. */
export function isClassicFunction(node: ESTree.Node): node is ESTree.Function {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      return true;
    default:
      return false;
  }
}

/** The direct parameters of a function, or `null` when it has none to give. */
export function parametersOf(node: ESTree.Node): ESTree.ParamPattern[] | null {
  if (node.type === 'ArrowFunctionExpression') return node.params;
  if (isClassicFunction(node)) return node.params;
  return null;
}

/** The body of a function, or `null` for a signature that declares no body. */
export function bodyOf(node: ESTree.Node): ESTree.Node | null {
  if (node.type === 'ArrowFunctionExpression') return node.body;
  if (isClassicFunction(node)) return node.body;
  return null;
}

/** True when a `property` or class-field value position holds a function. */
function isFunctionValue(value: ESTree.Node | null): boolean {
  if (value === null) return false;
  return value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression';
}
