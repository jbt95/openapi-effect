/**
 * The metric engine's public interface.
 *
 * Everything the rules need — the nesting model, the logical-sequence rules,
 * the Halstead token accounting — lives behind this one function, so no rule
 * ever touches the AST and no two rules can drift apart.
 *
 * Nested functions are scored independently and never contribute to their
 * enclosing function. See `docs/function-metrics.md` §11.
 *
 * Import from this module, not from `./analyze.ts`. The implementation may be
 * reorganised; this re-export is the stable seam.
 */
export { analyzeProgram } from './analyze.ts';
