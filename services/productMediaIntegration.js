"use strict";

const {
  publicMediaUrl
} = require("../middleware/productMediaUpload");

function mediaLink(value, kind = 'image') {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid media link');
  const url = new URL(value.trim());
  const extensions = kind === 'video' ? /\.(mp4|webm)$/i : kind === 'document' ? /\.pdf$/i : /\.(jpe?g|png|webp)$/i;
  if (url.protocol !== 'https:' || url.username || url.password || !extensions.test(url.pathname)) throw new Error('Use a direct HTTPS media file link');
  return url.href;
}

// Public photos come from validated uploads or owner-confirmed HTTPS links,
// never private document paths or legacy static artwork. Image content still
// requires owner review: a raster image can depict a technical diagram.
function publicGarmentMedia(product) {
  if (!product) return product;
  const p = typeof product.toObject === 'function' ? product.toObject() : product;
  const confirmed = new Set(p.finished_garment_images || []);
  const photo = value => { if (!confirmed.has(value)) return ''; try { return /^\/uploads\/products\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value) ? value : mediaLink(value); } catch { return ''; } };
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
  const chartImage = getFiles(files, 'size_chart_image_file')[0];
  let chartImageUrl = existingProduct.size_chart_image || '';
  if (chartImage) chartImageUrl = publicMediaUrl(chartImage);
  else if (body.size_chart_image) {
    chartImageUrl = /^\/(images|uploads)\/[a-z0-9_./-]+$/i.test(body.size_chart_image) && !body.size_chart_image.includes('..') ? body.size_chart_image : mediaLink(body.size_chart_image);
  }
  if (isChecked(body.remove_size_chart_image)) chartImageUrl = '';

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
  } else if (body.main_image_link) {
    mainImage = mediaLink(body.main_image_link);
  }

  let existingGallery = existingImages
    .slice(1)
    .filter((item, index) => !removeGallery.has(index));

  if (body.gallery_order) {
    const order = String(body.gallery_order).split(',').map(v => Number(v.trim()));
    const indexes = existingImages.slice(1).map((_, i) => i).filter(i => !removeGallery.has(i));
    if (order.length !== indexes.length || new Set(order).size !== order.length || order.some(i => !indexes.includes(i))) throw new Error('Gallery order must list each remaining image index once');
    existingGallery = order.map(i => existingImages[i + 1]);
  }
  const linkedGallery = String(body.gallery_image_links || '').split(/\r?\n/).filter(v => v.trim()).map(v => mediaLink(v));
  const newGallery = [...gallery.map(publicMediaUrl), ...linkedGallery];
  if (existingGallery.length + newGallery.length > 30) throw new Error('Maximum 30 gallery images');

  const images = [
    ...(mainImage ? [mainImage] : []),
    ...existingGallery,
    ...newGallery
  ];

  const sampleImage = sample
    ? publicMediaUrl(sample)
    : removeSample
      ? ""
      : body.sample_image_link ? mediaLink(body.sample_image_link) : existingProduct.sample_image_url || "";

  const videoUrl = video
    ? publicMediaUrl(video)
    : removeVideo
      ? ""
      : body.video_link ? mediaLink(body.video_link, 'video') : existingProduct.video_url || "";

  let sizeChartPdf = removeSizeChartPdf ? "" : (existingProduct.size_chart_pdf || "");
  let sizeChartPdfName = removeSizeChartPdf ? "" : (existingProduct.size_chart_pdf_name || "");
  if (sizeChartPdfFile) {
    sizeChartPdf = publicMediaUrl(sizeChartPdfFile);
    sizeChartPdfName = sizeChartPdfFile.originalname || sizeChartPdf.split('/').pop();
  }
  else if (body.size_chart_pdf_link) { sizeChartPdf = mediaLink(body.size_chart_pdf_link, 'document'); sizeChartPdfName = 'Public size chart'; }

  return {
    images,
    finished_garment_images: [...new Set([
      ...asStrings(existingProduct.finished_garment_images),
      ...[body.main_image_link && mainImage, body.sample_image_link && sampleImage, ...linkedGallery].filter(Boolean),
      ...[main, ...gallery, sample].filter(Boolean).map(publicMediaUrl)
    ])].filter(url => images.includes(url) || url === sampleImage),
    sample_image_url: sampleImage,
    video_url: videoUrl,
    size_chart_pdf: sizeChartPdf,
    size_chart_pdf_name: sizeChartPdfName,
    size_chart_image: chartImageUrl
  };
}

module.exports = {
  mediaLink,
  collectMediaUpdate,
  publicGarmentMedia
};
