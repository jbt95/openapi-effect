import { createMetricRule } from './create-metric-rule.ts';

export const minMaintainabilityIndex = createMetricRule({
  select: (metrics) => metrics.maintainabilityIndex,
  limit: 65,
  direction: 'lower-is-worse',
  valueType: 'number',
  messageId: 'maintainabilityIndexTooLow',
  message:
    'Function "{{name}}" has maintainability index {{value}}, below the limit of {{limit}}. Shorten it and lower its operator and operand count.',
  description: 'Require a minimum maintainability index for one function.',
});
