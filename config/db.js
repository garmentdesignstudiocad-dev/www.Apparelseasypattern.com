const { logError } = require('../services/safeLog');
const knex = require('knex');
const knexfile = require('../knexfile');

const env = process.env.NODE_ENV || 'development';
const config = knexfile[env];

const db = knex(config);

// Basic connection check
async function testConnection() {
  try {
    await db.raw('SELECT 1 as result');
    return true;
  } catch (err) {
    logError('Database connection error:', err);
    return false;
  }
}

module.exports = { db, testConnection };
