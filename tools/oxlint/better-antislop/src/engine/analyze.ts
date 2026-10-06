import type { ESTree } from '@oxlint/plugins';

import { bodyOf, parametersOf } from './boundary.ts';
import { classifyFunction, discoverFunctions } from './discovery.ts';
import type { FunctionSite } from './discovery.ts';
import { EMPTY_HALSTEAD, maintainabilityIndex } from './halstead.ts';
import { scoreFunction } from './scoring.ts';
import type {
  AnalyzeOptions,
  FunctionKind,
  FunctionMetrics,
  ProgramMetrics,
  Span,
} from './types.ts';

/**
 * The metric engine.
 *
 * One walk of the `Program` finds every function; each function is then scored
 * from its own syntax. A nested function is a boundary: it is scored on its
 * own and contributes nothing to the function around it, so the nesting model,
 * the logical-sequence rules and the Halstead accounting each live in exactly
 * one place.
 *
 * This module owns the assembly: it turns each discovered site into the
 * reported metrics and puts the report in source order. The walk and the
 * scoring it feeds live in `discovery.ts` and `scoring.ts`.
 *
 * The module is pure. It touches no oxlint runtime, no filesystem and no
 * effect runtime, and keeps no state between calls, so one instance can score
 * every file of a run.
 */

/** The half-open span of a node: 1-based lines, 0-based columns. */
function spanOf(node: ESTree.Node): Span {
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
}

function compareByPosition(left: FunctionMetrics, right: FunctionMetrics): number {
  return (
    left.span.start.line - right.span.start.line || left.span.start.column - right.span.start.column
  );
}

/** Measure one discovered function. */
function analyzeSite(site: FunctionSite): FunctionMetrics {
  const { name, kind } = classifyFunction(site);
  const span = spanOf(site.anchor);
  // A signature with no body states a shape, not a behaviour, so it carries a
  // location and nothing else.
  return bodyOf(site.body) === null
    ? signatureMetrics(name, kind, span)
    : scoredMetrics(site, name, kind, span);
}

/** The metrics of a declaration that states a shape and no behaviour. */
function signatureMetrics(name: string | null, kind: FunctionKind, span: Span): FunctionMetrics {
  return {
    name,
    kind,
    span,
    lines: 0,
    logicalLines: 0,
    parameters: 0,
    cyclomatic: 0,
    cognitive: 0,
    maxNesting: 0,
    halstead: EMPTY_HALSTEAD,
    maintainabilityIndex: 0,
    recursive: false,
  };
}

/** The metrics of one function that has a body, read from its own syntax. */
function scoredMetrics(
  site: FunctionSite,
  name: string | null,
  kind: FunctionKind,
  span: Span,
): FunctionMetrics {
  const scores = scoreFunction(site.anchor, site.body, name);
  const lines = span.end.line - span.start.line + 1;
  return {
    name,
    kind,
    span,
    lines,
    logicalLines: scores.logicalLines,
    parameters: parametersOf(site.body)?.length ?? 0,
    cyclomatic: scores.cyclomatic,
    cognitive: scores.cognitive,
    maxNesting: scores.maxNesting,
    halstead: scores.halstead,
    maintainabilityIndex: maintainabilityIndex(scores.halstead.volume, scores.cyclomatic, lines),
    recursive: scores.recursive,
  };
}

function requireProgramRoot(program: ESTree.Program, filename: string | undefined): void {
  // Widened before the check so the branch never narrows the node away.
  const received: string = program.type;
  if (received !== 'Program') {
    const source = filename === undefined ? '' : ` for ${filename}`;
    throw new Error(`analyzeProgram expects an ESTree Program node${source}, received ${received}`);
  }
}

/**
 * Measure every function in one parsed file.
 *
 * The result is ordered by start line and then start column, so two runs over
 * the same file always produce the same list.
 */
export function analyzeProgram(
  program: ESTree.Program,
  options: AnalyzeOptions = {},
): ProgramMetrics {
  requireProgramRoot(program, options.filename);
  const functions = discoverFunctions(program).map((site) => analyzeSite(site));
  functions.sort(compareByPosition);
  return { functions };
}
