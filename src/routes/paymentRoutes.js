const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const { adjustProductStock } = require('../utils/inventory');

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
// Pre-creates the Razorpay gateway order AND stores a Pending Order in MongoDB
// so that backend webhook can confirm it even if the user closes the window.
router.post('/create-order', async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const currency = req.body.currency || 'INR';
    const orderData = req.body.orderData; // optional complete order payload from checkout

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
    const receiptId = `rcpt_${Date.now()}`;
    const internalOrderId = orderData?.id || `#JJ${Math.floor(1000 + Math.random() * 9000)}`;

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      receipt: receiptId,
      notes: {
        orderId: internalOrderId,
        email: orderData?.email || '',
        customerName: orderData?.customerName || '',
      },
    });

    // If orderData is supplied, pre-create the Order in MongoDB in 'Pending' state
    let createdMongoOrder = null;
    if (orderData && Array.isArray(orderData.items) && orderData.items.length > 0) {
      try {
        const orderDoc = {
          orderId: internalOrderId,
          customerName: orderData.customerName || 'Customer',
          email: orderData.email ? orderData.email.toLowerCase() : '',
          phone: orderData.phone || '',
          shippingAddress: orderData.shippingAddress || {},
          items: orderData.items,
          subtotal: orderData.subtotal || amount,
          shippingFee: orderData.shippingFee || 0,
          discountAmount: orderData.discountAmount || 0,
          totalAmount: orderData.totalAmount || amount,
          paymentMethod: 'Razorpay',
          paymentStatus: 'Pending',
          orderStatus: 'Pending',
          razorpayOrderId: rzpOrder.id,
          stockDeducted: false,
          date: new Date().toISOString().split('T')[0],
          timeline: [
            {
              status: 'Pending',
              timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
              note: `Payment initiated via Razorpay (Order ID: ${rzpOrder.id})`,
            },
          ],
        };

        // Check if already exists, else create
        createdMongoOrder = await Order.findOneAndUpdate(
          { orderId: internalOrderId },
          { $set: orderDoc },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`[Payment] Pre-created Pending order: ${internalOrderId} for Razorpay order ${rzpOrder.id}`);
      } catch (dbErr) {
        console.error('[Payment] Could not pre-save pending order in MongoDB:', dbErr.message);
      }
    }

    res.json({
      success: true,
      data: rzpOrder,
      internalOrderId,
      order: createdMongoOrder,
    });
  } catch (error) {
    console.error('Razorpay order creation failed:', error.message);

    res.status(502).json({
      success: false,
      message: 'Unable to create Razorpay order. Check server credentials and logs.',
    });
  }
});

// POST /api/payment/verify
// Frontend verification callback when user completes payment and stays on page
router.post('/verify', async (req, res) => {
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

    // Signature verified! Now find and mark MongoDB order as Paid
    try {
      const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
      if (order) {
        order.razorpayPaymentId = razorpay_payment_id;
        order.paymentStatus = 'Paid';
        if (order.orderStatus === 'Pending') {
          order.orderStatus = 'Confirmed';
        }

        if (!order.stockDeducted) {
          await adjustProductStock(order.items, -1);
          order.stockDeducted = true;
        }

        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
        if (!order.timeline.some((t) => t.note && t.note.includes(razorpay_payment_id))) {
          order.timeline.push({
            status: order.orderStatus,
            timestamp,
            note: `Payment verified via Razorpay (Payment ID: ${razorpay_payment_id})`,
          });
        }

        await order.save();
        console.log(`[Payment] Order ${order.orderId} marked Paid via frontend verification`);
      }
    } catch (orderUpdateErr) {
      console.error('[Payment] Error confirming order in DB:', orderUpdateErr.message);
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

// POST /api/payment/webhook
// BACKEND-TO-BACKEND Server Webhook
// Razorpay server calls this directly if user closes the window, app crashes, or drops connection!
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '').trim();

    if (!signature) {
      console.warn('[Webhook] Received webhook request without x-razorpay-signature header');
      return res.status(400).json({ success: false, message: 'Missing webhook signature' });
    }

    // Verify HMAC SHA256 signature using the raw body buffer
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
    } catch (cmpErr) {
      isValid = false;
    }

    if (!isValid) {
      console.warn('[Webhook] Invalid Razorpay webhook signature');
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    const payload = req.body.payload || {};
    console.log(`[Razorpay Webhook] Received event: ${event}`);

    // Process payment success / capture events
    if (event === 'payment.captured' || event === 'order.paid' || event === 'payment.authorized') {
      const paymentEntity = payload.payment?.entity;
      const orderEntity = payload.order?.entity;

      const rzpOrderId = paymentEntity?.order_id || orderEntity?.id;
      const paymentId = paymentEntity?.id || '';
      const notesOrderId = paymentEntity?.notes?.orderId || orderEntity?.notes?.orderId;

      console.log(
        `[Webhook] Processing successful payment for RzpOrderId: ${rzpOrderId}, InternalOrderId: ${notesOrderId}, PaymentId: ${paymentId}`
      );

      // Search order by razorpayOrderId or internal orderId
      const searchConditions = [];
      if (rzpOrderId) searchConditions.push({ razorpayOrderId: rzpOrderId });
      if (notesOrderId) {
        searchConditions.push({ orderId: notesOrderId });
        searchConditions.push({ orderId: notesOrderId.startsWith('#') ? notesOrderId : `#${notesOrderId}` });
      }

      if (searchConditions.length > 0) {
        const order = await Order.findOne({ $or: searchConditions });

        if (order) {
          const wasPaid = order.paymentStatus === 'Paid';
          order.paymentStatus = 'Paid';
          if (order.orderStatus === 'Pending') {
            order.orderStatus = 'Confirmed';
          }
          if (paymentId) {
            order.razorpayPaymentId = paymentId;
          }
          if (rzpOrderId && !order.razorpayOrderId) {
            order.razorpayOrderId = rzpOrderId;
          }

          // Deduct stock if not already deducted
          if (!order.stockDeducted) {
            await adjustProductStock(order.items, -1);
            order.stockDeducted = true;
          }

          const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
          const alreadyLogged = order.timeline.some((t) => t.note && t.note.includes('Webhook'));
          if (!alreadyLogged) {
            order.timeline.push({
              status: order.orderStatus,
              timestamp,
              note: `Payment verified via Backend-to-Backend Razorpay Server Webhook (${paymentId || 'Captured'})`,
            });
          }

          await order.save();
          console.log(
            `[Webhook] SUCCESS: Order ${order.orderId} updated to Paid via Backend-to-Backend Webhook (User closed window protected!)`
          );
        } else {
          console.warn(`[Webhook] Could not find pending order in DB for rzpOrderId: ${rzpOrderId}, notesOrderId: ${notesOrderId}`);
        }
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payment?.entity;
      const rzpOrderId = paymentEntity?.order_id;
      const notesOrderId = paymentEntity?.notes?.orderId;

      const searchConditions = [];
      if (rzpOrderId) searchConditions.push({ razorpayOrderId: rzpOrderId });
      if (notesOrderId) searchConditions.push({ orderId: notesOrderId });

      if (searchConditions.length > 0) {
        const order = await Order.findOne({ $or: searchConditions });
        if (order && order.paymentStatus === 'Pending') {
          order.paymentStatus = 'Failed';
          order.timeline.push({
            status: 'Failed',
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
            note: `Payment failed: ${paymentEntity?.error_description || 'Transaction declined'}`,
          });
          await order.save();
          console.log(`[Webhook] Order ${order.orderId} marked as Failed due to payment failure`);
        }
      }
    }

    // Always respond 200 OK to Razorpay so they don't resend
    return res.status(200).json({ status: 'ok', received: true });
  } catch (error) {
    console.error('[Webhook Error]:', error);
    // Respond 200 to acknowledge webhook receipt even if error to prevent endless retry storms
    return res.status(200).json({ status: 'error', message: error.message });
  }
});

module.exports = router;