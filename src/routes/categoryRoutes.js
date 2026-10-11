const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

const DEFAULT_CATEGORIES = [
  { name: 'Player Version', slug: 'player-version', tag: 'Athletic Slim Fit', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.17 PM.jpeg', status: 'Active' },
  { name: 'Fan Version', slug: 'fan-version', tag: 'Standard Fit', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.39 PM.jpeg', status: 'Active' },
  { name: 'Full Sets (Kit + Shorts)', slug: 'set', tag: 'Complete Uniform', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.00 PM.jpeg', status: 'Active' },
  { name: 'Retro Classics', slug: 'retro', tag: 'Vintage Legends', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.41 PM (1).jpeg', status: 'Active' },
  { name: 'Clearance Sale', slug: 'clearance', tag: 'Up to 50% Off', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.40 PM.jpeg', status: 'Active' },
  { name: 'Formula 1 Racing', slug: 'formula-1', tag: 'F1 Teamwear', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.43 PM.jpeg', status: 'Active' },
  { name: 'Cricket Kits', slug: 'cricket', tag: 'National & IPL', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.44 PM.jpeg', status: 'Active' },
  { name: 'NBA Basketball', slug: 'nba', tag: 'Swingman Jerseys', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.42 PM.jpeg', status: 'Active' },
  { name: 'Windbreakers & Jackets', slug: 'jackets', tag: 'Outerwear', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.43 PM.jpeg', status: 'Active' },
  { name: 'Team Polos', slug: 'polo', tag: 'Casual Sport', image: '/jersey/WhatsApp Image 2026-09-08 at 11.44.45 PM (1).jpeg', status: 'Active' },
];

async function seedCategoriesIfEmpty() {
  try {
    const count = await Category.countDocuments();
    if (count === 0) {
      await Category.insertMany(DEFAULT_CATEGORIES);
      console.log('Seeded default admin categories in MongoDB.');
    }
  } catch (err) {
    console.error('Error seeding categories:', err.message);
  }
}

// GET active categories for public storefront
router.get('/', async (req, res) => {
  try {
    await seedCategoriesIfEmpty();
    const categories = await Category.find({ status: 'Active' }).sort({ order: 1, createdAt: 1 });
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET all categories for admin
router.get('/admin/all', async (req, res) => {
  try {
    await seedCategoriesIfEmpty();
    const categories = await Category.find().sort({ order: 1, createdAt: 1 });
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/categories/reorder - Update order of categories
router.put('/reorder', async (req, res) => {
  try {
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
    const categories = await Category.find().sort({ order: 1, createdAt: 1 });
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create category
router.post('/', async (req, res) => {
  try {
    const { name, slug, tag, image, status } = req.body;
    const catSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await Category.findOne({ slug: catSlug });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category with this slug already exists' });
    }
    const maxCat = await Category.findOne().sort({ order: -1 });
    const nextOrder = maxCat && typeof maxCat.order === 'number' ? maxCat.order + 1 : 0;

    const category = await Category.create({
      name,
      slug: catSlug,
      tag: tag || 'Sport Collection',
      image: image || '/jersey/WhatsApp Image 2026-09-08 at 11.44.00 PM.jpeg',
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
    let category = await Category.findById(req.params.id);
    if (!category) {
      // search by slug or custom id if needed
      category = await Category.findOne({ slug: req.params.id });
    }
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    category = await Category.findByIdAndUpdate(category._id, req.body, { new: true, runValidators: true });
    res.json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE category
router.delete('/:id', async (req, res) => {
  try {
    let category = await Category.findById(req.params.id);
    if (!category) {
      category = await Category.findOne({ slug: req.params.id });
    }
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    await Category.findByIdAndDelete(category._id);
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
