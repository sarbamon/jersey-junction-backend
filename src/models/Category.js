const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add category name'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    tag: {
      type: String,
      default: 'Sport Collection',
    },
    image: {
      type: String,
      default: '/jersey/WhatsApp Image 2026-09-08 at 11.44.00 PM.jpeg',
    },
    status: {
      type: String,
      enum: ['Active', 'Disabled'],
      default: 'Active',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Category', categorySchema);
