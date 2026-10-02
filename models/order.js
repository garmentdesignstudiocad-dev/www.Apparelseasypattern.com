const { db } = require('../config/db');
const table = 'orders';

function create(data) {
  return db(table).insert(data);
}

function findById(id) {
  return db(table).where({ id }).first();
}

module.exports = { create, findById };
