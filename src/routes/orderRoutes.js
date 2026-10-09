const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// Helper to format backend Mongo order to frontend object
const formatOrder = (order) => ({
  id: order.orderId || order._id.toString(),
  customerName: order.customerName,
  email: order.email,
  phone: order.phone,
  shippingAddress: order.shippingAddress,
  items: order.items,
  subtotal: order.subtotal,
  shippingFee: order.shippingFee,
  discountAmount: order.discountAmount,
  totalAmount: order.totalAmount,
  paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus,
  orderStatus: order.orderStatus,
  date: order.date,
  timeline: order.timeline || [],
});

// GET /api/orders - Get all orders (for Admin Orders page)
router.get('/', async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders.map(formatOrder),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/orders/user/:email - Get orders by user email
router.get('/user/:email', async (req, res, next) => {
  try {
    const email = req.params.email.toLowerCase();
    const orders = await Order.find({ email }).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders.map(formatOrder),
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

    res.status(200).json({
      success: true,
      data: formatOrder(order),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/orders - Create a new order
router.post('/', async (req, res, next) => {
  try {
    const {
      id,
      customerName,
      email,
      phone,
      shippingAddress,
      items,
      subtotal,
      shippingFee,
      discountAmount,
      totalAmount,
      paymentMethod,
      paymentStatus,
      orderStatus,
      date,
      timeline,
    } = req.body;

    const orderId = id || `#JJ${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder = await Order.create({
      orderId,
      customerName,
      email: email ? email.toLowerCase() : '',
      phone: phone || '',
      shippingAddress,
      items,
      subtotal,
      shippingFee: shippingFee || 0,
      discountAmount: discountAmount || 0,
      totalAmount,
      paymentMethod: paymentMethod || 'Credit Card',
      paymentStatus: paymentStatus || 'Paid',
      orderStatus: orderStatus || 'Confirmed',
      date: date || new Date().toISOString().split('T')[0],
      timeline: timeline || [
        {
          status: 'Confirmed',
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
          note: 'Order placed & payment verified successfully',
        },
      ],
    });

    res.status(201).json({
      success: true,
      data: formatOrder(newOrder),
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/orders/:id/status - Update order status
router.patch('/:id/status', async (req, res, next) => {
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

// DELETE /api/orders/:id - Delete an order by ID
router.delete('/:id', async (req, res, next) => {
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

// DELETE /api/orders - Delete all orders
router.delete('/', async (req, res, next) => {
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
