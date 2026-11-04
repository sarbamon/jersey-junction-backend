const express = require('express');
const router = express.Router();
const { sendContactInquiryEmail } = require('../utils/emailService');

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
