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
      default: 'https://res.cloudinary.com/mcsohx4p/image/upload/v1792689801/jerseyjunction_uploads/q6fb9r25vwafcwkfhdca.jpg',
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

module.exports = mongoose.model('Category', categorySchema);
