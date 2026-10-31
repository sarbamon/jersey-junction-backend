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
  customJerseyPrice: 250,
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

// Active SSE clients for instant real-time settings broadcast
const sseClients = new Set();

// GET /api/settings/events - Real-time Server-Sent Events stream
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });

  const current = readSettings();
  res.write(`data: ${JSON.stringify(current)}\n\n`);

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

let onSettingsUpdated = null;

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
  if (typeof updates.razorpayEnabled === 'boolean') {
    updated.razorpayEnabled = updates.razorpayEnabled;
  }
  if (updates.customJerseyPrice !== undefined) {
    const num = Number(updates.customJerseyPrice);
    if (!isNaN(num)) {
      updated.customJerseyPrice = Math.max(0, num);
    }
  }
  if (updates.expressShippingCharge !== undefined) {
    const num = Number(updates.expressShippingCharge);
    if (!isNaN(num)) {
      updated.expressShippingCharge = Math.max(0, num);
    }
  }
  if (updates.standardShippingCharge !== undefined) {
    const num = Number(updates.standardShippingCharge);
    if (!isNaN(num)) {
      updated.standardShippingCharge = Math.max(0, num);
    }
  }
  if (updates.shippingCharge !== undefined) {
    const num = Number(updates.shippingCharge);
    if (!isNaN(num)) {
      updated.shippingCharge = Math.max(0, num);
    }
  }
  if (updates.freeShippingThreshold !== undefined) {
    const num = Number(updates.freeShippingThreshold);
    if (!isNaN(num)) {
      updated.freeShippingThreshold = Math.max(0, num);
    }
  }

  const success = writeSettings(updated);
  if (!success) {
    return res.status(500).json({ success: false, message: 'Failed to write store settings.' });
  }

  // Real-time broadcast to all connected storefront and admin clients
  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify(updated)}\n\n`);
    } catch (_) {
      sseClients.delete(client);
    }
  }

  if (typeof onSettingsUpdated === 'function') {
    try {
      onSettingsUpdated(updated);
    } catch (e) {
      console.warn('[Settings] onSettingsUpdated callback notice:', e.message);
    }
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
router.setOnSettingsUpdated = (fn) => {
  onSettingsUpdated = fn;
};

module.exports = router;
