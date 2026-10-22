"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  signatureMatches,
  publicMediaUrl
} = require("../middleware/productMediaUpload");

test("JPEG signature accepted", () => {
  assert.equal(
    signatureMatches(Buffer.from("ffd8ffe00000", "hex"), "image/jpeg"),
    true
  );
});

test("PNG signature accepted", () => {
  assert.equal(
    signatureMatches(Buffer.from("89504e470d0a1a0a", "hex"), "image/png"),
    true
  );
});

test("Fake JPEG rejected", () => {
  assert.equal(
    signatureMatches(Buffer.from("not an actual image"), "image/jpeg"),
    false
  );
});

test("Fake MP4 rejected", () => {
  assert.equal(
    signatureMatches(Buffer.from("not an actual video"), "video/mp4"),
    false
  );
});

test("Valid stored media URL", () => {
  const file = {
    filename: "12345678-1234-1234-1234-123456789abc.jpg"
  };

  assert.equal(
    publicMediaUrl(file),
    "/uploads/products/" + file.filename
  );
});

test("Traversal filename rejected", () => {
  assert.throws(() => {
    publicMediaUrl({ filename: "../../private/paid.rar" });
  });
});
