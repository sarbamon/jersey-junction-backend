const express = require('express');
const router = express.Router();
const Banner = require('../models/Banner');

const DEFAULT_BANNERS = [
  {
    title: 'THE ULTIMATE MATCHDAY COLLECTION 24/25',
    subtitle: 'Explore Authentic Master Quality Kits with Custom Thermo Printing',
    imageUrl: '/hero/colin-meg-R8ayF9Qwu5Y-unsplash.webp',
    buttonText: 'SHOP THE DROPS',
    buttonLink: '/shop',
    status: 'Active',
    order: 0,
  },
  {
    title: 'VINTAGE RETRO LEGENDS 1990-2010',
    subtitle: 'Relive Iconic Moments with Original 5-Star Crests',
    imageUrl: '/hero/bibesh-manandhar-e-OfH1yh_hs-unsplash.webp',
    buttonText: 'EXPLORE RETRO',
    buttonLink: '/shop',
    status: 'Active',
    order: 1,
  },
  {
    title: 'CUSTOM JERSEY STUDIO',
    subtitle: 'Design Your Own Name & Number Kit Live in 3D',
    imageUrl: '/hero/simon-reza-Yfv7JszxYyw-unsplash.webp',
    buttonText: 'BUILD YOUR KIT',
    buttonLink: '/shop',
    status: 'Active',
    order: 2,
  },
];

let hasSeeded = false;
async function seedBannersIfEmpty() {
  if (hasSeeded) return;
  try {
    const count = await Banner.countDocuments();
    if (count === 0) {
      await Banner.insertMany(DEFAULT_BANNERS);
      console.log('Seeded default hero banners in MongoDB.');
    }
    hasSeeded = true;
  } catch (err) {
    console.error('Error seeding banners:', err.message);
  }
}

// In-memory cache for high-traffic fast responses
let cachedActiveBanners = null;
let cachedActiveTime = 0;
let cachedAdminBanners = null;
let cachedAdminTime = 0;
const CACHE_TTL = 60 * 1000;

function invalidateBannerCache() {
  cachedActiveBanners = null;
  cachedAdminBanners = null;
}

// GET active banners for homepage hero
router.get('/', async (req, res) => {
  try {
    if (cachedActiveBanners && Date.now() - cachedActiveTime < CACHE_TTL) {
      return res.json({ success: true, count: cachedActiveBanners.length, data: cachedActiveBanners });
    }
    await seedBannersIfEmpty();
    const banners = await Banner.find({ status: 'Active' }).sort({ order: 1, createdAt: 1 }).lean();
    cachedActiveBanners = banners;
    cachedActiveTime = Date.now();
    res.json({ success: true, count: banners.length, data: banners });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET all banners for admin panel
router.get('/admin/all', async (req, res) => {
  try {
    if (cachedAdminBanners && Date.now() - cachedAdminTime < CACHE_TTL) {
      return res.json({ success: true, count: cachedAdminBanners.length, data: cachedAdminBanners });
    }
    await seedBannersIfEmpty();
    const banners = await Banner.find().sort({ order: 1, createdAt: 1 }).lean();
    cachedAdminBanners = banners;
    cachedAdminTime = Date.now();
    res.json({ success: true, count: banners.length, data: banners });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create banner
router.post('/', async (req, res) => {
  try {
    const { title, subtitle, imageUrl, buttonText, buttonLink, status, order } = req.body;
    if (!title || !imageUrl) {
      return res.status(400).json({ success: false, message: 'Title and image are required' });
    }

    const banner = await Banner.create({
      title,
      subtitle: subtitle || '',
      imageUrl,
      buttonText: buttonText || 'SHOP NOW',
      buttonLink: buttonLink || '/shop',
      status: status || 'Active',
      order: typeof order === 'number' ? order : 0,
    });

    invalidateBannerCache();
    res.status(201).json({ success: true, data: banner });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// PUT update banner
router.put('/:id', async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }
    invalidateBannerCache();
    res.json({ success: true, data: banner });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE banner
router.delete('/:id', async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }
    invalidateBannerCache();
    res.json({ success: true, message: 'Banner removed' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
