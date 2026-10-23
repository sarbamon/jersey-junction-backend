const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Please provide coupon code'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage',
    },
    discountValue: {
      type: Number,
      required: [true, 'Please provide discount value'],
      min: 0,
    },
    minOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiryDate: {
      type: String,
      default: '',
    },
    usageLimit: {
      type: Number,
      default: 1000,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Active', 'Expired', 'Disabled'],
      default: 'Active',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Coupon', couponSchema);
