const express = require('express');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// In-memory product caches for instant 0ms responses
let cachedStorefrontProducts = null;
let cachedStorefrontTotal = 0;
let cachedStorefrontTime = 0;
const STOREFRONT_CACHE_TTL = 30 * 1000; // 30 seconds

let cachedAdminProducts = null;
let cachedAdminProductsTime = 0;
const ADMIN_CACHE_TTL = 30 * 1000; // 30 seconds

function invalidateProductCache() {
  cachedStorefrontProducts = null;
  cachedStorefrontTotal = 0;
  cachedAdminProducts = null;
  setTimeout(prewarmProducts, 100);
}

// Helper to sanitize product document for output
const formatProduct = (p) => {
  const doc = p.toObject ? p.toObject() : p;
  return {
    ...doc,
    id: doc._id ? doc._id.toString() : (doc.id || ''),
    sizes: doc.sizes && doc.sizes.length ? doc.sizes : (doc.availableSizes || ['S', 'M', 'L', 'XL', '2XL']),
    availableSizes: doc.availableSizes && doc.availableSizes.length ? doc.availableSizes : (doc.sizes || ['S', 'M', 'L', 'XL', '2XL']),
    sizeStock: doc.sizeStock || {},
    isCustomizable: Boolean(doc.isCustomizable),
  };
};

// Pre-warm storefront and admin products cache immediately
const prewarmProducts = async () => {
  try {
    const [adminProds, storefrontProds, total] = await Promise.all([
      Product.find().sort({ createdAt: -1 }).lean(),
      Product.find({ status: { $ne: 'Draft' } }).sort({ createdAt: -1 }).limit(1000).lean(),
      Product.countDocuments({ status: { $ne: 'Draft' } }),
    ]);
    cachedAdminProducts = adminProds.map(formatProduct);
    cachedAdminProductsTime = Date.now();

    cachedStorefrontProducts = storefrontProds.map(formatProduct);
    cachedStorefrontTotal = total;
    cachedStorefrontTime = Date.now();
    console.log(`Prewarmed ${cachedStorefrontProducts.length} storefront & ${cachedAdminProducts.length} admin products in memory.`);
  } catch (err) {
    console.warn('Prewarm products deferred:', err.message);
  }
};
setTimeout(prewarmProducts, 500);

// @route   GET /api/products/admin/all
// @desc    Get all products for admin (instant 0ms response via SWR cache)
// @access  Public / Admin
router.get('/admin/all', async (req, res, next) => {
  try {
    // If cached products exist, return immediately in 0ms and revalidate in background if older than 30s
    if (cachedAdminProducts && cachedAdminProducts.length > 0) {
      if (Date.now() - cachedAdminProductsTime > 30000) {
        Product.find().sort({ createdAt: -1 }).lean().then((products) => {
          cachedAdminProducts = products.map(formatProduct);
          cachedAdminProductsTime = Date.now();
        }).catch(() => {});
      }

      res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
      return res.status(200).json({
        success: true,
        count: cachedAdminProducts.length,
        data: cachedAdminProducts,
        cached: true,
      });
    }

    // Cold start fetch
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    const formatted = products.map(formatProduct);
    cachedAdminProducts = formatted;
    cachedAdminProductsTime = Date.now();

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    if (cachedAdminProducts && cachedAdminProducts.length > 0) {
      return res.status(200).json({
        success: true,
        count: cachedAdminProducts.length,
        data: cachedAdminProducts,
        fallback: true,
      });
    }
    next(err);
  }
});

// @route   GET /api/products
// @desc    Get active products for storefront (with optional search, sport, team filtering)
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    const { sport, team, category, search, sort, limit = 1000, page = 1 } = req.query;
    const isDefaultStorefrontQuery = !sport && !team && (!category || category === 'all') && !search && !sort && Number(page) === 1;

    // SWR Cache Strategy: If default storefront query and cache exists, return INSTANTLY in 0ms!
    if (isDefaultStorefrontQuery && cachedStorefrontProducts && cachedStorefrontProducts.length > 0) {
      // Revalidate in background if older than 30s
      if (Date.now() - cachedStorefrontTime > STOREFRONT_CACHE_TTL) {
        Product.find({ status: { $ne: 'Draft' } })
          .sort({ createdAt: -1 })
          .limit(1000)
          .lean()
          .then(async (products) => {
            const total = await Product.countDocuments({ status: { $ne: 'Draft' } });
            cachedStorefrontProducts = products.map(formatProduct);
            cachedStorefrontTotal = total;
            cachedStorefrontTime = Date.now();
          })
          .catch(() => {});
      }

      res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
      return res.status(200).json({
        success: true,
        count: cachedStorefrontProducts.length,
        total: cachedStorefrontTotal,
        data: cachedStorefrontProducts,
        cached: true,
      });
    }

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

    let reqQuery = Product.find(query).lean();

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

    const [products, total] = await Promise.all([
      reqQuery,
      Product.countDocuments(query),
    ]);
    const formatted = products.map(formatProduct);

    if (isDefaultStorefrontQuery) {
      cachedStorefrontProducts = formatted;
      cachedStorefrontTotal = total;
      cachedStorefrontTime = Date.now();
    }

    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
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
      ? await Product.findById(req.params.id).lean()
      : await Product.findOne({ slug: req.params.id }).lean();

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const formatted = formatProduct(product);

    // Compute live sales telemetry only when requested (e.g., admin dashboard)
    if (req.query.telemetry === 'true') {
      try {
        const orders = await Order.find({ orderStatus: { $ne: 'Cancelled' } }).lean();
        let liveSold = 0;
        let liveRevenue = 0;
        const prodIdStr = product._id.toString();
        const prodSlug = (product.slug || '').toLowerCase();
        const prodName = (product.name || '').toLowerCase().trim();

        orders.forEach(o => {
          if (Array.isArray(o.items)) {
            o.items.forEach(item => {
              const itemProdId = (item.productId || '').toString().toLowerCase();
              const itemName = (item.name || '').toLowerCase().trim();
              if (itemProdId === prodIdStr || itemProdId === prodSlug || itemName === prodName) {
                const qty = Number(item.quantity) || 1;
                const unitP = Number(item.unitPrice) || product.price || 0;
                liveSold += qty;
                liveRevenue += (qty * unitP);
              }
            });
          }
        });

        formatted.totalSold = Math.max(Number(product.totalSold) || 0, liveSold);
        formatted.revenueGenerated = Math.max(Number(product.revenueGenerated) || 0, liveRevenue);
      } catch (calcErr) {
        console.error('Error computing live product sales:', calcErr);
      }
    }

    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.status(200).json({
      success: true,
      data: formatted,
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
    invalidateProductCache();
    const productData = { ...req.body };
    if (!productData.slug) {
      productData.slug = (productData.name || 'product')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '') + '-' + Date.now();
    }

    if (productData.category) {
      const catLower = productData.category.toLowerCase().trim();
      if (catLower.includes('fan')) {
        productData.category = 'Fan Version';
        productData.sport = 'fan version';
      } else if (catLower.includes('player')) {
        productData.category = 'Player Version';
        productData.sport = 'player version';
      } else {
        productData.sport = catLower;
      }
    }

    if (productData.sizes && !productData.availableSizes) {
      productData.availableSizes = productData.sizes;
    }

    if (productData.sizeStock && typeof productData.sizeStock === 'object' && Object.keys(productData.sizeStock).length > 0) {
      const stockSum = Object.values(productData.sizeStock).reduce((sum, val) => sum + (Number(val) || 0), 0);
      productData.stock = stockSum;
      const inStockSizes = Object.entries(productData.sizeStock)
        .filter(([_, qty]) => Number(qty) > 0)
        .map(([size]) => size);
      if (inStockSizes.length > 0) {
        productData.availableSizes = inStockSizes;
        productData.sizes = inStockSizes;
      }
    } else if (Number(productData.stock) > 0) {
      // If total stock was provided without size breakdown, default standard sizes
      const baseSizes = productData.sizes && productData.sizes.length ? productData.sizes : ['S', 'M', 'L', 'XL'];
      const perSize = Math.max(1, Math.round(Number(productData.stock) / baseSizes.length));
      const autoSizeStock = {};
      baseSizes.forEach(s => { autoSizeStock[s] = perSize; });
      productData.sizeStock = autoSizeStock;
      productData.stock = Number(productData.stock);
      productData.availableSizes = baseSizes;
      productData.sizes = baseSizes;
    }

    if (productData.isCustomizable !== undefined) {
      productData.isCustomizable = Boolean(productData.isCustomizable);
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
    invalidateProductCache();
    const isObjectId = req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const query = isObjectId ? { _id: req.params.id } : { slug: req.params.id };

    const updateData = { ...req.body };
    if (updateData.category) {
      const catLower = updateData.category.toLowerCase().trim();
      if (catLower.includes('fan')) {
        updateData.category = 'Fan Version';
        updateData.sport = 'fan version';
      } else if (catLower.includes('player')) {
        updateData.category = 'Player Version';
        updateData.sport = 'player version';
      } else {
        updateData.sport = catLower;
      }
    }

    if (updateData.sizes && !updateData.availableSizes) {
      updateData.availableSizes = updateData.sizes;
    }

    if (updateData.sizeStock && typeof updateData.sizeStock === 'object' && Object.keys(updateData.sizeStock).length > 0) {
      const stockSum = Object.values(updateData.sizeStock).reduce((sum, val) => sum + (Number(val) || 0), 0);
      updateData.stock = stockSum;
      const inStockSizes = Object.entries(updateData.sizeStock)
        .filter(([_, qty]) => Number(qty) > 0)
        .map(([size]) => size);
      if (inStockSizes.length > 0) {
        updateData.availableSizes = inStockSizes;
        updateData.sizes = inStockSizes;
      }
    } else if (updateData.stock !== undefined && Number(updateData.stock) > 0 && (!updateData.sizeStock || Object.keys(updateData.sizeStock).length === 0)) {
      const baseSizes = updateData.sizes && updateData.sizes.length ? updateData.sizes : ['S', 'M', 'L', 'XL'];
      const perSize = Math.max(1, Math.round(Number(updateData.stock) / baseSizes.length));
      const autoSizeStock = {};
      baseSizes.forEach(s => { autoSizeStock[s] = perSize; });
      updateData.sizeStock = autoSizeStock;
      updateData.stock = Number(updateData.stock);
    }

    if (updateData.isCustomizable !== undefined) {
      updateData.isCustomizable = Boolean(updateData.isCustomizable);
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
    invalidateProductCache();
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

router.invalidateProductCache = invalidateProductCache;
module.exports = router;
module.exports.invalidateProductCache = invalidateProductCache;
