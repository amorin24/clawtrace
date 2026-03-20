const fs = require('fs');
const path = require('path');

class CostEstimator {
  constructor() {
    const pricingPath = path.join(__dirname, 'model-pricing.json');
    const pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
    this.models = pricingData.models;
  }

  normaliseModel(modelString) {
    if (!modelString) {
      return null;
    }

    const normalized = modelString.toLowerCase().trim();

    const prefixes = ['openrouter/', 'openai/', 'anthropic/', 'google/', 'meta-llama/', 'cohere/'];
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        return normalized;
      }
    }

    if (normalized.includes('/')) {
      return normalized;
    }

    if (normalized.startsWith('claude')) {
      return `anthropic/${normalized}`;
    }
    if (normalized.startsWith('gpt')) {
      return `openai/${normalized}`;
    }
    if (normalized.startsWith('gemini')) {
      return `google/${normalized}`;
    }
    if (normalized.startsWith('llama')) {
      return `meta-llama/${normalized}`;
    }

    return normalized;
  }

  isKnownModel(model) {
    const normalized = this.normaliseModel(model);
    if (!normalized) {
      return false;
    }
    return normalized in this.models;
  }

  estimate(model, inputTokens, outputTokens) {
    const normalized = this.normaliseModel(model);
    if (!normalized || !(normalized in this.models)) {
      return null;
    }

    const pricing = this.models[normalized];

    if (pricing.input === null || pricing.output === null) {
      return null;
    }

    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      inputCost: Number(inputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost: Number(totalCost.toFixed(6))
    };
  }
}

module.exports = CostEstimator;
