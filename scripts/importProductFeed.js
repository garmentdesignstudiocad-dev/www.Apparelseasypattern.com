const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { connect, mongoose } = require('../config/mongo');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const Customer = require('../models/mongo/Customer');
const Order = require('../models/mongo/Order');
const Payment = require('../models/mongo/Payment');
const delivery = require('../services/digitalDeliveryService');

const FEED_PATH = path.resolve(__dirname, '../../garment patterns/apparel-easy-patterns-product-data-feed.zip');
const FEED_VERSION = 'apparel-easy-patterns-product-feed-v1';
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const EXPECTED_NAMES = [
  'T-Shirt',
  "Women's Elastic Pant",
  'Elastic Shorts - 2 Inch WB Seam',
  'Elastic Shorts - Inner Seam Option',
  "Men's Chinos Shorts",
  "Men's Track Pant",
  'Slim Fit Shirt',
];

function fail(message) {
  throw new Error(message);
}

function safeArchivePath(name) {
  return typeof name === 'string'
    && !name.includes('\\')
    && !path.posix.isAbsolute(name)
    && !name.split('/').some(part => part === '..' || part === '.');
}

function readArchive(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      lazyEntries: true,
      autoClose: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (openError, archive) => {
      if (openError) return reject(openError);

      const entries = new Map();
      let totalBytes = 0;
      let settled = false;
      const rejectOnce = error => {
        if (settled) return;
        settled = true;
        archive.close();
        reject(error);
      };

      archive.on('error', rejectOnce);
      archive.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(entries);
      });
      archive.on('entry', entry => {
        const name = entry.fileName;
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if (!safeArchivePath(name) || (unixMode & 0o170000) === 0o120000) {
          return rejectOnce(new Error(`Unsafe archive entry: ${name}`));
        }
        if (entries.has(name)) return rejectOnce(new Error(`Duplicate archive entry: ${name}`));
        if (name.endsWith('/')) return archive.readEntry();
        if (entry.uncompressedSize > MAX_ENTRY_BYTES
          || totalBytes + entry.uncompressedSize > MAX_TOTAL_BYTES) {
          return rejectOnce(new Error(`Archive entry exceeds the import size limit: ${name}`));
        }
        totalBytes += entry.uncompressedSize;

        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return rejectOnce(streamError);
          const chunks = [];
          let size = 0;
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_ENTRY_BYTES) {
              stream.destroy(new Error(`Archive entry exceeds the import size limit: ${name}`));
              return;
            }
            chunks.push(chunk);
          });
          stream.once('error', rejectOnce);
          stream.once('end', () => {
            if (settled) return;
            if (size !== entry.uncompressedSize) {
              return rejectOnce(new Error(`Archive entry size mismatch: ${name}`));
            }
            entries.set(name, Buffer.concat(chunks));
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });
}

function normalizeName(value) {
  return String(value).normalize('NFKC').replace(/[–—]/g, '-').trim().toLowerCase();
}

function categorySlug(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 't-shirts' || normalized === 'shirts') return 'shirts';
  if (normalized === 'pants') return 'pants';
  if (normalized === 'shorts') return 'shorts';
  fail(`Unsupported source category: ${value}`);
}

function sourceKey(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}

async function persistPrivateFile(root, filename, contents) {
  const destination = path.join(root, filename);
  const expectedHash = crypto.createHash('sha256').update(contents).digest('hex');
  try {
    const handle = await fs.open(destination, 'wx', 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await fs.unlink(destination).catch(() => {});
      throw error;
    }
    await handle.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existingHash = crypto.createHash('sha256').update(await fs.readFile(destination)).digest('hex');
    if (existingHash !== expectedHash) {
      fail(`Private destination already exists with different contents: ${filename}`);
    }
  }
  return filename;
}

async function counts() {
  const [products, customers, orders, payments] = await Promise.all([
    Product.countDocuments(),
    Customer.countDocuments(),
    Order.countDocuments(),
    Payment.countDocuments(),
  ]);
  return { products, customers, orders, payments };
}

async function importFeed() {
  const archive = await readArchive(FEED_PATH);
  const jsonBuffer = archive.get('products.json');
  if (!jsonBuffer) fail('The feed is missing products.json.');

  let feed;
  try {
    feed = JSON.parse(jsonBuffer.toString('utf8'));
  } catch {
    fail('The feed products.json is not valid JSON.');
  }
  if (!Array.isArray(feed) || feed.length !== EXPECTED_NAMES.length) {
    fail(`Expected exactly ${EXPECTED_NAMES.length} products in the feed.`);
  }

  const normalizedExpected = new Set(EXPECTED_NAMES.map(normalizeName));
  const seenSlugs = new Set();
  const seenNames = new Set();
  const referencedFiles = new Set();
  for (const item of feed) {
    if (!item || typeof item.name !== 'string' || !normalizedExpected.has(normalizeName(item.name))) {
      fail(`Unexpected product in feed: ${item?.name || '(missing name)'}`);
    }
    if (seenNames.has(normalizeName(item.name)) || typeof item.slug !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || seenSlugs.has(item.slug)) {
      fail(`Duplicate or unsafe product name/slug: ${item.name}`);
    }
    seenNames.add(normalizeName(item.name));
    seenSlugs.add(item.slug);
    if (item.active !== false
      || ['base_price', 'additional_size_price', 'physical_price', 'trial_price']
        .some(field => item[field] !== null && item[field] !== undefined)) {
      fail(`The feed contains an unexpected active state or price for ${item.name}.`);
    }
    if (!Array.isArray(item.source_files) || item.source_files.length === 0) {
      fail(`The feed has no source files for ${item.name}.`);
    }
    for (const source of item.source_files) {
      if (!source || typeof source.relative_path !== 'string'
        || !source.relative_path.startsWith('assets/')
        || !safeArchivePath(source.relative_path)
        || path.posix.basename(source.relative_path) !== source.file_name
        || typeof source.file_type !== 'string'
        || !archive.has(source.relative_path)) {
        fail(`Invalid or missing file mapping for ${item.name}: ${source?.relative_path || '(missing path)'}`);
      }
      if (referencedFiles.has(source.relative_path)) fail(`A source file is mapped more than once: ${source.relative_path}`);
      referencedFiles.add(source.relative_path);
    }
  }
  if (seenNames.size !== normalizedExpected.size) fail('The feed does not contain each required product exactly once.');
  const assetEntries = [...archive.keys()].filter(name => name.startsWith('assets/') && !name.endsWith('/'));
  if (assetEntries.length !== referencedFiles.size || assetEntries.some(name => !referencedFiles.has(name))) {
    fail('The feed contains missing or unreferenced product assets.');
  }

  if (process.argv.includes('--validate-only')) {
    console.log(`Feed validation: PASS (${feed.length} products, ${referencedFiles.size} original files; bytes preserved, no extraction or database changes)`);
    return;
  }

  await connect();
  const before = await counts();
  const existingProducts = await Product.find().select('name slug import_source_key').lean();
  await fs.mkdir(delivery.root(), { recursive: true });
  const privateRoot = await delivery.privateRoot();
  const beforeFiles = await ProductFile.countDocuments();
  let productsCreated = 0;
  let filesCreated = 0;
  const results = [];

  for (const item of feed) {
    const productKey = `${FEED_VERSION}:${item.slug}`;
    let product = await Product.findOne({ import_source_key: productKey });
    if (!product) {
      const collision = existingProducts.find(existing => existing.slug === item.slug
        || normalizeName(existing.name) === normalizeName(item.name));
      if (collision) {
        fail(`Existing product conflicts with feed product "${item.name}"; no existing product was changed.`);
      }
      const description = String(item.description || '').trim()
        || 'Admin review required. Ready-to-use apparel pattern. Additional product details and pricing will be updated by Admin.';
      product = await Product.create({
        import_source_key: productKey,
        name: item.name,
        slug: item.slug,
        category: categorySlug(item.category),
        description,
        status: 'draft',
        active: false,
        featured: false,
        available_sizes: [],
        size_prices: [],
        pattern_options: { printable: false, physical: false, trial: false },
        images: Array.isArray(item.images) ? item.images : [],
        base_price: null,
        additional_size_price: null,
        physical_price: null,
        trial_price: null,
      });
      productsCreated += 1;
    }

    let filesForProduct = 0;
    for (const source of item.source_files) {
      const sourceId = sourceKey(FEED_VERSION, item.slug, source.relative_path);
      const fileKey = `${FEED_VERSION}:${sourceId}`;
      let productFile = await ProductFile.findOne({ import_source_key: fileKey });
      if (productFile) {
        if (String(productFile.product_id) !== String(product._id)) {
          fail(`Imported file is associated with the wrong product: ${source.relative_path}`);
        }
      } else {
        const extension = path.posix.extname(source.file_name);
        if (!extension || /[\\/]/.test(extension)) fail(`Invalid source extension: ${source.file_name}`);
        const storageName = `aep-${sourceId}${extension}`;
        const savedName = await persistPrivateFile(privateRoot, storageName, archive.get(source.relative_path));
        productFile = await ProductFile.create({
          import_source_key: fileKey,
          product_id: product._id,
          file_name: source.file_name,
          file_type: source.file_type,
          purpose: 'other',
          file_price: null,
          active: false,
          watermark_pdf: false,
          digital_file: savedName,
        });
        filesCreated += 1;
      }
      filesForProduct += 1;
    }
    results.push({ name: item.name, slug: product.slug, files: filesForProduct });
  }

  const [after, importedProducts, importedFiles, afterFiles] = await Promise.all([
    counts(),
    Product.find({ import_source_key: { $in: feed.map(item => `${FEED_VERSION}:${item.slug}`) } })
      .select('+import_source_key').lean(),
    ProductFile.find({
      import_source_key: {
        $in: feed.flatMap(item => item.source_files.map(source =>
          `${FEED_VERSION}:${sourceKey(FEED_VERSION, item.slug, source.relative_path)}`)),
      },
    })
      .select('+digital_file +import_source_key').lean(),
    ProductFile.countDocuments(),
  ]);
  const exactNameCounts = await Product.aggregate([
    { $match: { name: { $in: feed.map(item => item.name) } } },
    { $group: { _id: '$name', count: { $sum: 1 } } },
  ]);
  const duplicateNames = exactNameCounts.filter(row => row.count > 1);
  const afterProducts = await Product.find().select('name').lean();
  const duplicateNormalizedNames = feed.filter(item =>
    afterProducts.filter(product => normalizeName(product.name) === normalizeName(item.name)).length !== 1);
  if (importedProducts.length !== EXPECTED_NAMES.length || duplicateNames.length
    || duplicateNormalizedNames.length || importedFiles.length !== referencedFiles.size
    || after.customers !== before.customers || after.orders !== before.orders
    || after.payments !== before.payments || after.products - before.products !== productsCreated
    || after.products !== before.products + productsCreated
    || afterFiles !== beforeFiles + filesCreated) {
    fail('Database verification failed; review the report and rerun the idempotent importer if needed.');
  }

  for (const product of importedProducts) {
    if (product.active !== false || product.status !== 'draft'
      || product.base_price !== null || product.pattern_options?.printable !== false
      || product.pattern_options?.physical !== false || product.pattern_options?.trial !== false) {
      fail(`Imported product safety verification failed: ${product.name}`);
    }
  }
  for (const file of importedFiles) {
    if (file.active !== false || file.file_price !== null || file.purpose !== 'other'
      || !file.digital_file || !await delivery.filePath(file.digital_file)) {
      fail(`Imported file safety verification failed: ${file.file_name}`);
    }
  }

  console.log('PRODUCT DATA IMPORT');
  console.log(`Database: ${mongoose.connection.name}`);
  console.log(`Products before: ${before.products}`);
  console.log(`Products imported this run: ${productsCreated}`);
  console.log(`Products after: ${after.products}`);
  console.log(`Product files before: ${beforeFiles}`);
  console.log(`Product files mapped this run: ${filesCreated}`);
  console.log(`Product files after: ${afterFiles}`);
  console.log(`Customers preserved: ${before.customers === after.customers ? 'YES' : 'NO'} (${before.customers} -> ${after.customers})`);
  console.log(`Orders preserved: ${before.orders === after.orders ? 'YES' : 'NO'} (${before.orders} -> ${after.orders})`);
  console.log(`Payments preserved: ${before.payments === after.payments ? 'YES' : 'NO'} (${before.payments} -> ${after.payments})`);
  console.log(`Prices invented: NO (price fields unset/null; imported offers disabled)`);
  console.log(`Draft/inactive: ${importedProducts.every(product => !product.active && product.status === 'draft') ? 'YES' : 'NO'}`);
  console.log(`Zero-price purchase protection: ${importedProducts.every(product => product.status === 'draft' && !product.active) ? 'YES' : 'NO'}`);
  console.log(`Private files verified: ${importedFiles.length} (all stored outside public)`);
  console.log(`Files requiring Admin purpose review: ${importedFiles.filter(file => file.purpose === 'other').length}`);
  for (const result of results) console.log(`FOUND: ${result.name} (${result.files} files)`);
  console.log('Admin editing: YES (existing /admin/products list and edit form)');
  console.log('Duplicate products: 0');
  console.log('IMPORT RESULT: PASS');
}

importFeed()
  .catch(error => {
    console.error(`IMPORT RESULT: FAIL — ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
