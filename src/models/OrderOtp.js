const mongoose = require('mongoose');

const orderOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      default: 'order_confirmation',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 600, // MongoDB TTL: document will automatically expire after 10 minutes (600 seconds)
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('OrderOtp', orderOtpSchema);

