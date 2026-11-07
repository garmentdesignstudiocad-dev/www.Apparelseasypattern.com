'use strict';
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { serializeProducts } = require('./backupLocalProducts.cjs');
const { ObjectId, Decimal128, EJSON } = mongoose.mongo.BSON;
const product = {
  _id: new ObjectId(), slug: 'backup-fixture', active: false, status: 'draft',
  base_price: null, physical_price: 0, trial_price: 125.5,
  createdAt: new Date('2026-10-12T00:00:00Z'),
  nested: { id: new ObjectId(), precise: Decimal128.fromString('12.30') },
};
assert.throws(() => require('bson').EJSON.stringify(product), /Unsupported BSON version/);
const output = serializeProducts([product]);
assert.ok(output.includes('"$oid"'));
assert.ok(output.includes('"$date"'));
assert.deepEqual(EJSON.parse(output), [product]);
assert.equal(Object.hasOwn(EJSON.parse(output)[0], 'additional_size_price'), false);
console.log('PASS: original BSON mismatch reproduced; compatible backup preserves IDs, dates, nested BSON, prices, missing fields and publication state.');
