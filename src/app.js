const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');

// Route files
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const icarryRoutes = require('./routes/icarryRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const couponRoutes = require('./routes/couponRoutes');
const employeeRoutes = require('./routes/employeeRoutes');

const app = express();

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// Serve local static uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.use('/upload/disk', express.static(path.join(__dirname, '../public/uploads')));

// Enable CORS
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://jerseyjunction.shop',
  'https://www.jerseyjunction.shop',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, postman)
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      callback(null, true);
    },
    credentials: true,
  })
);

// Rate limiting (generous for active store browsing and multiple concurrent users)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 2000,
});
app.use('/api', limiter);

// Body parser (preserve rawBody for webhook signature verification)
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Cookie parser
app.use(cookieParser());

const mongoose = require('mongoose');

// Root landing endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Jersey Junction API Server is active and operational.',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      products: '/api/products',
      orders: '/api/orders',
      categories: '/api/categories',
      banners: '/api/banners',
      settings: '/api/settings',
    },
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Jersey Junction API v1',
  });
});

// Health check endpoint with database diagnostics
app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  res.status(200).json({
    status: 'OK',
    message: 'Jersey Junction API is running',
    database: {
      status: dbState,
      hasUri: Boolean(process.env.MONGODB_URI),
      dbName: mongoose.connection.db ? mongoose.connection.db.databaseName : null,
    },
  });
});

// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/upload', uploadRoutes);
app.use('/api/icarry', icarryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/employees', employeeRoutes);

// Error handler middleware
app.use(errorHandler);

module.exports = app;
