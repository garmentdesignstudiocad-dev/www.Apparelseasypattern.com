const { db } = require('../config/db');

const table = 'products';

function findAll() {
  return db.select('*').from(table).where('active', true);
}

function findById(id) {
  return db(table).where({ id }).first();
}

function create(data) {
  return db(table).insert(data);
}

module.exports = { findAll, findById, create };
