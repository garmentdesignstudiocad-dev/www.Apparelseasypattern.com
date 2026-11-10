"use strict";

const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");

const PUBLIC_ROOT = path.resolve(__dirname, "../public");
const ISOLATED_MEDIA_TEST = process.env.AEP_ISOLATED_MEDIA_TEST === "1"; const MEDIA_TEST_ID = process.env.AEP_MEDIA_TEST_ID || ""; if (ISOLATED_MEDIA_TEST && !/^[a-z0-9_-]{8,50}$/.test(MEDIA_TEST_ID)) throw new Error("Invalid isolated media test ID"); const ISOLATED_MEDIA_ROOT = path.resolve(__dirname, "../private/verification/isolated-media", MEDIA_TEST_ID); const MEDIA_ROOT = ISOLATED_MEDIA_TEST ? path.join(ISOLATED_MEDIA_ROOT, "published") : path.join(PUBLIC_ROOT, "uploads", "products");
const STAGING_ROOT = ISOLATED_MEDIA_TEST ? path.join(ISOLATED_MEDIA_ROOT, "staging") : path.resolve(__dirname, "../private/media-upload-staging");

const allowed = {
  "image/jpeg": { ext: ".jpg", kind: "image" },
  "image/png": { ext: ".png", kind: "image" },
  "image/webp": { ext: ".webp", kind: "image" },
  "video/mp4": { ext: ".mp4", kind: "video" },
  "video/webm": { ext: ".webm", kind: "video" },
  "application/pdf": { ext: ".pdf", kind: "document" }
};

const limits = {
  fieldSize: 1024 * 1024,
  fileSize: 100 * 1024 * 1024,
  files: 14,
  fields: 150,
  parts: 170
};

function signatureMatches(buffer, mime) {
  if (mime === "image/jpeg") {
    return buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  }

  if (mime === "image/png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from("89504e470d0a1a0a", "hex")
    );
  }

  if (mime === "image/webp") {
    return buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }

  if (mime === "video/mp4") {
    return buffer.toString("ascii", 4, 8) === "ftyp";
  }

  if (mime === "application/pdf") {
    return buffer.length >= 4 &&
      buffer.subarray(0, 4).toString("ascii") === "%PDF";
  }

  if (mime === "video/webm") {
    return buffer.subarray(0, 4).equals(
      Buffer.from("1a45dfa3", "hex")
    );
  }

  return false;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdir(STAGING_ROOT, { recursive: true }, err => {
      cb(err, STAGING_ROOT);
    });
  },

  filename(req, file, cb) {
    const config = allowed[file.mimetype];
    if (!config) {
      return cb(new Error("Unsupported media type"));
    }

    cb(null, crypto.randomUUID() + config.ext);
  }
});

const upload = multer({
  storage,
  limits,
  fileFilter(req, file, cb) {
    const config = allowed[file.mimetype];
    if (!config) {
      return cb(new Error("Only JPEG, PNG, WebP, MP4 and WebM allowed"));
    }

    const extension = path.extname(file.originalname || '').toLowerCase();
    const extensions = file.mimetype === 'image/jpeg' ? ['.jpg', '.jpeg'] : [config.ext];
    if (!extensions.includes(extension)) return cb(new Error('File extension does not match its media type'));

    const isVideoField = file.fieldname === "product_video";
    const isDocField = file.fieldname === "size_chart_pdf_file";

    if (isVideoField && config.kind !== "video") {
      return cb(new Error("Video field requires MP4 or WebM"));
    }

    if (isDocField && config.kind !== "document") {
      return cb(new Error("Size chart requires a PDF document"));
    }

    if (!isVideoField && !isDocField && config.kind !== "image") {
      return cb(new Error("Image field requires an image"));
    }

    cb(null, true);
  }
});

const fields = upload.fields([
  { name: "main_image", maxCount: 1 },
  { name: "gallery_images", maxCount: 10 },
  { name: "sample_image", maxCount: 1 },
  { name: "product_video", maxCount: 1 },
  { name: "size_chart_pdf_file", maxCount: 1 }
]);

function flattenFiles(req) {
  return Object.values(req.files || {}).flat();
}

async function deleteUploadedFiles(req) {
  for (const file of flattenFiles(req)) {
    if (file && file.path &&
        [MEDIA_ROOT, STAGING_ROOT].some(root => path.resolve(file.path).startsWith(root + path.sep))) {
      await fsp.unlink(file.path).catch(() => {});
    }
  }
}

function uploadProductMedia(req, res, next) {
  fields(req, res, async err => {
    if (err) {
      await deleteUploadedFiles(req);
      return next(err);
    }

    next();
  });
}

async function validateProductMedia(req, res, next) {
  try {
    for (const file of flattenFiles(req)) {
      const handle = await fsp.open(file.path, "r");
      let buffer;

      try {
        buffer = Buffer.alloc(32);
        const result = await handle.read(buffer, 0, 32, 0);
        buffer = buffer.subarray(0, result.bytesRead);
      } finally {
        await handle.close();
      }

      const config = allowed[file.mimetype];
      const maxBytes = config.kind === "video"
        ? 100 * 1024 * 1024
        : 10 * 1024 * 1024;

      if (file.size > maxBytes ||
          !signatureMatches(buffer, file.mimetype)) {
        throw new Error("Invalid uploaded media content or size");
      }
    }

    next();
  } catch (err) {
    await deleteUploadedFiles(req);
    next(err);
  }
}

function publicMediaUrl(file) {
  if (!file || !file.filename ||
      !/^[a-f0-9-]{36}\.(jpg|png|webp|mp4|webm|pdf)$/.test(file.filename)) {
    throw new Error("Invalid stored media filename");
  }

  return "/uploads/products/" + file.filename;
}

async function publishProductMedia(req) {
  if (!flattenFiles(req).length) return;
  await fsp.mkdir(MEDIA_ROOT, { recursive: true });
  for (const file of flattenFiles(req)) {
    publicMediaUrl(file);
    const destination = path.join(MEDIA_ROOT, file.filename);
    await fsp.rename(file.path, destination);
    file.path = destination;
  }
}

module.exports = {
  uploadProductMedia,
  validateProductMedia,
  publicMediaUrl,
  deleteUploadedFiles,
  publishProductMedia,
  signatureMatches,
  MEDIA_ROOT
};
