/**
 * The metric engine's interface.
 *
 * This module is pure: it turns one ESTree `Program` into plain data and
 * touches no oxlint runtime, no filesystem, and no Effect runtime. That is
 * what lets the conformance suite and the rule tests exercise it directly.
 */

/** A half-open source position, 1-based line and 0-based column. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** The span of a function, used to anchor lint diagnostics. */
export interface Span {
  readonly start: Position;
  readonly end: Position;
}

export type FunctionKind =
  | 'function'
  | 'method'
  | 'arrow'
  | 'constructor'
  | 'getter'
  | 'setter'
  | 'anonymous';

/**
 * Halstead measures, as specified in `docs/halstead.md` §7.
 *
 * `n1`/`n2` count distinct operators/operands; `N1`/`N2` count their total
 * occurrences. `volume`, `difficulty` and `effort` derive from those four.
 */
export interface HalsteadMetrics {
  readonly distinctOperators: number;
  readonly distinctOperands: number;
  readonly totalOperators: number;
  readonly totalOperands: number;
  readonly vocabulary: number;
  readonly length: number;
  readonly volume: number;
  readonly difficulty: number;
  readonly effort: number;
}

/** Every metric computed for one function. All values come from its own syntax. */
export interface FunctionMetrics {
  /** The declared name, or `null` for an anonymous function. */
  readonly name: string | null;
  readonly kind: FunctionKind;
  readonly span: Span;

  /** Inclusive physical line span of the function. */
  readonly lines: number;
  /** Logical statements: declarations, expression statements, control flow, jumps, returns, throws. */
  readonly logicalLines: number;
  /** Direct parameter count. */
  readonly parameters: number;

  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly maxNesting: number;
  readonly halstead: HalsteadMetrics;
  readonly maintainabilityIndex: number;

  /** True when the function calls itself by name. Indirect recursion is not detected. */
  readonly recursive: boolean;
}

/** The result of analysing one file. */
export interface ProgramMetrics {
  readonly functions: ReadonlyArray<FunctionMetrics>;
}

export interface AnalyzeOptions {
  /**
   * Reported in thrown diagnostics only. Never used to change a metric.
   */
  readonly filename?: string | undefined;
}
