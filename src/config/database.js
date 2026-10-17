const mongoose = require('mongoose');
const seedData = require('./seed');

let isConnecting = false;
let retryTimer = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1 || isConnecting) return;

  isConnecting = true;
  try {
    const rawUri = process.env.MONGODB_URI || '';
    if (!rawUri) {
      console.warn('MONGODB_URI is not set in environment.');
      isConnecting = false;
      return;
    }

    const uri = rawUri.includes('?') 
      ? rawUri 
      : `${rawUri.replace(/\/+$/, '')}/?retryWrites=true&w=majority`;

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
    });

    console.log(`MongoDB Connected: ${conn.connection.host} / Database: ${conn.connection.db.databaseName}`);
    isConnecting = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    await seedData();
  } catch (error) {
    isConnecting = false;
    console.error(`Database Connection Error (${error.message}). Auto-retrying connection in 4s...`);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connectDB, 4000);
  }
};

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection notice:', err.message);
  if (mongoose.connection.readyState !== 1 && !isConnecting) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connectDB, 4000);
  }
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected! Auto-reconnecting in 3s...');
  if (mongoose.connection.readyState !== 1 && !isConnecting) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connectDB, 3000);
  }
});

module.exports = connectDB;