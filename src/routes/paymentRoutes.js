
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');

const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID?.trim();
  const key_secret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!key_id || !key_secret || key_id === 'rzp_test_key') {
    throw new Error('Razorpay API credentials are missing or invalid');
  }

  return new Razorpay({ key_id, key_secret });
};

// GET /api/payment/key
router.get('/key', (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();

  if (!keyId || keyId === 'rzp_test_key') {
    return res.status(503).json({
      success: false,
      message: 'Razorpay is not configured',
    });
  }

  res.json({ success: true, keyId });
});

// POST /api/payment/create-order
router.post('/create-order', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const currency = req.body.currency || 'INR';

    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least ₹1',
      });
    }

    if (currency !== 'INR') {
      return res.status(400).json({
        success: false,
        message: 'Unsupported currency',
      });
    }

    const razorpay = getRazorpayInstance();

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt: `rcpt_${Date.now()}`,
    });

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Razorpay order creation failed:', error.message);

    res.status(502).json({
      success: false,
      message: 'Unable to create Razorpay order. Check server credentials and logs.',
    });
  }
});

// POST /api/payment/verify
router.post('/verify', (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      typeof razorpay_order_id !== 'string' ||
      typeof razorpay_payment_id !== 'string' ||
      typeof razorpay_signature !== 'string' ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification fields',
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET?.trim();

    if (!secret) {
      return res.status(503).json({
        success: false,
        message: 'Payment verification is not configured',
      });
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest();

    let received;

    try {
      received = Buffer.from(razorpay_signature, 'hex');
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature',
      });
    }

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Payment signature verification failed',
      });
    }

    return res.json({
      success: true,
      message: 'Payment signature verified',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });
  } catch (error) {
    console.error('Payment verification failed:', error.message);

    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
    });
  }
});

module.exports = router;