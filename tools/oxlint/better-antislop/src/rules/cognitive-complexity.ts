import { createMetricRule } from './create-metric-rule.ts';

export const cognitiveComplexity = createMetricRule({
  select: (metrics) => metrics.cognitive,
  limit: 15,
  direction: 'higher-is-worse',
  valueType: 'integer',
  messageId: 'cognitiveComplexityTooHigh',
  message:
    'Function "{{name}}" has cognitive complexity {{value}}, above the limit of {{limit}}. Move the nested decisions into named helper functions.',
  description: 'Require a maximum cognitive complexity for one function.',
});
