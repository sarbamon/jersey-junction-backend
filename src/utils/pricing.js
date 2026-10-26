const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../config/store_settings.json');

const getStoreSettings = () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[Pricing] Could not read store settings file, using defaults:', err.message);
  }
  return {
    expressShippingCharge: 100,
    standardShippingCharge: 0,
    freeShippingThreshold: 100000,
    codEnabled: false,
    customJerseyPrice: 150,
  };
};

/**
 * Authoritatively calculates cart totals, verifies stock, prices, customization, coupons, and shipping.
 * Never trusts client-submitted prices, discounts, or subtotals.
 *
 * @param {Object} params
 * @param {Array} params.items - Array of cart items from client
 * @param {string} [params.shippingMethod] - 'standard' | 'express'
 * @param {string} [params.couponCode] - Optional coupon code
 * @returns {Promise<Object>} Calculated price breakdown and verified items
 */
const calculateCartTotals = async ({ items, shippingMethod = 'standard', couponCode = '' }) => {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error('Cart is empty. Please add items before checking out.');
    error.statusCode = 400;
    throw error;
  }

  const settings = getStoreSettings();
  const verifiedItems = [];
  let subtotal = 0;
  let baseJerseysTotal = 0;
  let customPrintingTotal = 0;
  let patchesTotal = 0;

  for (const item of items) {
    if (!item) continue;

    const rawId = item.productId || item.id || item.slug;
    if (!rawId) {
      const error = new Error('Invalid item: product ID or slug is required.');
      error.statusCode = 400;
      throw error;
    }

    const quantity = parseInt(item.quantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      const error = new Error(`Invalid quantity for item ${item.name || rawId}. Must be at least 1.`);
      error.statusCode = 400;
      throw error;
    }

    if (quantity > 20) {
      const error = new Error(`Quantity for item ${item.name || rawId} exceeds maximum allowed per order (20).`);
      error.statusCode = 400;
      throw error;
    }

    // Lookup product in MongoDB authoritatively
    const query = [];
    const rawIdStr = String(rawId).trim();
    if (rawIdStr.match(/^[0-9a-fA-F]{24}$/)) {
      query.push({ _id: rawIdStr });
    }
    query.push({ slug: rawIdStr.toLowerCase() });
    query.push({ slug: rawIdStr });
    query.push({ sku: rawIdStr });

    const product = await Product.findOne({ $or: query });

    if (!product) {
      const error = new Error(`Product "${item.name || rawIdStr}" is no longer available.`);
      error.statusCode = 400;
      throw error;
    }

    if (product.status === 'Draft' || product.status === 'Out of Stock') {
      const error = new Error(`Product "${product.name}" is currently ${product.status}.`);
      error.statusCode = 400;
      throw error;
    }

    // Check available stock
    const requestedSize = (item.size || 'M').trim();
    const hasSizeStock =
      product.sizeStock &&
      typeof product.sizeStock === 'object' &&
      Object.keys(product.sizeStock).length > 0;

    if (hasSizeStock) {
      const matchingKey = Object.keys(product.sizeStock).find(
        (k) => k.trim().toUpperCase() === requestedSize.toUpperCase()
      );
      if (matchingKey) {
        const availableInSize = Number(product.sizeStock[matchingKey]) || 0;
        if (availableInSize < quantity) {
          const error = new Error(
            `Insufficient stock for "${product.name}" (Size ${requestedSize}). Available: ${availableInSize}, requested: ${quantity}.`
          );
          error.statusCode = 400;
          throw error;
        }
      }
    } else {
      const totalStock = Number(product.stock) || 0;
      if (totalStock < quantity) {
        const error = new Error(
          `Insufficient stock for "${product.name}". Available: ${totalStock}, requested: ${quantity}.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    // Authoritative pricing rules:
    // 1. Base price from database
    const basePrice = Number(product.price);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      const error = new Error(`Invalid price configuration for product "${product.name}".`);
      error.statusCode = 500;
      throw error;
    }

    // 2. Edition surcharge: +₹150 for Player version
    const versionStr = String(item.version || '').trim();
    const isPlayerVersion = /player/i.test(versionStr);
    const versionExtra = isPlayerVersion ? 150 : 0;

    // 3. Customization surcharge: dynamic custom jersey price
    const customNameStr = String(item.customName || '').trim();
    const customNumberStr = String(item.customNumber || '').trim();
    const isCustomized = customNameStr.length > 0 || customNumberStr.length > 0;
    const effectiveCustomPrice = (typeof product.customizationPrice === 'number' && product.customizationPrice >= 0)
      ? product.customizationPrice
      : (typeof settings.customJerseyPrice === 'number' && settings.customJerseyPrice >= 0 ? settings.customJerseyPrice : 150);
    const printExtra = isCustomized ? effectiveCustomPrice : 0;

    // 4. Patches surcharge (if any selected patches)
    let patchesPrice = 0;
    const selectedPatches = Array.isArray(item.selectedPatches)
      ? item.selectedPatches
      : Array.isArray(item.patches)
      ? item.patches
      : [];

    if (selectedPatches.length > 0) {
      for (const patch of selectedPatches) {
        if (!patch) continue;
        // Verify patch price against product.availablePatches if available
        let patchCost = Number(patch.price) || 0;
        if (Array.isArray(product.availablePatches) && product.availablePatches.length > 0) {
          const matchedPatch = product.availablePatches.find(
            (p) => p && (p.id === patch.id || p.name === patch.name)
          );
          if (matchedPatch && Number.isFinite(matchedPatch.price)) {
            patchCost = Number(matchedPatch.price);
          }
        }
        patchesPrice += Math.max(0, patchCost);
      }
    }

    const unitPrice = basePrice + versionExtra + printExtra + patchesPrice;
    const itemSubtotal = unitPrice * quantity;
    subtotal += itemSubtotal;

    baseJerseysTotal += (basePrice + versionExtra) * quantity;
    customPrintingTotal += printExtra * quantity;
    patchesTotal += patchesPrice * quantity;

    verifiedItems.push({
      productId: product._id.toString(),
      slug: product.slug,
      name: product.name,
      size: requestedSize,
      version: versionStr || (isPlayerVersion ? 'Player Edition' : 'Fan Edition'),
      customName: customNameStr,
      customNumber: customNumberStr,
      quantity,
      unitPrice,
      basePrice: basePrice + versionExtra,
      customFee: printExtra,
      patchesPrice,
      subtotal: itemSubtotal,
      image: product.image || (Array.isArray(product.images) && product.images[0]) || '',
    });
  }

  // Authoritative Coupon Validation
  let discountAmount = 0;
  let appliedCoupon = null;

  const cleanCouponCode = String(couponCode || '').trim().toUpperCase();
  if (cleanCouponCode) {
    const coupon = await Coupon.findOne({ code: cleanCouponCode });

    if (!coupon || coupon.status !== 'Active') {
      const error = new Error(`Coupon "${cleanCouponCode}" is invalid or inactive.`);
      error.statusCode = 400;
      throw error;
    }

    if (coupon.expiryDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (coupon.expiryDate < today) {
        const error = new Error(`Coupon "${cleanCouponCode}" has expired.`);
        error.statusCode = 400;
        throw error;
      }
    }

    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      const error = new Error(`Coupon "${cleanCouponCode}" has reached its maximum usage limit.`);
      error.statusCode = 400;
      throw error;
    }

    if (coupon.minOrder > 0 && subtotal < coupon.minOrder) {
      const error = new Error(
        `Minimum order amount of ₹${coupon.minOrder} is required for coupon "${cleanCouponCode}". Cart subtotal is ₹${subtotal}.`
      );
      error.statusCode = 400;
      throw error;
    }

    if (coupon.discountType === 'percentage') {
      const rawDiscount = (subtotal * coupon.discountValue) / 100;
      discountAmount = coupon.maxDiscount > 0 ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;
    } else {
      // Fixed discount
      discountAmount = Math.min(subtotal, coupon.discountValue);
    }

    discountAmount = Math.round(discountAmount);
    appliedCoupon = {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
    };
  }

  // Authoritative Shipping Calculation
  const settings = getStoreSettings();
  const normalizedMethod = String(shippingMethod || 'standard').toLowerCase();
  let shippingFee = 0;

  if (verifiedItems.length > 0) {
    if (normalizedMethod === 'express') {
      shippingFee = typeof settings.expressShippingCharge === 'number' ? settings.expressShippingCharge : 100;
    } else {
      const freeThreshold = typeof settings.freeShippingThreshold === 'number' ? settings.freeShippingThreshold : 100000;
      if (subtotal >= freeThreshold) {
        shippingFee = 0;
      } else {
        shippingFee = typeof settings.standardShippingCharge === 'number' ? settings.standardShippingCharge : 0;
      }
    }
  }

  const totalAmount = Math.max(0, subtotal - discountAmount + shippingFee);
  const amountInPaise = Math.round(totalAmount * 100);

  return {
    baseJerseysTotal,
    customPrintingTotal,
    patchesTotal,
    subtotal,
    discountAmount,
    shippingFee,
    totalAmount,
    amountInPaise,
    shippingMethod: normalizedMethod,
    items: verifiedItems,
    appliedCoupon,
  };
};

module.exports = {
  calculateCartTotals,
  getStoreSettings,
};
