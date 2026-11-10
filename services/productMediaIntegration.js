"use strict";

const {
  publicMediaUrl
} = require("../middleware/productMediaUpload");

// Public photos come only from the validated image upload store, never private
// document paths, legacy static artwork or remote URLs. Image content still
// requires owner review: a raster image can depict a technical diagram.
function publicGarmentMedia(product) {
  if (!product) return product;
  const p = typeof product.toObject === 'function' ? product.toObject() : product;
  const confirmed = new Set(p.finished_garment_images || []);
  const photo = value => confirmed.has(value) && typeof value === 'string' && /^\/uploads\/products\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value) ? value : '';
  const images = Array.isArray(p.images) ? p.images : [];
  return { ...p, images: [photo(images[0]), ...images.slice(1).map(photo).filter(Boolean)], sample_image_url: photo(p.sample_image_url) };
}

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
  const sizeChartPdfFile = getFiles(files, "size_chart_pdf_file")[0];

  const removeMain = isChecked(body.remove_main_image);
  const removeSample = isChecked(body.remove_sample_image);
  const removeVideo = isChecked(body.remove_video);
  const removeSizeChartPdf = isChecked(body.remove_size_chart_pdf);

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

  let sizeChartPdf = removeSizeChartPdf ? "" : (existingProduct.size_chart_pdf || "");
  let sizeChartPdfName = removeSizeChartPdf ? "" : (existingProduct.size_chart_pdf_name || "");
  if (sizeChartPdfFile) {
    sizeChartPdf = publicMediaUrl(sizeChartPdfFile);
    sizeChartPdfName = sizeChartPdfFile.originalname || sizeChartPdf.split('/').pop();
  }

  return {
    images,
    finished_garment_images: [...new Set([
      ...asStrings(existingProduct.finished_garment_images),
      ...[main, ...gallery, sample].filter(Boolean).map(publicMediaUrl)
    ])].filter(url => images.includes(url) || url === sampleImage),
    sample_image_url: sampleImage,
    video_url: videoUrl,
    size_chart_pdf: sizeChartPdf,
    size_chart_pdf_name: sizeChartPdfName
  };
}

module.exports = {
  collectMediaUpdate,
  publicGarmentMedia
};
