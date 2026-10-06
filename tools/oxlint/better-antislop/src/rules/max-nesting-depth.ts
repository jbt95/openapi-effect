import { createMetricRule } from './create-metric-rule.ts';

export const maxNestingDepth = createMetricRule({
  select: (metrics) => metrics.maxNesting,
  limit: 4,
  direction: 'higher-is-worse',
  valueType: 'integer',
  messageId: 'nestingTooDeep',
  message:
    'Function "{{name}}" nests {{value}} levels deep, above the limit of {{limit}}. Flatten the inner blocks with early returns.',
  description: 'Require a maximum block nesting depth inside one function.',
});
