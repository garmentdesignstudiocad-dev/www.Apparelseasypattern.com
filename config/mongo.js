const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { logError } = require('../services/safeLog');

dotenv.config();

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGODB_URL ||
  process.env.MONGO_URL ||
  process.env.MONGO_URI;

if (!uri) {
  console.error('MONGODB_URI is missing in .env');
}

async function connect() {
  if (!uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const scheme = uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb';
    console.log(`MongoDB connection started (${scheme} URI).`);

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 5000,
    });

    console.log('MongoDB connected successfully.');

    return mongoose.connection;

  } catch (err) {

    logError('MongoDB connection failed:', err);

    throw err;
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected.');
});

mongoose.connection.on('error', (err) => {
  logError('MongoDB connection event error:', err);
});

function getMongoStatus() {

  if (!uri) {
    return 'unconfigured';
  }

  switch (mongoose.connection.readyState) {

    case 0:
      return 'disconnected';

    case 1:
      return 'connected';

    case 2:
      return 'connecting';

    case 3:
      return 'disconnecting';

    default:
      return 'unknown';
  }
}

module.exports = {
  mongoose,
  connect,
  getMongoStatus
};
