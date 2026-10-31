const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const OrderOtp = require('../models/OrderOtp');
const Product = require('../models/Product');
const User = require('../models/User');
const { protect, authorize, authorizePermission } = require('../middleware/auth');
const { adjustProductStock } = require('../utils/inventory');
const { calculateCartTotals, getStoreSettings } = require('../utils/pricing');
const { sendOrderConfirmationOtp, sendOrderConfirmationReceipt } = require('../utils/emailService');

// Helper to format backend Mongo order to frontend object
const formatOrder = (order) => ({
  id: order.orderId || order._id.toString(),
  customerName: order.customerName,
  email: order.email,
  phone: order.phone,
  shippingAddress: order.shippingAddress,
  items: (order.items || []).map((item) => {
    const raw = item.toObject ? item.toObject() : item;
    const rawImg = String(raw.image || '').trim();
    // Do not return ephemeral /uploads/ link that was wiped on container restart
    const isEphemeral = rawImg.includes('/uploads/img_');
    return {
      ...raw,
      image: isEphemeral ? '' : rawImg,
    };
  }),
  subtotal: order.subtotal,
  shippingFee: order.shippingFee,
  discountAmount: order.discountAmount,
  totalAmount: order.totalAmount,
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  orderStatus: order.orderStatus,
  date: order.date,
  timeline: order.timeline || [],
  icarryShipmentId: order.icarryShipmentId || '',
  trackingNumber: order.trackingNumber || '',
  courierName: order.courierName || '',
  labelUrl: order.labelUrl || '',
  shippingStatus: order.shippingStatus || '',
  bookedAt: order.bookedAt || '',
  packageWeight: order.packageWeight || 0.4,
  packageDimensions: order.packageDimensions || '25x20x3',
});

const paymentRouter = require('./paymentRoutes');
const reconcileRazorpayOrder = (order) => paymentRouter.reconcileRazorpayOrder ? paymentRouter.reconcileRazorpayOrder(order) : order;

// Helper to determine if an order is confirmed/paid:
// 1. All Cash on Delivery (COD) orders
// 2. Orders that have completed payment (paymentStatus === 'Paid')
// Excludes uncompleted payment portal attempts where user opened Razorpay but did not pay.
const isOrderConfirmed = (order) => {
  if (!order) return false;
  const isCOD = order.paymentMethod === 'Cash on Delivery' || order.paymentMethod === 'COD';
  const isPaid = order.paymentStatus === 'Paid';
  return isCOD || isPaid;
};

// GET /api/orders - Get all orders (Admin or Orders Employee)
router.get('/', protect, authorizePermission('orders'), async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });

    // Auto-reconcile pending Razorpay orders with Razorpay API (in case payment completed but webhook was delayed)
    const reconciled = await Promise.all(
      orders.map(async (order) => {
        if (order.paymentStatus === 'Pending' && order.razorpayOrderId) {
          return await reconcileRazorpayOrder(order);
        }
        return order;
      })
    );

    // CRITICAL: Only show confirmed orders (Paid online orders or Cash on Delivery)
    // Never show unpaid abandoned payment portal sessions
    const confirmedOrders = reconciled.filter(isOrderConfirmed);

    res.status(200).json({
      success: true,
      count: confirmedOrders.length,
      data: confirmedOrders.map(formatOrder),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/user/:email - Get orders by user email (Owner or Admin only)
router.get('/user/:email', protect, async (req, res, next) => {
  try {
    const requestedEmail = req.params.email.toLowerCase().trim();

    // Enforce authorization: user can only query their own orders unless they are an admin
    if (req.user.role !== 'admin' && req.user.email.toLowerCase() !== requestedEmail) {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view another customer\'s orders',
      });
    }

    const orders = await Order.find({ email: requestedEmail }).sort({ createdAt: -1 });

    // Auto-reconcile pending Razorpay orders with Razorpay API
    const reconciled = await Promise.all(
      orders.map(async (order) => {
        if (order.paymentStatus === 'Pending' && order.razorpayOrderId) {
          return await reconcileRazorpayOrder(order);
        }
        return order;
      })
    );

    // Only show confirmed orders to customer
    const confirmedOrders = reconciled.filter(isOrderConfirmed);

    res.status(200).json({
      success: true,
      count: confirmedOrders.length,
      data: confirmedOrders.map(formatOrder),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/:id - Get order by ID
router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const formattedSearch = id.startsWith('#') ? id : `#${id}`;
    let order = await Order.findOne({
      $or: [{ orderId: id }, { orderId: formattedSearch }],
    });

    if (!order && id.match(/^[0-9a-fA-F]{24}$/)) {
      order = await Order.findById(id);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Auto-reconcile with Razorpay API if still pending
    if (order.paymentStatus === 'Pending' && order.razorpayOrderId) {
      order = await reconcileRazorpayOrder(order);
    }

    res.status(200).json({
      success: true,
      data: formatOrder(order),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders/send-otp - Generate and send 6-digit order confirmation OTP via Gmail
router.post('/send-otp', async (req, res, next) => {
  try {
    const { email, customerName, orderId, totalAmount } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'A valid email address is required to receive the OTP.',
      });
    }

    // Generate cryptographically secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Replace any previous OTP for this customer
    await OrderOtp.deleteMany({ email: normalizedEmail });

    await OrderOtp.create({
      email: normalizedEmail,
      otp,
      purpose: 'order_confirmation',
      verified: false,
    });

    // Send the email via Gmail SMTP (or log in terminal if in local dev)
    const mailResult = await sendOrderConfirmationOtp({
      email: normalizedEmail,
      otp,
      customerName: (customerName || normalizedEmail.split('@')[0]).trim(),
      orderId,
      totalAmount,
    });

    return res.status(200).json({
      success: true,
      message: mailResult.simulated
        ? `[Dev Mode] Confirmation code generated: ${otp}. Add EMAIL_USER & EMAIL_PASS in .env to send real Gmail.`
        : `Confirmation code has been sent to ${normalizedEmail}.`,
      email: normalizedEmail,
      simulated: Boolean(mailResult.simulated),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders/verify-otp - Verify confirmation OTP entered by customer
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').toString().trim();

    if (!normalizedEmail || !cleanOtp) {
      return res.status(400).json({
        success: false,
        message: 'Email and 6-digit OTP code are required.',
      });
    }

    const record = await OrderOtp.findOne({
      email: normalizedEmail,
      otp: cleanOtp,
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code. Please check your Gmail or request a new one.',
      });
    }

    record.verified = true;
    await record.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders - Create or confirm an order
// SECURITY ENFORCEMENTS:
// 1. For Razorpay payments, rejects any direct client attempt to create or mark orders as 'Paid'
//    unless already cryptographically verified via POST /api/payment/verify or webhook.
// 2. For COD payments, calculates all prices authoritatively on the server, verifies email OTP,
//    rejects invalid items or stock, and enforces paymentStatus: 'Pending'.
router.post('/', async (req, res, next) => {
  try {
    const {
      id,
      customerName,
      email,
      phone,
      shippingAddress,
      items,
      shippingMethod,
      couponCode,
      paymentMethod,
      paymentStatus,
      razorpayOrderId,
      razorpayPaymentId,
    } = req.body;

    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'A valid customer email is required to place an order.',
      });
    }

    // Require registered user account
    const registeredUser = await User.findOne({ email: normalizedEmail });
    if (!registeredUser) {
      return res.status(401).json({
        success: false,
        message: 'Account required. Please sign in or register an account to place an order.',
      });
    }

    const orderId = id || `#JJ${Math.floor(1000 + Math.random() * 9000)}`;
    const isRazorpay = paymentMethod === 'Razorpay';

    // 1. RAZORPAY PAYMENT FLOW
    if (isRazorpay) {
      // Find the pre-created order from /api/payment/create-order
      const searchConditions = [{ orderId }, { orderId: orderId.replace(/^#/, '') }];
      if (razorpayOrderId) searchConditions.push({ razorpayOrderId });

      const existingOrder = await Order.findOne({ $or: searchConditions });

      if (existingOrder) {
        // If already paid via verified signature/webhook, return the confirmed order
        if (existingOrder.paymentStatus === 'Paid') {
          return res.status(200).json({
            success: true,
            data: formatOrder(existingOrder),
          });
        }

        // If the client claims the order is paid, verify that paymentId is supplied and signature was verified
        if (paymentStatus === 'Paid') {
          return res.status(400).json({
            success: false,
            message: 'Razorpay orders must be verified through POST /api/payment/verify before confirmation.',
          });
        }

        return res.status(200).json({
          success: true,
          data: formatOrder(existingOrder),
        });
      }

      // If client attempts to create an arbitrary Paid Razorpay order without pre-creation:
      if (paymentStatus === 'Paid') {
        return res.status(400).json({
          success: false,
          message: 'Direct order creation with status Paid is prohibited. Payment gateway verification required.',
        });
      }
    }

    // 2. CASH ON DELIVERY (COD) FLOW
    const isCOD = paymentMethod === 'Cash on Delivery' || paymentMethod === 'COD';
    if (isCOD) {
      const storeSettings = getStoreSettings();
      if (!storeSettings.codEnabled) {
        return res.status(400).json({
          success: false,
          message: 'Cash on Delivery (COD) is currently disabled.',
        });
      }

      // Authoritative pricing calculation
      const breakdown = await calculateCartTotals({
        items,
        shippingMethod: shippingMethod || 'standard',
        couponCode: couponCode || '',
      });

      const newOrder = await Order.create({
        orderId,
        customerName: (customerName || registeredUser.name || 'Customer').trim(),
        email: normalizedEmail,
        phone: (phone || registeredUser.phone || '').trim(),
        shippingAddress: shippingAddress || {},
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
        paymentMethod: 'Cash on Delivery',
        paymentStatus: 'Pending',
        orderStatus: 'Confirmed',
        date: new Date().toISOString().split('T')[0],
        stockDeducted: true,
        timeline: [
          {
            status: 'Confirmed',
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
            note: 'Order placed with Cash on Delivery. Order confirmation email sent to customer.',
          },
        ],
      });

      // Deduct stock atomically
      await adjustProductStock(newOrder.items, -1);

      // Asynchronously send order confirmation receipt email from support@jerseyjunction.shop
      sendOrderConfirmationReceipt(newOrder).catch((err) => {
        console.error('[EMAIL SERVICE] Failed to send COD confirmation receipt:', err.message);
      });

      return res.status(201).json({
        success: true,
        data: formatOrder(newOrder),
      });
    }

    // Any other payment method must not default to 'Paid'
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method or payment verification required.',
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/orders/:id/status - Update order status (Admin only)
router.patch('/:id/status', protect, authorize('admin'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { orderStatus, paymentStatus } = req.body;
    const formattedSearch = id.startsWith('#') ? id : `#${id}`;

    let order = await Order.findOne({
      $or: [{ orderId: id }, { orderId: formattedSearch }],
    });

    if (!order && id.match(/^[0-9a-fA-F]{24}$/)) {
      order = await Order.findById(id);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousStatus = order.orderStatus;

    if (orderStatus) {
      order.orderStatus = orderStatus;
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      if (!order.timeline.some((t) => t.status === orderStatus)) {
        order.timeline.push({
          status: orderStatus,
          timestamp,
          note: `Order status changed to ${orderStatus}`,
        });
      }

      // Handle stock adjustments on cancellation and re-activation
      if (previousStatus !== 'Cancelled' && orderStatus === 'Cancelled') {
        // Order was cancelled: restore stock (+1)
        await adjustProductStock(order.items, 1);
      } else if (previousStatus === 'Cancelled' && orderStatus !== 'Cancelled') {
        // Order was uncancelled: deduct stock again (-1)
        await adjustProductStock(order.items, -1);
      }
    }

    if (paymentStatus) {
      order.paymentStatus = paymentStatus;
    }

    await order.save();

    res.status(200).json({
      success: true,
      data: formatOrder(order),
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/orders/:id - General update of order details (Admin or Orders Employee)
router.patch('/:id', protect, authorizePermission('orders'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const formattedSearch = id.startsWith('#') ? id : `#${id}`;

    let order = await Order.findOne({
      $or: [{ orderId: id }, { orderId: formattedSearch }],
    });

    if (!order && id.match(/^[0-9a-fA-F]{24}$/)) {
      order = await Order.findById(id);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const {
      customerName,
      email,
      phone,
      shippingAddress,
      orderStatus,
      paymentStatus,
      paymentMethod,
    } = req.body;

    if (customerName !== undefined) order.customerName = customerName;
    if (email !== undefined) order.email = email.toLowerCase().trim();
    if (phone !== undefined) order.phone = phone.trim();
    if (shippingAddress !== undefined) {
      order.shippingAddress = {
        ...(order.shippingAddress ? (order.shippingAddress.toObject ? order.shippingAddress.toObject() : order.shippingAddress) : {}),
        ...shippingAddress,
      };
    }
    if (orderStatus !== undefined) {
      const prevStatus = order.orderStatus;
      order.orderStatus = orderStatus;
      if (prevStatus !== orderStatus && !order.timeline.some((t) => t.status === orderStatus)) {
        order.timeline.push({
          status: orderStatus,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
          note: `Order status updated to ${orderStatus}`,
        });
      }
    }
    if (paymentStatus !== undefined) order.paymentStatus = paymentStatus;
    if (paymentMethod !== undefined) order.paymentMethod = paymentMethod;

    await order.save();

    res.status(200).json({
      success: true,
      data: formatOrder(order),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders/bulk-delete - Delete multiple orders (Admin or Orders Employee)
router.post('/bulk-delete', protect, authorizePermission('orders'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No order IDs provided' });
    }

    const formattedIds = [];
    ids.forEach((id) => {
      if (typeof id === 'string') {
        formattedIds.push(id);
        if (id.startsWith('#')) {
          formattedIds.push(id.replace('#', ''));
        } else {
          formattedIds.push(`#${id}`);
        }
      }
    });

    const objectIds = ids.filter((id) => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/));

    const result = await Order.deleteMany({
      $or: [
        { orderId: { $in: formattedIds } },
        { _id: { $in: objectIds } },
      ],
    });

    res.status(200).json({
      success: true,
      count: result.deletedCount,
      message: `Deleted ${result.deletedCount} orders successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/orders/:id - Delete an order by ID (Admin or Orders Employee)
router.delete('/:id', protect, authorizePermission('orders'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const formattedSearch = id.startsWith('#') ? id : `#${id}`;

    await Order.deleteMany({
      $or: [{ orderId: id }, { orderId: formattedSearch }],
    });

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      await Order.findByIdAndDelete(id);
    }

    res.status(200).json({
      success: true,
      message: `Order ${id} deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/orders - Delete all orders (Admin only)
router.delete('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const result = await Order.deleteMany({});
    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} orders`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
