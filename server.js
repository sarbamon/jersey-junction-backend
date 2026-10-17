const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const connectDB = require('./src/config/database');
const app = require('./src/app');

// Connect to database
connectDB();

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle unhandled promise rejections without crashing
process.on('unhandledRejection', (err) => {
  console.warn(`[Network/System Notice] ${err.message}. Server remains alive to retry.`);
});

process.on('uncaughtException', (err) => {
  console.warn(`[Uncaught Exception] ${err.message}.`);
});
