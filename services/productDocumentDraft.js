const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const delivery = require('./digitalDeliveryService');
const validation = require('./digitalUploadValidation');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');

async function stage(productId, body, file) {
  const product = await Product.findById(productId).select('+editor_draft +editor_documents');
  if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
  const format = String(body.format || ''), pattern = body.purpose === 'pattern';
  const size = String(body.size || '');
  let ext;
  if (pattern) {
    if (!['dxf','hpgl','plt','pdf'].includes(format) || !(product.editor_draft?.available_sizes || product.available_sizes).includes(size)) throw Object.assign(new Error('Choose a saved draft size and format.'), { status: 400 });
    ext = validation.validate(file.originalname, file.buffer, format, file.mimetype, 30 * 1024 * 1024);
  } else if (validation.COMPANION_SLOTS.has(format)) ext = await validation.validateCompanion(file.originalname, file.buffer, format, file.mimetype);
  else if (format === 'measurement') ext = await validation.validateMeasurement(file.originalname, file.buffer, file.mimetype);
  else if (['techpack','marker'].includes(format)) ext = validation.validate(file.originalname, file.buffer, format, file.mimetype);
  else throw Object.assign(new Error('Choose a supported document slot.'), { status: 400 });
  await fs.mkdir(delivery.root(), { recursive: true });
  const name = crypto.randomBytes(24).toString('hex') + ext;
  const destination = path.join(await delivery.privateRoot(), name);
  await fs.writeFile(destination, file.buffer, { flag: 'wx', mode: 0o600 });
  const entry = { id: crypto.randomBytes(12).toString('hex'), format, size: pattern ? size : '', pattern, file: name, original_name: file.originalname, file_type: ext.slice(1) };
  try {
    // Atomic slot replacement avoids losing another upload submitted concurrently.
    await Product.updateOne({ _id: productId }, [{ $set: { editor_documents: { $concatArrays: [
      { $filter: { input: { $ifNull: ['$editor_documents', []] }, as: 'entry', cond: { $not: [{ $and: [{ $eq: ['$$entry.format', { $literal: format }] }, { $eq: ['$$entry.size', { $literal: entry.size }] }] }] } } },
      { $literal: [entry] }
    ] } } }]);
  } catch (error) { await fs.unlink(destination).catch(() => {}); throw error; }
  return { success: true, staged: true, mapped: pattern, format, size, fileId: entry.id, fileName: entry.original_name, fileType: entry.file_type, badgeText: 'DRAFT / ' + format.toUpperCase(), badgeClass: 'file-badge--pdf' };
}

async function publish(product) {
  for (const entry of product.editor_documents || []) {
    if (!await delivery.filePath(entry.file)) throw new Error('A draft document is missing. Upload it again before publishing.');
  }
  for (const entry of product.editor_documents || []) {
    if (entry.pattern) {
      product.digital_file_map = [...(product.digital_file_map || []).filter(item => item.format !== entry.format || item.size !== entry.size), { format: entry.format, size: entry.size, file: entry.file, original_name: entry.original_name }];
    } else {
      const purpose = entry.format === 'techpack' ? 'tech_pack' : 'specs';
      await ProductFile.findOneAndUpdate({ product_id: product._id, upload_slot: entry.format }, {
        $set: { file_name: entry.original_name, file_type: entry.file_type, purpose, digital_file: entry.file, active: true },
        $setOnInsert: { file_price: purpose === 'tech_pack' ? Number(product.tech_pack_price || 0) : 0 }
      }, { upsert: true, runValidators: true });
    }
  }
  product.editor_documents = undefined;
}
module.exports = { stage, publish };
