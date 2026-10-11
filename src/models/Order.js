const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: String,
  name: String,
  size: String,
  version: String,
  customName: String,
  customNumber: String,
  quantity: Number,
  unitPrice: Number,
  image: String,
});

const timelineSchema = new mongoose.Schema({
  status: String,
  timestamp: String,
  note: String,
});

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      default: '',
    },
    shippingAddress: {
      name: String,
      email: String,
      phone: String,
      addressLine: String,
      city: String,
      state: String,
      pincode: String,
      country: String,
    },
    items: [orderItemSchema],
    subtotal: {
      type: Number,
      required: true,
    },
    shippingFee: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      default: 'Credit Card',
    },
    paymentStatus: {
      type: String,
      enum: ['Paid', 'Pending', 'COD', 'Failed', 'Refunded'],
      default: 'Paid',
    },
    orderStatus: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'],
      default: 'Confirmed',
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0],
    },
    razorpayOrderId: {
      type: String,
      default: '',
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      default: '',
    },
    stockDeducted: {
      type: Boolean,
      default: false,
    },
    timeline: [timelineSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Order', orderSchema);
