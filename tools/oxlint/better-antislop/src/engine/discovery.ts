import type { ESTree } from '@oxlint/plugins';

import {
  functionValueOf,
  isClassicFunction,
  isFunctionBoundary,
  isFunctionNode,
} from './boundary.ts';
import { childrenOf } from './children.ts';
import type { FunctionKind } from './types.ts';

/**
 * Finding and naming functions.
 *
 * Owns the single walk that visits a program once and collects every function
 * site in it, and the naming and classification that turn a site into the
 * reported name and kind. A nested function is a site of its own: the walk
 * steps into it, scores it separately, and keeps going.
 */

/** One function found in the program, with the context that names it. */
export interface FunctionSite {
  /** The node whose span and position anchor a report. */
  readonly anchor: ESTree.Node;
  /** The function node itself, the thing that gets scored. */
  readonly body: ESTree.Node;
  /** The member or property that gave the function its name and kind. */
  readonly container: ESTree.Node | null;
  /** The variable an anonymous function was bound to, when there was one. */
  readonly binding: string | null;
}

/** A node still to visit, plus the variable name it inherited. */
interface PendingNode {
  readonly node: ESTree.Node;
  readonly binding: string | null;
}

/** Walk the program once and collect every function site in it. */
export function discoverFunctions(program: ESTree.Program): ReadonlyArray<FunctionSite> {
  const sites: FunctionSite[] = [];
  const stack: PendingNode[] = [{ node: program, binding: null }];
  while (stack.length > 0) {
    const pending = stack.pop();
    if (pending === undefined) break;
    collectSite(pending, sites, stack);
  }
  return sites;
}

/** Record the function a pending node holds, if it holds one, then queue its children. */
function collectSite(pending: PendingNode, sites: FunctionSite[], stack: PendingNode[]): void {
  const node = pending.node;
  if (!isFunctionBoundary(node)) {
    pushChildren(stack, node, bindingNameOf(node));
    return;
  }
  const functionNode = functionValueOf(node);
  if (functionNode !== null) {
    sites.push({
      anchor: node,
      body: functionNode,
      container: isFunctionNode(node) ? null : node,
      binding: pending.binding,
    });
  }
  // The functions nested inside this one are found by the same walk.
  pushChildren(stack, functionNode ?? node, null);
}

/**
 * Queue a node's children so the stack pops them in source order.
 *
 * A `binding` is handed to the children only of a plain node: inside a function
 * boundary every nested node starts with no name of its own.
 */
function pushChildren(stack: PendingNode[], node: ESTree.Node, binding: string | null): void {
  const children = childrenOf(node);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child === undefined) continue;
    stack.push({ node: child, binding });
  }
}

/** The variable a function was assigned to, when it was assigned to one. */
function bindingNameOf(node: ESTree.Node): string | null {
  switch (node.type) {
    case 'VariableDeclarator':
      return node.id.type === 'Identifier' ? node.id.name : null;
    case 'AssignmentExpression':
      return node.left.type === 'Identifier' ? node.left.name : null;
    default:
      return null;
  }
}

/** The declared name and the shape of one discovered function. */
export function classifyFunction(site: FunctionSite): {
  readonly name: string | null;
  readonly kind: FunctionKind;
} {
  const { body, container, binding } = site;
  const named = isClassicFunction(body) && body.id !== null;
  return {
    name: container !== null ? propertyKeyName(container) : declaredName(body, binding),
    kind: classifyKind(body, container, named),
  };
}

/** The declared name of one discovered function. */
function declaredName(body: ESTree.Node, binding: string | null): string | null {
  if (body.type === 'ArrowFunctionExpression') return binding;
  if (isClassicFunction(body)) return body.id === null ? null : body.id.name;
  return null;
}

/** The shape of one discovered function, from its node and its container. */
function classifyKind(
  body: ESTree.Node,
  container: ESTree.Node | null,
  named: boolean,
): FunctionKind {
  if (body.type === 'ArrowFunctionExpression') return 'arrow';
  const plain: FunctionKind = named ? 'function' : 'anonymous';
  if (container === null) return plain;
  return containerKind(container) ?? plain;
}

/** The kind a member container gives the function it holds, or `null` for none. */
function containerKind(container: ESTree.Node): FunctionKind | null {
  switch (container.type) {
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      if (container.kind === 'constructor') return 'constructor';
      if (container.kind === 'get') return 'getter';
      if (container.kind === 'set') return 'setter';
      return 'method';
    case 'Property':
      if (container.kind === 'get') return 'getter';
      if (container.kind === 'set') return 'setter';
      return null;
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
      return 'method';
    default:
      return null;
  }
}

/** The written name of a member key, or `null` when there is none to read. */
function propertyKeyName(node: ESTree.Node): string | null {
  switch (node.type) {
    case 'AccessorProperty':
    case 'TSAbstractAccessorProperty':
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
    case 'Property':
    case 'PropertyDefinition':
    case 'TSAbstractPropertyDefinition':
      break;
    default:
      return null;
  }
  // A computed key (`[key]`) and a string-literal key (`'key'`) have no name
  // readable from the tree alone: only the source text carries one.
  if (node.computed) return null;
  return node.key.type === 'Identifier' || node.key.type === 'PrivateIdentifier'
    ? node.key.name
    : null;
}
