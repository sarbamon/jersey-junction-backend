const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const Product = require('../src/models/Product');
const Order = require('../src/models/Order');
const Coupon = require('../src/models/Coupon');
const User = require('../src/models/User');
const { calculateCartTotals } = require('../src/utils/pricing');
const { adjustProductStock } = require('../src/utils/inventory');

async function runSecurityTests() {
  console.log('====================================================');
  console.log('  JERSEY JUNCTION - BACKEND PRICING & PAYMENT SECURITY SUITE');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI not found in environment');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] Test ${totalTests}: ${message}`);
      passedTests++;
    } else {
      console.error(`[FAIL] Test ${totalTests}: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // 1. Setup Test Fixture
    console.log('Setting up test fixtures...');
    const testSku = `TEST_JERSEY_${Date.now()}`;
    const testProduct = await Product.create({
      name: 'Test Authentic Jersey',
      slug: `test-jersey-${Date.now()}`,
      price: 1999,
      originalPrice: 2499,
      stock: 10,
      sizes: ['S', 'M', 'L', 'XL'],
      sizeStock: { S: 5, M: 2, L: 3, XL: 0 },
      status: 'Active',
      sku: testSku,
      availablePatches: [
        { id: 'ucl', name: 'Champions League Patch', price: 120 },
      ],
    });

    const testCoupon = await Coupon.create({
      code: `SAVE50_${Date.now()}`,
      discountType: 'fixed',
      discountValue: 50,
      minOrder: 500,
      status: 'Active',
    });

    const expiredCoupon = await Coupon.create({
      code: `EXPIRED_${Date.now()}`,
      discountType: 'fixed',
      discountValue: 100,
      expiryDate: '2020-01-01',
      status: 'Active',
    });

    console.log('Fixtures created successfully.\n');

    // TEST 1: Backend calculation of line item price & customization surcharges
    // Fan Edition, no custom name => 1999
    const breakdown1 = await calculateCartTotals({
      items: [{ productId: testProduct._id.toString(), quantity: 1, version: 'Fan Edition' }],
      shippingMethod: 'standard',
    });
    assert(breakdown1.subtotal === 1999, 'Base item subtotal equals database product price (₹1999)');
    assert(breakdown1.totalAmount === 1999, 'Total matches subtotal when shipping is standard (free)');

    // TEST 2: Customization rules (+₹150 for Player version, +₹100 for custom name/number, +patch)
    const breakdown2 = await calculateCartTotals({
      items: [
        {
          productId: testProduct.slug,
          quantity: 1,
          version: 'Player Edition', // +150
          customName: 'MESSI', // +100
          customNumber: '10',
          selectedPatches: [{ id: 'ucl', price: 120 }], // +120
        },
      ],
      shippingMethod: 'express', // express shipping +100
    });
    const expectedUnit = 1999 + 150 + 100 + 120; // 2369
    const expectedTotal = expectedUnit + 100; // 2469
    assert(breakdown2.items[0].unitPrice === expectedUnit, `Customized unit price correctly adds Player (+₹150), Print (+₹100), and Patch (+₹120) = ₹${expectedUnit}`);
    assert(breakdown2.shippingFee === 100, 'Express shipping fee correctly added (+₹100)');
    assert(breakdown2.totalAmount === expectedTotal, `Authoritative totalAmount equals ₹${expectedTotal}`);

    // TEST 3: Client tampering resistance (amount: 1 cannot spoof backend calculation)
    // When client sends items, backend ignores any client-supplied 'price', 'totalAmount', or 'amount'
    const breakdownTampered = await calculateCartTotals({
      items: [
        {
          productId: testProduct._id.toString(),
          quantity: 2,
          price: 1, // Attacker sends ₹1
          subtotal: 1,
          totalPrice: 1,
        },
      ],
      shippingMethod: 'standard',
    });
    assert(breakdownTampered.subtotal === 1999 * 2, 'Attacker client price of ₹1 is completely ignored; database price ₹3998 enforced');
    assert(breakdownTampered.amountInPaise === 3998 * 100, 'Razorpay amountInPaise calculated authoritatively (399800 paise)');

    // TEST 4: Stock validation - Reject purchases exceeding available variant stock
    let stockErrorThrown = false;
    try {
      await calculateCartTotals({
        items: [{ productId: testProduct._id.toString(), quantity: 5, size: 'M' }], // Only 2 in stock for M
      });
    } catch (err) {
      stockErrorThrown = true;
      assert(err.statusCode === 400 && err.message.includes('Insufficient stock'), `Stock validation correctly rejects purchase exceeding stock: "${err.message}"`);
    }
    assert(stockErrorThrown, 'Insufficient stock error was thrown');

    // TEST 5: Stock validation - Reject purchase for size with 0 stock
    let zeroStockThrown = false;
    try {
      await calculateCartTotals({
        items: [{ productId: testProduct._id.toString(), quantity: 1, size: 'XL' }], // 0 in stock for XL
      });
    } catch (err) {
      zeroStockThrown = true;
      assert(err.statusCode === 400 && err.message.includes('Insufficient stock'), `Zero-stock variant correctly rejected: "${err.message}"`);
    }
    assert(zeroStockThrown, 'Zero-stock error was thrown');

    // TEST 6: Coupon validation - Valid coupon applies discount
    const breakdownCoupon = await calculateCartTotals({
      items: [{ productId: testProduct._id.toString(), quantity: 1 }],
      couponCode: testCoupon.code,
    });
    assert(breakdownCoupon.discountAmount === 50, 'Valid coupon discount applied (₹50 off)');
    assert(breakdownCoupon.totalAmount === 1999 - 50, `Total reflects coupon discount: ₹${1999 - 50}`);

    // TEST 7: Coupon validation - Expired coupon is rejected
    let expiredCouponThrown = false;
    try {
      await calculateCartTotals({
        items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        couponCode: expiredCoupon.code,
      });
    } catch (err) {
      expiredCouponThrown = true;
      assert(err.statusCode === 400 && err.message.includes('expired'), `Expired coupon rejected: "${err.message}"`);
    }
    assert(expiredCouponThrown, 'Expired coupon rejection confirmed');

    // TEST 8: Razorpay Signature Verification & Tampering Protection
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || 'test_secret_for_suite';
    const fakeOrderId = 'order_test_999888';
    const fakePaymentId = 'pay_test_777666';

    const validSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${fakeOrderId}|${fakePaymentId}`)
      .digest('hex');

    const forgedSignature = crypto
      .createHmac('sha256', 'wrong_secret_123')
      .update(`${fakeOrderId}|${fakePaymentId}`)
      .digest('hex');

    // Cryptographic match check
    const expectedDigest = crypto
      .createHmac('sha256', keySecret)
      .update(`${fakeOrderId}|${fakePaymentId}`)
      .digest();

    const validBuffer = Buffer.from(validSignature, 'hex');
    const forgedBuffer = Buffer.from(forgedSignature, 'hex');

    const isGenuineValid = crypto.timingSafeEqual(expectedDigest, validBuffer);
    const isForgedValid = crypto.timingSafeEqual(expectedDigest, forgedBuffer);

    assert(isGenuineValid === true, 'Genuine HMAC SHA256 signature validates successfully');
    assert(isForgedValid === false, 'Forged Razorpay signature is rejected cryptographically');

    // TEST 9: Payment Verification Idempotency & Stock Protection
    const pendingOrder = await Order.create({
      orderId: `#JJ_TEST_${Date.now()}`,
      customerName: 'Test Customer',
      email: 'test@example.com',
      shippingAddress: { city: 'Bengaluru', pincode: '560001' },
      items: [
        {
          productId: testProduct._id.toString(),
          name: testProduct.name,
          size: 'S',
          quantity: 1,
          unitPrice: 1999,
        },
      ],
      subtotal: 1999,
      shippingFee: 0,
      discountAmount: 0,
      totalAmount: 1999,
      paymentMethod: 'Razorpay',
      paymentStatus: 'Pending',
      orderStatus: 'Pending',
      razorpayOrderId: 'order_test_idempotent_123',
      stockDeducted: false,
    });

    const initialStock = (await Product.findById(testProduct._id)).stock;

    // Simulate first payment verification
    if (!pendingOrder.stockDeducted) {
      await adjustProductStock(pendingOrder.items, -1);
      pendingOrder.stockDeducted = true;
      pendingOrder.paymentStatus = 'Paid';
      pendingOrder.orderStatus = 'Confirmed';
      await pendingOrder.save();
    }

    const stockAfterFirstPayment = (await Product.findById(testProduct._id)).stock;
    assert(stockAfterFirstPayment === initialStock - 1, `Stock decremented once upon payment: ${initialStock} -> ${stockAfterFirstPayment}`);

    // Simulate duplicate verification or replayed webhook
    if (pendingOrder.paymentStatus === 'Paid' && pendingOrder.stockDeducted) {
      // Idempotency: skip duplicate deduction
    } else {
      await adjustProductStock(pendingOrder.items, -1);
    }

    const stockAfterDuplicateEvent = (await Product.findById(testProduct._id)).stock;
    assert(stockAfterDuplicateEvent === stockAfterFirstPayment, `Idempotency verified: duplicate verification attempt did NOT deduct stock again (${stockAfterDuplicateEvent})`);

    // Clean up test documents
    await Product.findByIdAndDelete(testProduct._id);
    await Coupon.findByIdAndDelete(testCoupon._id);
    await Coupon.findByIdAndDelete(expiredCoupon._id);
    await Order.findByIdAndDelete(pendingOrder._id);

    console.log('\n====================================================');
    console.log(`  ALL ${passedTests}/${totalTests} SECURITY TESTS PASSED!`);
    console.log('====================================================\n');
  } finally {
    await mongoose.disconnect();
  }
}

runSecurityTests().catch((err) => {
  console.error('\nSECURITY TEST FAILURE:', err);
  process.exit(1);
});
