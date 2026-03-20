const { describe, test } = require('node:test');
const assert = require('node:assert');
const CostEstimator = require('../lib/cost-estimator.js');

describe('CostEstimator', () => {
  test('known model returns correct cost for given token counts', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('anthropic/claude-sonnet-4-6', 1000000, 1000000);

    assert.strictEqual(result.inputCost, 3.0);
    assert.strictEqual(result.outputCost, 15.0);
    assert.strictEqual(result.totalCost, 18.0);
  });

  test('calculates cost for partial million tokens', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('anthropic/claude-haiku-4-5', 500000, 250000);

    assert.strictEqual(result.inputCost, 0.4);
    assert.strictEqual(result.outputCost, 1.0);
    assert.strictEqual(result.totalCost, 1.4);
  });

  test('zero token counts return zero cost', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('anthropic/claude-sonnet-4-6', 0, 0);

    assert.strictEqual(result.inputCost, 0);
    assert.strictEqual(result.outputCost, 0);
    assert.strictEqual(result.totalCost, 0);
  });

  test('unknown model returns null without error', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('unknown/model-xyz', 1000000, 1000000);

    assert.strictEqual(result, null);
  });

  test('null model returns null', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate(null, 1000000, 1000000);

    assert.strictEqual(result, null);
  });

  test('models with null pricing return null', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('openrouter/auto', 1000000, 1000000);

    assert.strictEqual(result, null);
  });

  test('normaliseModel strips provider prefix correctly', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.normaliseModel('anthropic/claude-sonnet-4-6'), 'anthropic/claude-sonnet-4-6');
    assert.strictEqual(estimator.normaliseModel('openai/gpt-4o'), 'openai/gpt-4o');
    assert.strictEqual(estimator.normaliseModel('google/gemini-pro-1.5'), 'google/gemini-pro-1.5');
  });

  test('normaliseModel adds prefix for models without one', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.normaliseModel('claude-sonnet-4-6'), 'anthropic/claude-sonnet-4-6');
    assert.strictEqual(estimator.normaliseModel('gpt-4o'), 'openai/gpt-4o');
    assert.strictEqual(estimator.normaliseModel('gemini-pro-1.5'), 'google/gemini-pro-1.5');
    assert.strictEqual(estimator.normaliseModel('llama-3.1-8b-instruct'), 'meta-llama/llama-3.1-8b-instruct');
  });

  test('normaliseModel handles case insensitivity', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.normaliseModel('ANTHROPIC/CLAUDE-SONNET-4-6'), 'anthropic/claude-sonnet-4-6');
    assert.strictEqual(estimator.normaliseModel('OpenAI/GPT-4o'), 'openai/gpt-4o');
  });

  test('normaliseModel returns null for null input', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.normaliseModel(null), null);
  });

  test('isKnownModel returns true for known models', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.isKnownModel('anthropic/claude-sonnet-4-6'), true);
    assert.strictEqual(estimator.isKnownModel('claude-sonnet-4-6'), true);
    assert.strictEqual(estimator.isKnownModel('openai/gpt-4o'), true);
    assert.strictEqual(estimator.isKnownModel('gpt-4o'), true);
  });

  test('isKnownModel returns false for unknown models', () => {
    const estimator = new CostEstimator();

    assert.strictEqual(estimator.isKnownModel('unknown/model'), false);
    assert.strictEqual(estimator.isKnownModel(null), false);
  });

  test('estimate works with model names without prefix', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('gpt-4o-mini', 1000000, 1000000);

    assert.strictEqual(result.inputCost, 0.15);
    assert.strictEqual(result.outputCost, 0.6);
    assert.strictEqual(result.totalCost, 0.75);
  });

  test('small token counts have correct precision', () => {
    const estimator = new CostEstimator();
    const result = estimator.estimate('anthropic/claude-haiku-4-5', 1000, 1000);

    assert.strictEqual(result.inputCost, 0.0008);
    assert.strictEqual(result.outputCost, 0.004);
    assert.strictEqual(result.totalCost, 0.0048);
  });
});
