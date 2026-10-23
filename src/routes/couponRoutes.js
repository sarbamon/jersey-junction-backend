const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
const { protect, authorize } = require('../middleware/auth');

// GET /api/coupons - List all coupons
router.get('/', async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: coupons.length,
      data: coupons.map(c => ({
        id: c._id.toString(),
        code: c.code,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        expiryDate: c.expiryDate,
        usageLimit: c.usageLimit,
        usedCount: c.usedCount,
        status: c.status,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/coupons/validate - Validate coupon for cart checkout
router.post('/validate', async (req, res, next) => {
  try {
    const { code, subtotal = 0 } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, valid: false, message: 'Please provide a coupon code' });
    }

    const cleanCode = code.trim().toUpperCase();
    const coupon = await Coupon.findOne({ code: cleanCode });

    if (!coupon || coupon.status !== 'Active') {
      return res.status(200).json({
        success: true,
        valid: false,
        message: 'Invalid or inactive coupon code',
      });
    }

    // Check expiry
    if (coupon.expiryDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (coupon.expiryDate < today) {
        return res.status(200).json({
          success: true,
          valid: false,
          message: 'This coupon has expired',
        });
      }
    }

    // Check usage limit
    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return res.status(200).json({
        success: true,
        valid: false,
        message: 'This coupon has reached its usage limit',
      });
    }

    // Check minimum order
    const orderAmount = Number(subtotal) || 0;
    if (coupon.minOrder > 0 && orderAmount < coupon.minOrder) {
      return res.status(200).json({
        success: true,
        valid: false,
        message: `Minimum order amount of ₹${coupon.minOrder} required for this coupon`,
      });
    }

    // Calculate discount
    let discountAmount = 0;
    let discountPercentage = 0;

    if (coupon.discountType === 'percentage') {
      discountPercentage = coupon.discountValue;
      discountAmount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscount > 0 && discountAmount > coupon.maxDiscount) {
        discountAmount = coupon.maxDiscount;
      }
    } else {
      // Fixed discount
      discountAmount = Math.min(orderAmount, coupon.discountValue);
      discountPercentage = orderAmount > 0 ? Math.round((discountAmount / orderAmount) * 100) : 0;
    }

    return res.status(200).json({
      success: true,
      valid: true,
      coupon: {
        id: coupon._id.toString(),
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrder: coupon.minOrder,
        maxDiscount: coupon.maxDiscount,
      },
      discountPercentage,
      discountAmount,
      message: `Coupon "${coupon.code}" applied! You saved ₹${discountAmount.toFixed(0)}`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/coupons - Create coupon (Admin only)
router.post('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { code, discountType, discountValue, minOrder, maxDiscount, expiryDate, usageLimit, status } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await Coupon.findOne({ code: cleanCode });
    if (existing) {
      return res.status(400).json({ success: false, message: `Coupon "${cleanCode}" already exists` });
    }

    const newCoupon = await Coupon.create({
      code: cleanCode,
      discountType: discountType || 'percentage',
      discountValue: Number(discountValue) || 10,
      minOrder: Number(minOrder) || 0,
      maxDiscount: Number(maxDiscount) || 0,
      expiryDate: expiryDate || '',
      usageLimit: Number(usageLimit) || 1000,
      status: status || 'Active',
    });

    res.status(201).json({
      success: true,
      data: {
        id: newCoupon._id.toString(),
        code: newCoupon.code,
        discountType: newCoupon.discountType,
        discountValue: newCoupon.discountValue,
        minOrder: newCoupon.minOrder,
        maxDiscount: newCoupon.maxDiscount,
        expiryDate: newCoupon.expiryDate,
        usageLimit: newCoupon.usageLimit,
        usedCount: newCoupon.usedCount,
        status: newCoupon.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/coupons/:id - Update coupon (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const isObjectId = req.params.id && req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const query = isObjectId ? { _id: req.params.id } : { code: req.params.id.toUpperCase() };

    const updateData = { ...req.body };
    if (updateData.code) {
      updateData.code = updateData.code.trim().toUpperCase();
    }

    const updated = await Coupon.findOneAndUpdate(query, updateData, { new: true, runValidators: true });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        id: updated._id.toString(),
        code: updated.code,
        discountType: updated.discountType,
        discountValue: updated.discountValue,
        minOrder: updated.minOrder,
        maxDiscount: updated.maxDiscount,
        expiryDate: updated.expiryDate,
        usageLimit: updated.usageLimit,
        usedCount: updated.usedCount,
        status: updated.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/coupons/:id - Delete coupon (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const isObjectId = req.params.id && req.params.id.match(/^[0-9a-fA-F]{24}$/);
    const query = isObjectId ? { _id: req.params.id } : { code: req.params.id.toUpperCase() };

    await Coupon.findOneAndDelete(query);
    res.status(200).json({
      success: true,
      message: 'Coupon deleted successfully',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
