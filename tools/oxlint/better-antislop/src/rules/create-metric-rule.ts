import { defineRule } from '@oxlint/plugins';
import type {
  Context,
  DiagnosticData,
  ESTree,
  Location,
  Options,
  Rule,
  RuleMeta,
  RuleOptionsSchema,
  VisitorWithHooks,
} from '@oxlint/plugins';
import { analyzeProgram } from '../engine/contract.ts';
import type { FunctionMetrics, ProgramMetrics, Span } from '../engine/types.ts';

/** Most cost metrics grow as they get worse; the maintainability index shrinks. */
export type MetricDirection = 'higher-is-worse' | 'lower-is-worse';

/** The whole difference between one metric rule and the next. */
export interface MetricRuleDescriptor {
  /** The field of {@link FunctionMetrics} that this rule limits. */
  readonly select: (metrics: FunctionMetrics) => number;
  /** The limit, and the default whenever the option is absent. */
  readonly limit: number;
  readonly direction: MetricDirection;
  readonly messageId: string;
  /** Must interpolate `{name}`, `{value}` and `{limit}`. */
  readonly message: string;
  readonly description: string;
  /** `integer` for counts, `number` for the float maintainability index. */
  readonly valueType: 'integer' | 'number';
}

/** One option value as it arrives from the config file, or absent. */
type RawOption = Options[number] | undefined;

/** The JSON object form of the single option every metric rule accepts. */
type OptionRecord = Extract<Options[number], Record<string, Options[number]>>;

/**
 * The analysis of one file, keyed by its `Program` node.
 *
 * The node is the key because oxlint allocates a fresh `Program` per file, so an
 * entry lives exactly as long as the file it describes. Every metric rule shares
 * this map, so three rules over one file cost one traversal.
 */
const analyses = new WeakMap<ESTree.Program, ProgramMetrics>();

function analyzeCached(program: ESTree.Program): ProgramMetrics {
  const cached = analyses.get(program);
  if (cached !== undefined) return cached;
  const metrics = analyzeProgram(program);
  analyses.set(program, metrics);
  return metrics;
}

/**
 * Rule options arrive from the config file as JSON, so the compiler cannot see
 * their shape. This guard is the boundary decode for that raw data: nothing
 * downstream of it handles an untyped option value.
 */
function isOptionRecord(value: RawOption): value is OptionRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows a decoded option value to the number it may carry. */
function isNumberValue(value: RawOption): value is number {
  return typeof value === 'number';
}

/** Reads the `limit` option, or `null` when it is absent or malformed. */
function readLimitOption(options: Readonly<Options>): number | null {
  const [first] = options;
  if (!isOptionRecord(first)) return null;
  const limit = first['limit'];
  return isNumberValue(limit) ? limit : null;
}

/** Map the engine `Span` onto the `loc` shape that oxlint reports. */
function toLoc(span: Span): Location {
  return {
    start: { line: span.start.line, column: span.start.column },
    end: { line: span.end.line, column: span.end.column },
  };
}

/** The one option shape accepted by every metric rule: `{ limit }`. */
function buildSchema(valueType: MetricRuleDescriptor['valueType']): RuleOptionsSchema {
  return [
    {
      type: 'object',
      properties: { limit: { type: valueType, minimum: 0 } },
      additionalProperties: false,
    },
  ];
}

/** The rule metadata every metric rule shares, built from its descriptor. */
function buildMeta(descriptor: MetricRuleDescriptor): RuleMeta {
  return {
    type: 'suggestion',
    docs: { description: descriptor.description },
    schema: buildSchema(descriptor.valueType),
    defaultOptions: [{ limit: descriptor.limit }],
    messages: { [descriptor.messageId]: descriptor.message },
  };
}

/**
 * The pair a report prints, and the name they belong to.
 *
 * The reported value and limit are the numbers that were compared, never a
 * rounded copy of them. `String` prints the shortest text that reads back as
 * the same number, so the two values a reader compares are the two the rule
 * compared. Rounding is what made a report argue with itself: a function
 * scoring `64.96` against a limit of `65` printed as `65.0`, and the message
 * read "below the limit of 65" about a function that equalled the limit.
 */
function diagnosticData(fn: FunctionMetrics, value: number, limit: number): DiagnosticData {
  return {
    name: fn.name ?? '<anonymous>',
    value: String(value),
    limit: String(limit),
  };
}

/**
 * Reports every function whose selected metric sits outside `limit`.
 *
 * A bodyless declaration scores as all zeros, and a declaration is never a
 * complexity violation. Without the first guard below, the maintainability
 * index would fire on every `declare function`.
 */
function reportOutOfLimit(
  descriptor: MetricRuleDescriptor,
  context: Context,
  program: ESTree.Program,
  limit: number,
): void {
  for (const fn of analyzeCached(program).functions) {
    if (fn.cyclomatic === 0) continue;
    const value = descriptor.select(fn);
    const outOfLimit = descriptor.direction === 'higher-is-worse' ? value > limit : value < limit;
    if (!outOfLimit) continue;
    context.report({
      node: program,
      loc: toLoc(fn.span),
      messageId: descriptor.messageId,
      data: diagnosticData(fn, value, limit),
    });
  }
}

/**
 * Build a rule that reports every function whose selected metric is out of
 * limit.
 *
 * Every metric rule does the same four things — analyse the file once, select
 * the functions, compare one number against a limit, report at the function —
 * so they are written once here. The descriptor is all that a rule supplies.
 */
export function createMetricRule(descriptor: MetricRuleDescriptor): Rule {
  return defineRule({
    meta: buildMeta(descriptor),
    createOnce(context: Context): VisitorWithHooks {
      return {
        // Options are bound per file, so they are read here and never in `createOnce`.
        Program(program: ESTree.Program): void {
          reportOutOfLimit(
            descriptor,
            context,
            program,
            readLimitOption(context.options) ?? descriptor.limit,
          );
        },
      };
    },
  });
}
