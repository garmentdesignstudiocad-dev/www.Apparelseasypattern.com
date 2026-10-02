const { db } = require('../config/db');
const table = 'customers';

function create(data) {
  return db(table).insert(data);
}

function findById(id) {
  return db(table).where({ id }).first();
}

function findByEmail(email) {
  return db(table).where({ email }).first();
}

module.exports = { create, findById, findByEmail };
