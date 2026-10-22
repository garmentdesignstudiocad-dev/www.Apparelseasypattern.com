"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectMediaUpdate
} = require("../services/productMediaIntegration");

const existing = {
  images: [
    "https://example.com/main.jpg",
    "https://example.com/gallery.jpg"
  ],
  sample_image_url: "https://example.com/sample.jpg",
  video_url: "https://example.com/video.mp4"
};

const file = ext => ({
  filename:
    "12345678-1234-1234-1234-123456789abc." + ext
});

test("Saving without uploads preserves all media", () => {
  const result = collectMediaUpdate(existing);

  assert.deepEqual(result.images, existing.images);
  assert.equal(
    result.sample_image_url,
    existing.sample_image_url
  );
  assert.equal(result.video_url, existing.video_url);
});

test("Replacing main image preserves gallery", () => {
  const result = collectMediaUpdate(existing, {}, {
    main_image: [file("jpg")]
  });

  assert.equal(result.images.length, 2);
  assert.equal(
    result.images[1],
    existing.images[1]
  );
  assert.match(result.images[0], /^\/uploads\/products\//);
});

test("Gallery upload appends without erasing existing", () => {
  const result = collectMediaUpdate(existing, {}, {
    gallery_images: [file("png")]
  });

  assert.equal(result.images.length, 3);
  assert.equal(result.images[0], existing.images[0]);
  assert.equal(result.images[1], existing.images[1]);
});

test("Video replacement works", () => {
  const result = collectMediaUpdate(existing, {}, {
    product_video: [file("mp4")]
  });

  assert.match(
    result.video_url,
    /^\/uploads\/products\//
  );
});

test("Video removal only clears video reference", () => {
  const result = collectMediaUpdate(existing, {
    remove_video: "on"
  });

  assert.equal(result.video_url, "");
  assert.deepEqual(result.images, existing.images);
});

test("Sample removal preserves images", () => {
  const result = collectMediaUpdate(existing, {
    remove_sample_image: "on"
  });

  assert.equal(result.sample_image_url, "");
  assert.deepEqual(result.images, existing.images);
});

test("Gallery removal preserves main image", () => {
  const result = collectMediaUpdate(existing, {
    remove_gallery_image: ["0"]
  });

  assert.deepEqual(
    result.images,
    [existing.images[0]]
  );
});

test("Invalid uploaded filename rejected", () => {
  assert.throws(() => collectMediaUpdate(
    existing,
    {},
    {
      main_image: [{
        filename: "../../private/secret.pdf"
      }]
    }
  ));
});
