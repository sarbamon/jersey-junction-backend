const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

const DEFAULT_CATEGORIES = [
  { name: 'Player Version', slug: 'player-version', tag: 'Athletic Slim Fit', image: 'https://res.cloudinary.com/mcsohx4p/image/upload/v1792689803/jerseyjunction_uploads/yznaq5f6ciiy3unby7e8.jpg', status: 'Active' },
  { name: 'Fan Version', slug: 'fan-version', tag: 'Standard Fit', image: 'https://res.cloudinary.com/mcsohx4p/image/upload/v1792689804/jerseyjunction_uploads/tu9yhwz7tuelbg3rmp5d.jpg', status: 'Active' },
];

let hasSeeded = false;
async function seedCategoriesIfEmpty() {
  if (hasSeeded) return;
  try {
    const count = await Category.countDocuments();
    if (count === 0) {
      await Category.insertMany(DEFAULT_CATEGORIES);
      console.log('Seeded default admin categories in MongoDB.');
    }
    hasSeeded = true;
  } catch (err) {
    console.error('Error seeding categories:', err.message);
  }
}

// In-memory cache for ultra-fast 0ms responses
let cachedActiveCategories = null;
let cachedActiveTime = 0;
let cachedAdminCategories = null;
let cachedAdminTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

function invalidateCategoryCache() {
  cachedActiveCategories = null;
  cachedAdminCategories = null;
}

// GET active categories for public storefront
router.get('/', async (req, res) => {
  try {
    if (cachedActiveCategories && (Date.now() - cachedActiveTime < CACHE_TTL)) {
      return res.json({ success: true, count: cachedActiveCategories.length, data: cachedActiveCategories });
    }
    await seedCategoriesIfEmpty();
    const categories = await Category.find({ status: 'Active' }).sort({ order: 1, createdAt: 1 }).lean();
    cachedActiveCategories = categories;
    cachedActiveTime = Date.now();
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET all categories for admin
router.get('/admin/all', async (req, res) => {
  try {
    if (cachedAdminCategories && (Date.now() - cachedAdminTime < CACHE_TTL)) {
      return res.json({ success: true, count: cachedAdminCategories.length, data: cachedAdminCategories });
    }
    await seedCategoriesIfEmpty();
    const categories = await Category.find().sort({ order: 1, createdAt: 1 }).lean();
    cachedAdminCategories = categories;
    cachedAdminTime = Date.now();
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/categories/reorder - Update order of categories
router.put('/reorder', async (req, res) => {
  try {
    invalidateCategoryCache();
    const { orderedIds } = req.body;
    if (Array.isArray(orderedIds)) {
      const updates = orderedIds.map((id, index) => {
        const isObjectId = typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/);
        return Category.updateOne(
          isObjectId ? { _id: id } : { $or: [{ slug: id }, { name: id }] },
          { $set: { order: index } }
        );
      });
      await Promise.all(updates);
    }
    const categories = await Category.find().sort({ order: 1, createdAt: 1 }).lean();
    cachedAdminCategories = categories;
    cachedAdminTime = Date.now();
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create category
router.post('/', async (req, res) => {
  try {
    invalidateCategoryCache();
    const { name, slug, tag, image, status } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    if (!image || !image.trim()) {
      return res.status(400).json({ success: false, message: 'Category photo is compulsory. Please upload an image.' });
    }
    const catSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await Category.findOne({ slug: catSlug });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category with this slug already exists' });
    }
    const maxCat = await Category.findOne().sort({ order: -1 });
    const nextOrder = maxCat && typeof maxCat.order === 'number' ? maxCat.order + 1 : 0;

    const category = await Category.create({
      name: name.trim(),
      slug: catSlug,
      tag: tag || 'Sport Collection',
      image: image.trim(),
      status: status || 'Active',
      order: nextOrder,
    });
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update category
router.put('/:id', async (req, res) => {
  try {
    invalidateCategoryCache();
    let category = await Category.findById(req.params.id);
    if (!category) {
      // search by slug or custom id if needed
      category = await Category.findOne({ slug: req.params.id });
    }
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    if (req.body.image !== undefined && (!req.body.image || !req.body.image.trim())) {
      return res.status(400).json({ success: false, message: 'Category photo is compulsory and cannot be empty.' });
    }
    category = await Category.findByIdAndUpdate(category._id, req.body, { new: true, runValidators: true });
    res.json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/categories/bulk-delete - Delete multiple categories
router.post('/bulk-delete', async (req, res) => {
  try {
    invalidateCategoryCache();
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No category IDs provided' });
    }

    const objectIds = ids.filter(id => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/));
    const query = {
      $or: [
        { _id: { $in: objectIds } },
        { slug: { $in: ids } }
      ]
    };

    const result = await Category.deleteMany(query);
    res.json({
      success: true,
      count: result.deletedCount,
      message: `Deleted ${result.deletedCount} categories successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE category
router.delete('/:id', async (req, res) => {
  try {
    invalidateCategoryCache();
    const isObjectId = req.params.id && req.params.id.match(/^[0-9a-fA-F]{24}$/);
    let category = isObjectId ? await Category.findById(req.params.id) : null;
    if (!category) {
      category = await Category.findOne({ slug: req.params.id });
    }
    if (!category) {
      return res.status(200).json({ success: true, message: 'Category already deleted or not found' });
    }
    await Category.findByIdAndDelete(category._id);
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
