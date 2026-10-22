"use strict";

const {
  publicMediaUrl
} = require("../middleware/productMediaUpload");

function getFiles(files, field) {
  return Array.isArray(files?.[field])
    ? files[field]
    : [];
}

function asStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    item => typeof item === "string" && item.trim()
  );
}

function isChecked(value) {
  return value === "on" ||
    value === "1" ||
    value === true;
}

function collectMediaUpdate(existingProduct, body = {}, files = {}) {
  const existingImages = asStrings(existingProduct.images);
  const main = getFiles(files, "main_image")[0];
  const gallery = getFiles(files, "gallery_images");
  const sample = getFiles(files, "sample_image")[0];
  const video = getFiles(files, "product_video")[0];

  const removeMain = isChecked(body.remove_main_image);
  const removeSample = isChecked(body.remove_sample_image);
  const removeVideo = isChecked(body.remove_video);

  const removeGallery = new Set(
    asStrings(
      Array.isArray(body.remove_gallery_image)
        ? body.remove_gallery_image
        : body.remove_gallery_image !== undefined
          ? [body.remove_gallery_image]
          : []
    ).filter(item => /^\d+$/.test(item))
      .map(item => Number(item))
      .filter(index => Number.isSafeInteger(index))
  );

  let mainImage = removeMain
    ? ""
    : existingImages[0] || "";

  if (main) {
    mainImage = publicMediaUrl(main);
  }

  const existingGallery = existingImages
    .slice(1)
    .filter((item, index) => !removeGallery.has(index));

  const newGallery = gallery.map(publicMediaUrl);

  const images = [
    ...(mainImage ? [mainImage] : []),
    ...existingGallery,
    ...newGallery
  ];

  const sampleImage = sample
    ? publicMediaUrl(sample)
    : removeSample
      ? ""
      : existingProduct.sample_image_url || "";

  const videoUrl = video
    ? publicMediaUrl(video)
    : removeVideo
      ? ""
      : existingProduct.video_url || "";

  return {
    images,
    sample_image_url: sampleImage,
    video_url: videoUrl
  };
}

module.exports = {
  collectMediaUpdate
};
