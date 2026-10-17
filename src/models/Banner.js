const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: 'Hero Banner',
      trim: true,
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
    },
    imageUrl: {
      type: String,
      required: [true, 'Please provide banner image URL'],
    },
    buttonText: {
      type: String,
      default: 'SHOP NOW',
      trim: true,
    },
    buttonLink: {
      type: String,
      default: '/shop',
      trim: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Disabled'],
      default: 'Active',
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Banner', bannerSchema);
