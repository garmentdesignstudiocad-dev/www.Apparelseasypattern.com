const { db } = require('../config/db');
const table = 'payments';

function create(data) {
  return db(table).insert(data);
}

module.exports = { create };
