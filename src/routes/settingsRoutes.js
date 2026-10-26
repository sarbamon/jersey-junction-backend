const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../config/store_settings.json');

const DEFAULT_SETTINGS = {
  storeName: 'Jersey Junction',
  storeEmail: 'support@jerseyjunction.com',
  storePhone: '+91 98765 43210',
  storeAddress: '108 Sports Hub Plaza, MG Road, Bengaluru, Karnataka 560001, India',
  shippingCharge: 50,
  freeShippingThreshold: 999,
  codEnabled: true,
  razorpayEnabled: true,
  customJerseyPrice: 150,
};

function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[Settings] Error reading store settings file:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(newSettings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Settings] Error writing store settings file:', err);
    return false;
  }
}

// GET /api/settings - Retrieve store settings
router.get('/', (req, res) => {
  const current = readSettings();
  res.json({
    success: true,
    data: current,
  });
});

// POST or PUT /api/settings - Update store settings
const updateHandler = (req, res) => {
  const current = readSettings();
  const updates = req.body || {};

  const updated = {
    ...current,
    ...updates,
  };

  if (typeof updates.codEnabled === 'boolean') {
    updated.codEnabled = updates.codEnabled;
  }

  const success = writeSettings(updated);
  if (!success) {
    return res.status(500).json({ success: false, message: 'Failed to write store settings.' });
  }

  res.json({
    success: true,
    message: 'Store settings updated successfully',
    data: updated,
  });
};

router.post('/', updateHandler);
router.put('/', updateHandler);
router.readSettings = readSettings;

module.exports = router;
