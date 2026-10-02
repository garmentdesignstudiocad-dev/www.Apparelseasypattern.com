const { db } = require('../config/db');
const table = 'product_files';

function findByProduct(productId) {
  return db.select('*').from(table).where({ product_id: productId, active: true });
}

module.exports = { findByProduct };
