const Product = require('../models/Product');

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Helper function to deduct or restore inventory for an array of items
const adjustProductStock = async (items, direction = -1) => {
  // direction = -1 means deduct (minus stock on order placement / payment)
  // direction = 1 means restore (plus stock on order cancellation)
  if (!Array.isArray(items) || items.length === 0) return;

  for (const itm of items) {
    try {
      const qty = (Number(itm.quantity) || 1) * direction; // negative for deduction, positive for restoration
      const absQty = Math.abs(qty);
      const price = Number(itm.unitPrice) || 0;

      const prodQueries = [];
      if (itm.productId) {
        const rawId = String(itm.productId).trim();
        if (rawId.match(/^[0-9a-fA-F]{24}$/)) {
          prodQueries.push({ _id: rawId });
        }
        prodQueries.push({ slug: rawId.toLowerCase() });
        prodQueries.push({ slug: rawId });
        prodQueries.push({ sku: rawId });
      }
      if (itm.name) {
        const cleanName = String(itm.name).trim();
        prodQueries.push({ name: cleanName });
        try {
          prodQueries.push({ name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') });
        } catch (e) {}
      }

      if (prodQueries.length === 0) continue;

      const matchedProd = await Product.findOne({ $or: prodQueries });
      if (!matchedProd) {
        console.warn(`[Inventory] Could not find product matching:`, prodQueries);
        continue;
      }

      const currentStock = Number(matchedProd.stock) || 0;
      let newStock = Math.max(0, currentStock + qty);

      const updateFields = {
        $inc: {
          totalSold: direction < 0 ? absQty : -absQty,
          revenueGenerated: direction < 0 ? absQty * price : -(absQty * price),
        },
      };

      // Check if product has an actively populated sizeStock breakdown
      const hasPopulatedSizeStock =
        matchedProd.sizeStock &&
        typeof matchedProd.sizeStock === 'object' &&
        Object.keys(matchedProd.sizeStock).length > 0 &&
        Object.values(matchedProd.sizeStock).some((v) => Number(v) > 0);

      let updatedSizeStock = null;

      if (hasPopulatedSizeStock && itm.size) {
        updatedSizeStock = { ...matchedProd.sizeStock };
        const sizeStr = String(itm.size).trim();
        const matchingKey = Object.keys(updatedSizeStock).find(
          (k) => k.trim().toUpperCase() === sizeStr.toUpperCase()
        );

        if (matchingKey) {
          const curSizeQty = Number(updatedSizeStock[matchingKey]) || 0;
          updatedSizeStock[matchingKey] = Math.max(0, curSizeQty + qty);
          newStock = Object.values(updatedSizeStock).reduce((sum, v) => sum + (Number(v) || 0), 0);
        }
      }

      const newStatus = newStock <= 0 ? 'Out of Stock' : (matchedProd.status === 'Draft' ? 'Draft' : 'Active');

      const setObj = {
        stock: newStock,
        status: newStatus,
      };

      if (updatedSizeStock) {
        setObj.sizeStock = updatedSizeStock;
      }

      updateFields.$set = setObj;

      await Product.updateOne({ _id: matchedProd._id }, updateFields);
      console.log(
        `[Inventory] Product "${matchedProd.name}" (${matchedProd.slug}) stock updated: ${currentStock} -> ${newStock} (${direction < 0 ? 'deducted' : 'restored'} ${absQty} units)`
      );
    } catch (err) {
      console.error(`[Inventory Error] Failed adjusting stock for item:`, itm, err);
    }
  }
};

module.exports = {
  adjustProductStock,
  escapeRegex,
};
