"use strict";

const {
  publicMediaUrl
} = require("../middleware/productMediaUpload");

function mediaLink(value, kind = 'image') {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid media link');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Invalid media link URL format');
  }
  const extensions = kind === 'video' ? /\.(mp4|webm)$/i : kind === 'document' ? /\.pdf$/i : /\.(jpe?g|png|webp)$/i;
  const hostname = url.hostname.toLowerCase();
  const searchOrWebEngine = /^(.*\.)?(google\.[a-z.]+|bing\.com|yahoo\.com|duckduckgo\.com|baidu\.com|yandex\.[a-z.]+|pinterest\.com|facebook\.com|instagram\.com)$/i;
  if (searchOrWebEngine.test(hostname)) {
    throw new Error('Search engine and webpage links are not direct image files. Use a direct HTTPS link ending in .jpg, .jpeg, .png, or .webp.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !extensions.test(url.pathname)) {
    throw new Error(kind === 'video' ? 'Use a direct HTTPS media file link ending in .mp4 or .webm' : kind === 'document' ? 'Use a direct HTTPS document link ending in .pdf' : 'Use a direct HTTPS image link ending in .jpg, .jpeg, .png, or .webp');
  }
  return url.href;
}

// Public photos come from validated uploads or owner-confirmed HTTPS links,
// never private document paths or legacy static artwork. Image content still
// requires owner review: a raster image can depict a technical diagram.
function publicGarmentMedia(product) {
  if (!product) return product;
  const p = typeof product.toObject === 'function' ? product.toObject() : product;
  const confirmed = new Set(p.finished_garment_images || []);
  const photo = value => {
    if (!value || typeof value !== 'string' || !confirmed.has(value)) return '';
    if (/^\/uploads\/products\/[a-f0-9-]{36}\.(jpe?g|png|webp)$/i.test(value)) return value;
    if (/^\/images\/[a-zA-Z0-9_./-]+\.(jpe?g|png|webp)$/i.test(value) && !value.includes('..')) return value;
    try {
      return mediaLink(value);
    } catch {
      return '';
    }
  };
  const images = Array.isArray(p.images) ? p.images : [];
  return { ...p, option_images: require('./optionIllustrations').resolve(p), images: [photo(images[0]), ...images.slice(1).map(photo).filter(Boolean)], sample_image_url: photo(p.sample_image_url) };
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
  const existingImages = Array.isArray(existingProduct.images) ? existingProduct.images : [];
  const main = getFiles(files, "main_image")[0];
  const gallery = getFiles(files, "gallery_images");
  const sample = getFiles(files, "sample_image")[0];
  const video = getFiles(files, "product_video")[0];
  const sizeChartPdfFile = getFiles(files, "size_chart_pdf_file")[0];
  const howToMeasurePdfFile = getFiles(files, "how_to_measure_pdf_file")[0];
  const chartImage = getFiles(files, 'size_chart_image_file')[0];
  let chartImageUrl = "";
  if (chartImage) {
    chartImageUrl = publicMediaUrl(chartImage);
  } else if (body.size_chart_image && body.size_chart_image.trim()) {
    chartImageUrl = /^\/(images|uploads)\/[a-z0-9_./-]+$/i.test(body.size_chart_image.trim()) && !body.size_chart_image.includes('..') ? body.size_chart_image.trim() : mediaLink(body.size_chart_image);
  } else if (!isChecked(body.remove_size_chart_image)) {
    chartImageUrl = existingProduct.size_chart_image || '';
  }

  const removeMain = isChecked(body.remove_main_image);
  const removeSample = isChecked(body.remove_sample_image);
  const removeVideo = isChecked(body.remove_video);
  const removeSizeChartPdf = isChecked(body.remove_size_chart_pdf);
  const removeHowToMeasurePdf = isChecked(body.remove_how_to_measure_pdf);

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

  let mainImage = "";
  if (main) {
    mainImage = publicMediaUrl(main);
  } else if (body.main_image_link && body.main_image_link.trim()) {
    mainImage = mediaLink(body.main_image_link);
  } else if (!removeMain) {
    mainImage = existingImages[0] || "";
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
  // Compare bytes as well as URLs: repeated uploads have fresh UUID filenames.
  // Only read validated local upload paths; remote links are never fetched here.
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { MEDIA_ROOT } = require('../middleware/productMediaUpload');
  const uploaded = new Map([main, ...gallery].filter(Boolean).map(file => [publicMediaUrl(file), file.path]));
  function identity(url) {
    if (!/^\/uploads\/products\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url)) return url;
    const filename = uploaded.get(url) || path.join(MEDIA_ROOT, path.basename(url));
    try { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
    catch (error) { if (error.code === 'ENOENT' || !filename) return url; throw error; }
  }
  const seen = new Set(mainImage ? [identity(mainImage)] : []);
  const uniqueGallery = [...existingGallery, ...newGallery].filter(url => {
    if (!url) return false;
    const key = identity(url);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (uniqueGallery.length > 30) throw new Error('Maximum 30 gallery images');
  // Keep the main slot empty when removed; never silently promote a gallery image.
  const images = mainImage || uniqueGallery.length ? [mainImage, ...uniqueGallery] : [];

  let sampleImage = "";
  if (sample) {
    sampleImage = publicMediaUrl(sample);
  } else if (body.sample_image_link && body.sample_image_link.trim()) {
    sampleImage = mediaLink(body.sample_image_link);
  } else if (!removeSample) {
    sampleImage = existingProduct.sample_image_url || "";
  }

  let videoUrl = "";
  if (video) {
    videoUrl = publicMediaUrl(video);
  } else if (body.video_link && body.video_link.trim()) {
    videoUrl = mediaLink(body.video_link, 'video');
  } else if (!removeVideo) {
    videoUrl = existingProduct.video_url || "";
  }

  let sizeChartPdf = "";
  let sizeChartPdfName = "";
  if (sizeChartPdfFile) {
    sizeChartPdf = publicMediaUrl(sizeChartPdfFile);
    sizeChartPdfName = sizeChartPdfFile.originalname || sizeChartPdf.split('/').pop();
  } else if (body.size_chart_pdf_link && body.size_chart_pdf_link.trim()) {
    sizeChartPdf = mediaLink(body.size_chart_pdf_link, 'document');
    sizeChartPdfName = 'Public size chart';
  } else if (!removeSizeChartPdf) {
    sizeChartPdf = existingProduct.size_chart_pdf || "";
    sizeChartPdfName = existingProduct.size_chart_pdf_name || "";
  }

  let howToMeasurePdf = "";
  let howToMeasurePdfName = "";
  if (howToMeasurePdfFile) {
    howToMeasurePdf = publicMediaUrl(howToMeasurePdfFile);
    howToMeasurePdfName = howToMeasurePdfFile.originalname || howToMeasurePdf.split('/').pop();
  } else if (body.how_to_measure_pdf_link && body.how_to_measure_pdf_link.trim()) {
    howToMeasurePdf = mediaLink(body.how_to_measure_pdf_link, 'document');
    howToMeasurePdfName = 'How to measure guide';
  } else if (!removeHowToMeasurePdf) {
    howToMeasurePdf = existingProduct.how_to_measure_pdf || "";
    howToMeasurePdfName = existingProduct.how_to_measure_pdf_name || "";
  }

  return {
    images,
    option_images: require('./optionIllustrations').collect(existingProduct, body, files),
    finished_garment_images: [...new Set([
      ...asStrings(existingProduct.finished_garment_images),
      ...[body.main_image_link && mainImage, body.sample_image_link && sampleImage, ...linkedGallery].filter(Boolean),
      ...[main, ...gallery, sample].filter(Boolean).map(publicMediaUrl)
    ])].filter(url => images.includes(url) || url === sampleImage),
    sample_image_url: sampleImage,
    video_url: videoUrl,
    size_chart_pdf: sizeChartPdf,
    size_chart_pdf_name: sizeChartPdfName,
    how_to_measure_pdf: howToMeasurePdf,
    how_to_measure_pdf_name: howToMeasurePdfName,
    size_chart_image: chartImageUrl
  };
}

module.exports = {
  mediaLink,
  collectMediaUpdate,
  publicGarmentMedia
};
