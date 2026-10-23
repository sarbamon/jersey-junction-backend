const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const User = require('../models/User');
const { adjustProductStock } = require('../utils/inventory');
const { calculateCartTotals } = require('../utils/pricing');

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

// POST /api/payment/calculate-summary
// Authoritative price calculation endpoint for Cart, Checkout, and Buy Now
router.post('/calculate-summary', async (req, res, next) => {
  try {
    const { items, shippingMethod, couponCode } = req.body;

    const summary = await calculateCartTotals({
      items,
      shippingMethod,
      couponCode,
    });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Error calculating order totals',
    });
  }
});

// POST /api/payment/create-order
// SECURE RAZORPAY ORDER CREATION:
// 1. Authoritatively calculates order subtotal, customization surcharges, coupons, and shipping on the backend.
// 2. Ignores any client-submitted 'amount' or 'price'.
// 3. Creates the Razorpay order using server-calculated integer paise.
// 4. Pre-creates the Pending Order in MongoDB with verified items and prices.
router.post('/create-order', async (req, res) => {
  try {
    const { orderData } = req.body;
    const clientItems = req.body.items || orderData?.items || [];
    const clientShippingMethod = req.body.shippingMethod || orderData?.shippingMethod || 'standard';
    const clientCouponCode = req.body.couponCode || orderData?.couponCode || '';

    const customerEmail = (orderData?.email || req.body.email || '').trim().toLowerCase();
    const customerName = (orderData?.customerName || req.body.customerName || 'Customer').trim();
    const customerPhone = (orderData?.phone || req.body.phone || '').trim();
    const shippingAddress = orderData?.shippingAddress || req.body.shippingAddress || {};

    if (customerEmail) {
      const registeredUser = await User.findOne({ email: customerEmail });
      if (!registeredUser) {
        return res.status(401).json({
          success: false,
          message: 'Account required. Please sign in or register to place an order.',
        });
      }
    }

    // Backend authoritative calculation
    let breakdown;
    try {
      breakdown = await calculateCartTotals({
        items: clientItems,
        shippingMethod: clientShippingMethod,
        couponCode: clientCouponCode,
      });
    } catch (calcErr) {
      return res.status(calcErr.statusCode || 400).json({
        success: false,
        message: calcErr.message || 'Invalid cart or pricing configuration',
      });
    }

    if (!breakdown || breakdown.amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Order total must be greater than ₹0',
      });
    }

    const currency = 'INR';
    const razorpay = getRazorpayInstance();
    const receiptId = `rcpt_${Date.now()}`;
    const internalOrderId = orderData?.id || `#JJ${Math.floor(1000 + Math.random() * 9000)}`;

    const rzpOrder = await razorpay.orders.create({
      amount: breakdown.amountInPaise,
      currency,
      receipt: receiptId,
      notes: {
        orderId: internalOrderId,
        email: customerEmail,
        customerName: customerName,
      },
    });

    // Store authoritative Pending Order in MongoDB
    const orderDoc = {
      orderId: internalOrderId,
      customerName: customerName,
      email: customerEmail,
      phone: customerPhone,
      shippingAddress: shippingAddress,
      items: breakdown.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        size: item.size,
        version: item.version,
        customName: item.customName,
        customNumber: item.customNumber,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        image: item.image,
      })),
      subtotal: breakdown.subtotal,
      shippingFee: breakdown.shippingFee,
      discountAmount: breakdown.discountAmount,
      totalAmount: breakdown.totalAmount,
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
          note: `Payment initiated via Razorpay (Order ID: ${rzpOrder.id}, Amount: ₹${breakdown.totalAmount})`,
        },
      ],
    };

    const createdMongoOrder = await Order.findOneAndUpdate(
      { orderId: internalOrderId },
      { $set: orderDoc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[Payment] Pre-created verified Pending order: ${internalOrderId} for Razorpay order ${rzpOrder.id} (₹${breakdown.totalAmount})`);

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();

    res.json({
      success: true,
      data: rzpOrder,
      keyId,
      internalOrderId,
      order: createdMongoOrder,
      breakdown,
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
// Frontend verification callback when user completes Razorpay payment
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
        message: 'Payment verification is not configured on server',
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
        message: 'Invalid payment signature format',
      });
    }

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Payment signature verification failed. Forged or mismatched signature.',
      });
    }

    // Signature verified! Confirm the pending order in MongoDB
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `No pending order found for Razorpay order ID ${razorpay_order_id}`,
      });
    }

    // Idempotency: if already paid, return early without re-deducting stock or adding duplicate timeline entries
    if (order.paymentStatus === 'Paid') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and order confirmed',
        paymentId: order.razorpayPaymentId || razorpay_payment_id,
        orderId: order.orderId,
      });
    }

    order.razorpayPaymentId = razorpay_payment_id;
    order.paymentStatus = 'Paid';
    if (order.orderStatus === 'Pending') {
      order.orderStatus = 'Confirmed';
    }

    // Atomically deduct stock once
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
    console.log(`[Payment] Order ${order.orderId} successfully marked Paid via verified signature`);

    return res.json({
      success: true,
      message: 'Payment signature verified successfully',
      paymentId: razorpay_payment_id,
      orderId: order.orderId,
      razorpayOrderId: razorpay_order_id,
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
          // Idempotency check: if already paid, do nothing
          if (order.paymentStatus === 'Paid') {
            console.log(`[Webhook] Order ${order.orderId} is already marked as Paid. Skipping re-processing.`);
            return res.status(200).json({ status: 'ok', alreadyProcessed: true });
          }

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
            `[Webhook] SUCCESS: Order ${order.orderId} updated to Paid via Backend-to-Backend Webhook`
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
    return res.status(200).json({ status: 'error', message: error.message });
  }
});

/**
 * Direct Razorpay API Reconciliation:
 * Queries Razorpay REST API for order status.
 * If user paid but closed tab / lost connection or localhost webhook wasn't delivered,
 * this directly confirms with Razorpay's servers.
 */
const reconcileRazorpayOrder = async (order) => {
  if (!order || !order.razorpayOrderId) return order;
  if (order.paymentStatus === 'Paid') return order;

  try {
    const razorpay = getRazorpayInstance();
    const rzpOrder = await razorpay.orders.fetch(order.razorpayOrderId);

    if (rzpOrder.status === 'paid' || (rzpOrder.amount_paid && rzpOrder.amount_paid >= rzpOrder.amount)) {
      const payments = await razorpay.orders.fetchPayments(order.razorpayOrderId);
      const successfulPayment = (payments.items || []).find(
        (p) => p.status === 'captured' || p.status === 'authorized'
      );
      const paymentId = successfulPayment ? successfulPayment.id : (payments.items?.[0]?.id || 'RZP_RECONCILED');

      order.paymentStatus = 'Paid';
      if (order.orderStatus === 'Pending') {
        order.orderStatus = 'Confirmed';
      }
      order.razorpayPaymentId = paymentId;

      if (!order.stockDeducted) {
        await adjustProductStock(order.items, -1);
        order.stockDeducted = true;
      }

      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      if (!order.timeline.some((t) => t.note && t.note.includes(paymentId))) {
        order.timeline.push({
          status: order.orderStatus,
          timestamp,
          note: `Payment verified via Razorpay API Sync (Payment ID: ${paymentId})`,
        });
      }

      await order.save();
      console.log(`[Reconciliation] Order ${order.orderId} successfully synced from Razorpay API -> Paid (${paymentId})`);
    }
  } catch (err) {
    console.warn(`[Reconciliation] Note: Razorpay sync for ${order.orderId}:`, err.message);
  }

  return order;
};

// POST /api/payment/sync/:orderId
// Direct sync endpoint to check and reconcile payment status with Razorpay
router.post('/sync/:orderId', async (req, res) => {
  try {
    const rawId = req.params.orderId;
    const formattedSearch = rawId.startsWith('#') ? rawId : `#${rawId}`;

    const order = await Order.findOne({
      $or: [
        { orderId: rawId },
        { orderId: formattedSearch },
        { razorpayOrderId: rawId },
      ],
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updated = await reconcileRazorpayOrder(order);

    res.status(200).json({
      success: true,
      message: updated.paymentStatus === 'Paid' ? 'Order payment confirmed with Razorpay' : 'Order payment status unchanged (Pending on Razorpay)',
      order: {
        orderId: updated.orderId,
        paymentStatus: updated.paymentStatus,
        orderStatus: updated.orderStatus,
        razorpayPaymentId: updated.razorpayPaymentId,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.reconcileRazorpayOrder = reconcileRazorpayOrder;

module.exports = router;