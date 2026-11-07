"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const seed = JSON.parse(
  fs.readFileSync("seeds/aep-original-11-products.json", "utf8")
);

assert.equal(seed.schema_version, 1);
assert.equal(seed.products.length, 11);

const ids = new Set();
const slugs = new Set();

for (const p of seed.products) {
  assert.match(p._id, /^[a-f0-9]{24}$/i);
  assert.equal(typeof p.name, "string");
  assert.ok(p.name.trim());
  assert.equal(typeof p.slug, "string");
  assert.ok(p.slug.trim());
  assert.equal(p.active, false);

  assert.ok(!ids.has(p._id), "Duplicate product ID");
  assert.ok(!slugs.has(p.slug), "Duplicate slug");

  ids.add(p._id);
  slugs.add(p.slug);
}

const forbidden = [
  "digital_file",
  "password",
  "password_hash",
  "api_key",
  "secret",
  "token",
  "mongodb_uri",
  "customer_email"
];

function validateSafe(value) {
  if (Array.isArray(value)) {
    value.forEach(validateSafe);
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(
        !forbidden.includes(key.toLowerCase()),
        "Forbidden field: " + key
      );
      validateSafe(entry);
    }
  }
}

validateSafe(seed);

console.log("PASS: Seed validation");
console.log("PRODUCTS:", seed.products.length);
console.log("ACTIVE:", seed.products.filter(p => p.active).length);
console.log("INACTIVE:", seed.products.filter(p => !p.active).length);

if (!process.argv.includes("--apply")) {
  console.log("DRY RUN PASS - NO DATABASE CONNECTION");
  console.log("Actual import requires separate owner approval.");
  process.exit(0);
}

if (process.env.AEP_SEED_IMPORT_APPROVED !== "YES_IMPORT_11") {
  throw new Error("Explicit import approval is required.");
}

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required.");
}

const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  try {
    const Product = require("../models/mongo/Product");
    let inserted = 0;
    let existing = 0;

    // Preflight entire import before any writes.
    const conflicts = [];

    for (const p of seed.products) {
      const byId = await Product.findById(p._id).lean();
      const bySlug = await Product.findOne({ slug: p.slug }).lean();

      if (byId || bySlug) {
        if (
          !byId ||
          !bySlug ||
          String(byId._id) !== p._id ||
          String(bySlug._id) !== p._id
        ) {
          conflicts.push(p.slug);
        } else {
          existing++;
        }
      }
    }

    if (conflicts.length) {
      throw new Error(
        "Import aborted due to ID/slug conflicts: " +
        conflicts.join(", ")
      );
    }

    for (const p of seed.products) {
      const result = await Product.updateOne(
        { _id: p._id },
        { $setOnInsert: p },
        { upsert: true, runValidators: true }
      );

      if (result.upsertedCount) inserted++;
    }

    console.log("IMPORT COMPLETE");
    console.log("NEW PRODUCTS:", inserted);
    console.log("ALREADY EXISTING:", existing);
    console.log("EXISTING PRODUCTS NOT OVERWRITTEN");
  } finally {
    await mongoose.disconnect();
  }
})().catch(error => {
  console.error("IMPORT FAILED:", error.message);
  process.exitCode = 1;
});
