const { db } = require('../config/db');
const table = 'addons';

function findByProduct(productId) {
  return db.select('*').from(table).where({ product_id: productId, active: true });
}

module.exports = { findByProduct };
