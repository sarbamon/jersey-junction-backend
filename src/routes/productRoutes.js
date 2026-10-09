const express = require('express');
const Product = require('../models/Product');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Helper to sanitize product document for output
const formatProduct = (p) => {
  const doc = p.toObject ? p.toObject() : p;
  return {
    ...doc,
    id: doc._id.toString(),
    sizes: doc.sizes && doc.sizes.length ? doc.sizes : (doc.availableSizes || ['S', 'M', 'L', 'XL', '2XL']),
    availableSizes: doc.availableSizes && doc.availableSizes.length ? doc.availableSizes : (doc.sizes || ['S', 'M', 'L', 'XL', '2XL']),
  };
};

// @route   GET /api/products/admin/all
// @desc    Get all products for admin (including Draft / Out of Stock)
// @access  Private (Admin)
router.get('/admin/all', protect, authorize('admin'), async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    const formatted = products.map(formatProduct);
    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    next(err);
  }
});

// @route   GET /api/products
// @desc    Get active products for storefront (with optional search, sport, team filtering)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const { sport, team, category, search, sort, limit = 100, page = 1 } = req.query;

    let query = { status: { $ne: 'Draft' } };

    if (sport) {
      query.sport = sport;
    }

    if (category && category !== 'all') {
      query.$or = [
        { category: new RegExp(category, 'i') },
        { sport: new RegExp(category, 'i') },
      ];
    }

    if (team) {
      query.team = new RegExp(team, 'i');
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { team: searchRegex },
        { description: searchRegex },
        { category: searchRegex },
        { tags: searchRegex },
      ];
    }

    let reqQuery = Product.find(query);

    if (sort) {
      const sortBy = sort.split(',').join(' ');
      reqQuery = reqQuery.sort(sortBy);
    } else {
      reqQuery = reqQuery.sort({ createdAt: -1 });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const startIndex = (pageNum - 1) * limitNum;

    reqQuery = reqQuery.skip(startIndex).limit(limitNum);

    const products = await reqQuery;
    const total = await Product.countDocuments(query);
    const formatted = products.map(formatProduct);

    res.status(200).json({
      success: true,
      count: formatted.length,
      total,
      data: formatted,
    });
  } catch (err) {
    next(err);
  }
});

// @route   GET /api/products/:id
// @desc    Get single product by MongoDB _id or slug
// @access  Public
router.get('/:id', async (req, res, next) => {
  try {
    const isObjectId = req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const product = isObjectId
      ? await Product.findById(req.params.id)
      : await Product.findOne({ slug: req.params.id });

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.status(200).json({
      success: true,
      data: formatProduct(product),
    });
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/products
// @desc    Create new product
// @access  Private (Admin)
router.post('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const productData = { ...req.body };
    if (!productData.slug) {
      productData.slug = (productData.name || 'product')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '') + '-' + Date.now();
    }

    if (productData.sizes && !productData.availableSizes) {
      productData.availableSizes = productData.sizes;
    }

    const product = await Product.create(productData);
    res.status(201).json({
      success: true,
      data: formatProduct(product),
    });
  } catch (err) {
    next(err);
  }
});

// @route   PATCH /api/products/:id
// @desc    Update product
// @access  Private (Admin)
const updateProductHandler = async (req, res, next) => {
  try {
    const isObjectId = req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const query = isObjectId ? { _id: req.params.id } : { slug: req.params.id };

    const updateData = { ...req.body };
    if (updateData.sizes && !updateData.availableSizes) {
      updateData.availableSizes = updateData.sizes;
    }

    const product = await Product.findOneAndUpdate(query, updateData, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.status(200).json({
      success: true,
      data: formatProduct(product),
    });
  } catch (err) {
    next(err);
  }
};

router.patch('/:id', protect, authorize('admin'), updateProductHandler);
router.put('/:id', protect, authorize('admin'), updateProductHandler);

// @route   DELETE /api/products/:id
// @desc    Delete product
// @access  Private (Admin)
router.delete('/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const isObjectId = req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const query = isObjectId ? { _id: req.params.id } : { slug: req.params.id };

    const product = await Product.findOneAndDelete(query);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
