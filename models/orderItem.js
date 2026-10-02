const { db } = require('../config/db');
const table = 'order_items';

function create(items) {
  return db(table).insert(items);
}

module.exports = { create };
