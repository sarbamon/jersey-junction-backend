const mongoose = require('mongoose');

const patchOptionSchema = new mongoose.Schema({
  id: String,
  name: String,
  price: Number,
  icon: String,
});

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add product name'],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    team: {
      type: String,
      default: '',
    },
    league: {
      type: String,
      default: '',
    },
    sport: {
      type: String,
      default: 'soccer',
    },
    category: {
      type: String,
      default: 'Soccer',
    },
    subcategory: {
      type: String,
      default: '',
    },
    season: {
      type: String,
      default: '2024/25',
    },
    price: {
      type: Number,
      required: [true, 'Please add price'],
    },
    originalPrice: {
      type: Number,
    },
    discount: {
      type: Number,
      default: 0,
    },
    stock: {
      type: Number,
      default: 50,
    },
    sku: {
      type: String,
      default: '',
    },
    brand: {
      type: String,
      default: '',
    },
    rating: {
      type: Number,
      default: 5.0,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    isNewProduct: {
      type: Boolean,
      default: false,
    },
    isBestseller: {
      type: Boolean,
      default: false,
    },
    isHot: {
      type: Boolean,
      default: false,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isCustomizable: {
      type: Boolean,
      default: false,
    },
    customizationPrice: {
      type: Number,
      default: 150,
    },
    status: {
      type: String,
      enum: ['Active', 'Draft', 'Out of Stock'],
      default: 'Active',
    },
    colors: mongoose.Schema.Types.Mixed,
    pattern: {
      type: String,
      default: 'solid',
    },
    sponsorText: String,
    crestIcon: String,
    availableSizes: {
      type: [String],
      default: ['S', 'M', 'L', 'XL', '2XL'],
    },
    sizes: {
      type: [String],
      default: ['S', 'M', 'L', 'XL', '2XL'],
    },
    sizeStock: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    defaultName: String,
    defaultNumber: String,
    description: {
      type: String,
      default: '',
    },
    shortDescription: {
      type: String,
      default: '',
    },
    details: [String],
    availablePatches: [patchOptionSchema],
    tags: [String],
    image: {
      type: String,
      default: '/placeholder-jersey.svg',
    },
    images: {
      type: [String],
      default: [],
    },
    createdDate: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    revenueGenerated: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Product', productSchema);
