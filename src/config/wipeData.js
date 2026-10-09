require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');

async function wipeDatabase() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/jersey-junction';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB Atlas...');

    const prodRes = await Product.deleteMany({});
    console.log(`Deleted ${prodRes.deletedCount} demo products from MongoDB.`);

    const orderRes = await Order.deleteMany({});
    console.log(`Deleted ${orderRes.deletedCount} demo orders from MongoDB.`);

    console.log('Database successfully wiped! Zero demo data remaining.');
    process.exit(0);
  } catch (err) {
    console.error('Error wiping database:', err);
    process.exit(1);
  }
}

wipeDatabase();
