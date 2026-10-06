import type { ESTree } from '@oxlint/plugins';

/**
 * Child traversal.
 *
 * Owns the one table that says, for every node type, which fields are its
 * child nodes and in what order. The discovery walk, the scoring walk and the
 * logical-sequence flattening all read their children from here, so the three
 * can never disagree about the shape of a tree.
 *
 * TypeScript type positions are deliberately absent: a type annotation declares
 * a shape, it does not run, so counting its `:` or its type names would let an
 * annotation move the metrics of code that executes. Namespaces and enums are
 * walked, because their members are runtime values.
 */
/**
 * The ESTree node that may carry one node type.
 *
 * A few node shapes spell their `type` as a union covering the plain and the
 * `TSAbstract` spelling of the same shape, so one node matches every type it
 * is able to report, not only one of them.
 */
type NodeOfType<K extends ESTree.Node['type']> = ESTree.Node extends infer T
  ? T extends ESTree.Node
    ? K extends T['type']
      ? T
      : never
    : never
  : never;

/** The child fields of one node type, in source order, before absent ones drop out. */
type ChildrenReader<K extends ESTree.Node['type']> = (
  node: NodeOfType<K>,
) => ReadonlyArray<ESTree.Node | null>;

/** Every reader, keyed by the node type it reads. */
type ChildrenTable = { readonly [K in ESTree.Node['type']]?: ChildrenReader<K> };

/** A node that carries no children. */
const NO_CHILDREN: ReadonlyArray<ESTree.Node> = [];

/** Drop the absent children from one node's child list. */
function compact(nodes: ReadonlyArray<ESTree.Node | null>): ReadonlyArray<ESTree.Node> {
  const present: ESTree.Node[] = [];
  for (const node of nodes) if (node !== null) present.push(node);
  return present;
}

/**
 * The child fields of every node type, keyed by that type.
 *
 * Adding a node type is one entry here. Each entry is checked against the node
 * it reads, so naming a field the node does not have is a compile error.
 */
const CHILDREN: ChildrenTable = {
  AccessorProperty: (node) => [...node.decorators, node.key, node.value],
  ArrayExpression: (node) => [...node.elements],
  ArrayPattern: (node) => [...node.elements],
  ArrowFunctionExpression: (node) => [...node.params, node.body],
  AssignmentExpression: (node) => [node.left, node.right],
  AssignmentPattern: (node) => [node.left, node.right],
  AwaitExpression: (node) => [node.argument],
  BinaryExpression: (node) => [node.left, node.right],
  BlockStatement: (node) => [...node.body],
  BreakStatement: (node) => [node.label],
  CallExpression: (node) => [node.callee, ...node.arguments],
  CatchClause: (node) => [node.param, node.body],
  ChainExpression: (node) => [node.expression],
  ClassBody: (node) => [...node.body],
  ClassDeclaration: (node) => [...node.decorators, node.id, node.superClass, node.body],
  ClassExpression: (node) => [...node.decorators, node.id, node.superClass, node.body],
  ConditionalExpression: (node) => [node.test, node.consequent, node.alternate],
  ContinueStatement: (node) => [node.label],
  Decorator: (node) => [node.expression],
  DoWhileStatement: (node) => [node.body, node.test],
  ExportAllDeclaration: (node) => [node.exported, node.source, ...node.attributes],
  ExportDefaultDeclaration: (node) => [node.declaration],
  ExportNamedDeclaration: (node) => [
    node.declaration,
    ...node.specifiers,
    node.source,
    ...node.attributes,
  ],
  ExportSpecifier: (node) => [node.local, node.exported],
  ExpressionStatement: (node) => [node.expression],
  ForInStatement: (node) => [node.left, node.right, node.body],
  ForOfStatement: (node) => [node.left, node.right, node.body],
  ForStatement: (node) => [node.init, node.test, node.update, node.body],
  FunctionDeclaration: (node) => [node.id, ...node.params, node.body],
  FunctionExpression: (node) => [node.id, ...node.params, node.body],
  IfStatement: (node) => [node.test, node.consequent, node.alternate],
  ImportAttribute: (node) => [node.key, node.value],
  ImportDeclaration: (node) => [...node.specifiers, node.source, ...node.attributes],
  ImportDefaultSpecifier: (node) => [node.local],
  ImportExpression: (node) => [node.source, node.options],
  ImportNamespaceSpecifier: (node) => [node.local],
  ImportSpecifier: (node) => [node.imported, node.local],
  JSXAttribute: (node) => [node.name, node.value],
  JSXClosingElement: (node) => [node.name],
  JSXElement: (node) => [node.openingElement, ...node.children, node.closingElement],
  JSXExpressionContainer: (node) => [node.expression],
  JSXFragment: (node) => [node.openingFragment, ...node.children, node.closingFragment],
  JSXMemberExpression: (node) => [node.object, node.property],
  JSXNamespacedName: (node) => [node.namespace, node.name],
  JSXOpeningElement: (node) => [node.name, ...node.attributes],
  JSXSpreadAttribute: (node) => [node.argument],
  JSXSpreadChild: (node) => [node.expression],
  LabeledStatement: (node) => [node.label, node.body],
  LogicalExpression: (node) => [node.left, node.right],
  MemberExpression: (node) => [node.object, node.property],
  MetaProperty: (node) => [node.meta, node.property],
  MethodDefinition: (node) => [...node.decorators, node.key, node.value],
  NewExpression: (node) => [node.callee, ...node.arguments],
  ObjectExpression: (node) => [...node.properties],
  ObjectPattern: (node) => [...node.properties],
  ParenthesizedExpression: (node) => [node.expression],
  Program: (node) => [...node.body],
  Property: (node) => [node.key, node.value],
  PropertyDefinition: (node) => [...node.decorators, node.key, node.value],
  RestElement: (node) => [node.argument],
  ReturnStatement: (node) => [node.argument],
  SequenceExpression: (node) => [...node.expressions],
  SpreadElement: (node) => [node.argument],
  StaticBlock: (node) => [...node.body],
  SwitchCase: (node) => [node.test, ...node.consequent],
  SwitchStatement: (node) => [node.discriminant, ...node.cases],
  TaggedTemplateExpression: (node) => [node.tag, node.quasi],
  TemplateLiteral: (node) => [...node.quasis, ...node.expressions],
  ThrowStatement: (node) => [node.argument],
  TryStatement: (node) => [node.block, node.handler, node.finalizer],
  TSAbstractAccessorProperty: (node) => [...node.decorators, node.key, node.value],
  TSAbstractMethodDefinition: (node) => [...node.decorators, node.key, node.value],
  TSAbstractPropertyDefinition: (node) => [...node.decorators, node.key, node.value],
  TSAsExpression: (node) => [node.expression],
  TSDeclareFunction: (node) => [node.id, ...node.params, node.body],
  TSEmptyBodyFunctionExpression: (node) => [node.id, ...node.params, node.body],
  TSEnumBody: (node) => [...node.members],
  TSEnumDeclaration: (node) => [node.id, node.body],
  TSEnumMember: (node) => [node.id, node.initializer],
  TSExportAssignment: (node) => [node.expression],
  TSExternalModuleReference: (node) => [node.expression],
  TSImportEqualsDeclaration: (node) => [node.id, node.moduleReference],
  TSInstantiationExpression: (node) => [node.expression],
  TSModuleBlock: (node) => [...node.body],
  TSModuleDeclaration: (node) => [node.id, node.body],
  TSNonNullExpression: (node) => [node.expression],
  TSParameterProperty: (node) => [...node.decorators, node.parameter],
  TSSatisfiesExpression: (node) => [node.expression],
  TSTypeAssertion: (node) => [node.expression],
  UnaryExpression: (node) => [node.argument],
  UpdateExpression: (node) => [node.argument],
  V8IntrinsicExpression: (node) => [node.name, ...node.arguments],
  VariableDeclaration: (node) => [...node.declarations],
  VariableDeclarator: (node) => [node.id, node.init],
  WhileStatement: (node) => [node.test, node.body],
  WithStatement: (node) => [node.object, node.body],
  YieldExpression: (node) => [node.argument],
};

/**
 * Read one node's children through the table, with its own type in hand.
 *
 * Carrying the type beside the node is what lets the table check every entry
 * against the node it reads, and it still reads as "any node" at a call site.
 */
function readChildren<K extends ESTree.Node['type']>(
  type: K,
  node: NodeOfType<K>,
): ReadonlyArray<ESTree.Node> {
  const reader: ChildrenReader<K> | undefined = CHILDREN[type];
  if (reader === undefined) return NO_CHILDREN;
  return compact(reader(node));
}

/**
 * The child nodes of `node`, in source order.
 *
 * A node with no entry in the table carries no children. Type positions are
 * absent from the table for the reason given at the top of this module.
 */
export function childrenOf(node: ESTree.Node): ReadonlyArray<ESTree.Node> {
  return readChildren(node.type, node);
}
