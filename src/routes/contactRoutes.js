const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { sendContactInquiryEmail } = require('../utils/emailService');

// Helper to extract WHATSAPP_NO directly from backend .env
function getBackendWhatsappNumber() {
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^WHATSAPP_NO\s*=\s*(.+)$/m);
      if (match && match[1]) {
        return match[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (err) {
    console.warn('[Contact] Could not read .env file directly:', err.message);
  }
  return process.env.WHATSAPP_NO ? process.env.WHATSAPP_NO.trim() : '';
}

// GET /api/contact/whatsapp - Extract WhatsApp number directly from backend .env
router.get('/whatsapp', (req, res) => {
  const raw = getBackendWhatsappNumber();
  const clean = raw.replace(/\D/g, '');
  const standard = clean ? (clean.startsWith('91') ? clean : (clean.length === 10 ? `91${clean}` : clean)) : '';

  res.json({
    success: true,
    rawNumber: raw,
    whatsappNumber: standard,
  });
});

// POST /api/contact - Send customer inquiry to support@jerseyjunction.shop
router.post('/', async (req, res, next) => {
  try {
    const { name, email, orderNumber, subject, message } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Your name is required.' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }

    const resolvedEmail = (email && email.trim() && email.includes('@'))
      ? email.trim().toLowerCase()
      : (req.user?.email || 'customer@jerseyjunction.shop');

    const result = await sendContactInquiryEmail({
      name: name.trim(),
      email: resolvedEmail,
      orderNumber: (orderNumber || '').trim(),
      subject: (subject || 'General Inquiry').trim(),
      message: message.trim(),
    });

    if (result && result.success) {
      return res.status(200).json({
        success: true,
        message: 'Your message has been sent to our support team. We will get back to you shortly!',
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result?.error || 'Unable to deliver message at this time. Please try again.',
      });
    }
  } catch (error) {
    console.error('Contact form submission error:', error);
    next(error);
  }
});

module.exports = router;
