import { eslintCompatPlugin } from '@oxlint/plugins';
import antiSlopEffect from '../vendor/anti-slop/src/effect/index.ts';
import antiSlop from '../vendor/anti-slop/src/index.ts';
import { cognitiveComplexity, maxNestingDepth, minMaintainabilityIndex } from './rules/index.ts';

/**
 * The source plugin: this repository's three metric rules and the rules
 * vendored from `dmmulroy/anti-slop`, merged into one so a consumer configures
 * one `jsPlugins` entry and one rule prefix.
 *
 * The order of the spreads is the contract, not a style choice. A later spread
 * wins a name collision, and the metric rules come last on purpose: they are
 * the rules this repository wrote, specified in `docs/metrics.md` and checked
 * against a recorded corpus by the conformance suite. A vendored rule taking
 * one of their names must not silently displace a rule that carries both a
 * specification and a verification, so an upstream sync cannot replace one
 * behind a consumer's back. The order of everything before them is not
 * load-bearing; it is written out so a reader can see which vendored tree each
 * rule came from.
 *
 * The vendored trees keep their own `meta.name`. Only `rules` is read here, so
 * the exposed prefix is this plugin's own and the two names do not leak.
 *
 * Every rule ships without an opinion attached: nothing in this file turns one
 * on. `oxlint.config.ts` holds the eight this repository enables for itself.
 */
export default eslintCompatPlugin({
  meta: { name: 'better-antislop' },
  rules: {
    ...antiSlop.rules,
    ...antiSlopEffect.rules,
    'cognitive-complexity': cognitiveComplexity,
    'max-nesting-depth': maxNestingDepth,
    'min-maintainability-index': minMaintainabilityIndex,
  },
});
