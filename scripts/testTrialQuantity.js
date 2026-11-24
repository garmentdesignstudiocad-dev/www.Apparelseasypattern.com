const test = require('node:test'), assert = require('node:assert/strict');
const { validateItems } = require('../services/trialQuantity');
const patternOptions = require('../services/patternOptions');

const row = (q, s = ['S'], id = 'one', trial_sizes = null, physical_sizes = null, physical_quantity = 0) => ({
  product_id: id,
  trial_quantity: q,
  selected_sizes: s,
  trial_sizes,
  physical_sizes,
  physical_quantity,
  quantity: 0,
  printable_selected: false
});

test('Per-size and duplicate limits', () => {
  for (const n of [1, 2]) assert.equal(validateItems([row(n)]), null);
  for (const n of [3, 4, -1, 1.5, NaN]) assert(validateItems([row(n)]));
  assert.equal(validateItems([row(4, ['S', 'M'])]), null);
  assert(validateItems([row(3, ['S', 'S', 'S'])]));
  assert(validateItems([row(2), row(1)]));
  assert.equal(validateItems([row(1), row(1)]), null);
  assert.equal(validateItems([row(2), row(2, ['M'])]), null);
  assert.equal(validateItems([row(2), row(2, ['S'], 'two')]), null);
});

test('Multiple sizes with separate dropdown quantities (1 or 2)', () => {
  // Size S -> 2, Size M -> 1, Total = 3 across two sizes allowed
  assert.equal(validateItems([row(3, ['S', 'M'], 'one', { S: 2, M: 1 })]), null);
  assert.equal(validateItems([row(3, ['S', 'M'], 'one', { S: 1, M: 2 })]), null);
  assert.equal(validateItems([row(2, ['S', 'M'], 'one', { S: 1, M: 1 })]), null);
  assert.equal(validateItems([row(4, ['S', 'M'], 'one', { S: 2, M: 2 })]), null);

  // Exceeding per-size limit of 2 must fail
  assert(validateItems([row(4, ['S', 'M'], 'one', { S: 3, M: 1 })]));
  // 0 per size must fail
  assert(validateItems([row(2, ['S', 'M'], 'one', { S: 2, M: 0 })]));
  // Sum mismatch must fail
  assert(validateItems([row(4, ['S', 'M'], 'one', { S: 2, M: 1 })]));

  // Duplicate cart rows must not exceed 2 per size
  assert(validateItems([row(3, ['S', 'M'], 'one', { S: 2, M: 1 }), row(1, ['S'], 'one', { S: 1 })])); // S total = 3 -> reject
  assert.equal(validateItems([row(2, ['S', 'M'], 'one', { S: 1, M: 1 }), row(1, ['S'], 'one', { S: 1 })]), null); // S total = 2 -> allow
});

test('Hard Copy to Trial Sample synchronization and server-side strict matching', () => {
  const product = {
    available_sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    base_price: 399,
    physical_price: 299,
    trial_price: 125,
    pattern_options: { printable: true, physical: true, trial: true }
  };

  // Hard Copy S, M with Trial S: 2, M: 1 -> Total 3 -> Allowed
  const validSync = row(3, [], 'prod1', { S: 2, M: 1 }, ['S', 'M'], 2);
  assert.equal(patternOptions.validate(product, [], validSync), '');
  assert.equal(validateItems([validSync]), null);

  // Hard Copy S, M with injected extra size L -> Rejected
  const injectedSize = row(4, [], 'prod1', { S: 2, M: 1, L: 1 }, ['S', 'M'], 2);
  assert.equal(patternOptions.validate(product, [], injectedSize), 'Trial sample sizes must match selected Hard Copy sizes.');

  // Hard Copy S, M with missing size M -> Rejected
  const missingSize = row(2, [], 'prod1', { S: 2 }, ['S', 'M'], 2);
  assert.equal(patternOptions.validate(product, [], missingSize), 'Trial sample sizes must match selected Hard Copy sizes.');

  // Full configured range XS to 5XL: e.g. S=2, M=1, L=2 -> 5 samples across 3 sizes -> Valid
  const threeSizes = row(5, [], 'prod1', { S: 2, M: 1, L: 2 }, ['S', 'M', 'L'], 3);
  assert.equal(patternOptions.validate(product, [], threeSizes), '');
  assert.equal(validateItems([threeSizes]), null);
  const price = require('../services/orderPricing');
  assert.equal(price.itemPrice(product, [], [], threeSizes).trial, 625);

  // Independent Trial purchase without Hard Copy (physical_quantity = 0) -> Allowed
  const independentTrial = row(3, ['S', 'M'], 'prod1', { S: 2, M: 1 }, [], 0);
  assert.equal(patternOptions.validate(product, [], independentTrial), '');
  assert.equal(validateItems([independentTrial]), null);
});

test('Pricing preserves sample price and rejects invalid counts', () => {
  const price = require('../services/orderPricing'), p = { trial_price: 125, physical_price: 0 };
  assert.equal(price.itemPrice(p, [], [], row(4, ['S', 'M'])).total, 500);
  assert.equal(price.itemPrice(p, [], [], row(3, ['S', 'M'], 'one', { S: 2, M: 1 })).total, 375);
  for (const n of [3, 4]) assert.throws(() => price.itemPrice(p, [], [], row(n)), /Maximum 2/);
});
