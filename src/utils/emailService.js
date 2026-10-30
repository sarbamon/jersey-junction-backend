const nodemailer = require('nodemailer');

/**
 * Returns a configured Nodemailer transporter for Gmail SMTP.
 * Reads EMAIL_USER and EMAIL_PASS (or GMAIL_USER / GMAIL_APP_PASSWORD) from environment variables.
 */
const getTransporter = () => {
  const user = (process.env.EMAIL_USER || process.env.GMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  });
};

/**
 * Sends an OTP email to the customer's Gmail for order confirmation.
 */
const sendOrderConfirmationOtp = async ({ email, otp, customerName, orderId, totalAmount }) => {
  const cleanEmail = (email || '').trim().toLowerCase();
  const transporter = getTransporter();
  const senderEmail = (process.env.EMAIL_USER || process.env.GMAIL_USER || 'no-reply@jerseyjunction.com').trim();
  const senderName = process.env.EMAIL_FROM_NAME || 'Jersey Junction';

  // Development / fallback mode when Gmail credentials are not configured yet
  if (!transporter) {
    console.log('\n============================================================');
    console.log(`[EMAIL SERVICE] Gmail credentials not configured in .env.`);
    console.log(`[SIMULATED OTP] To: ${cleanEmail}`);
    console.log(`[SIMULATED OTP] Code: >>> ${otp} <<< (Valid for 10 minutes)`);
    if (orderId) console.log(`[SIMULATED OTP] Order ID: ${orderId}`);
    if (totalAmount) console.log(`[SIMULATED OTP] Total Amount: ₹${totalAmount}`);
    console.log('============================================================\n');
    return { success: true, simulated: true, otp };
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirm Your Jersey Junction Order</title>
      <style>
        body { margin: 0; padding: 0; background-color: #0c0c0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; }
        .container { max-width: 580px; margin: 0 auto; background-color: #141416; border-radius: 16px; overflow: hidden; border: 1px solid #28282c; }
        .header { background-color: #050505; padding: 32px 24px; text-align: center; border-bottom: 2px solid #C99682; }
        .brand { font-size: 24px; font-weight: 900; letter-spacing: 3px; color: #ffffff; text-transform: uppercase; margin: 0; }
        .brand span { color: #C99682; }
        .body { padding: 36px 32px; text-align: center; }
        .title { font-size: 20px; font-weight: 700; color: #ffffff; margin-top: 0; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { font-size: 14px; color: #a1a1aa; line-height: 1.6; margin-bottom: 28px; }
        .otp-box { background: #1f1f23; border: 2px dashed #C99682; border-radius: 12px; padding: 20px 24px; margin: 0 auto 28px; display: inline-block; }
        .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #C99682; margin: 0; padding-left: 10px; }
        .meta-info { font-size: 13px; color: #71717a; margin-bottom: 24px; }
        .note { font-size: 12px; color: #71717a; border-top: 1px solid #28282c; padding-top: 20px; line-height: 1.5; }
        .footer { background-color: #09090b; padding: 20px 24px; text-align: center; font-size: 12px; color: #52525b; border-top: 1px solid #28282c; }
      </style>
    </head>
    <body>
      <div style="padding: 24px 12px;">
        <div class="container">
          <div class="header">
            <h1 class="brand">JERSEY <span>JUNCTION</span></h1>
          </div>
          <div class="body">
            <h2 class="title">ORDER CONFIRMATION CODE</h2>
            <p class="subtitle">
              Hello <strong>${customerName || 'Customer'}</strong>,<br/>
              Use the single-use OTP below to confirm your order${orderId ? ` (<strong>${orderId}</strong>)` : ''}.
            </p>
            
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>

            <p class="meta-info">
              ⏱ Valid for <strong>10 minutes</strong>. Do not share this code with anyone.
            </p>

            ${totalAmount ? `<p style="font-size: 13px; color: #d4d4d8; margin-bottom: 20px;">Order Amount: <strong style="color: #ffffff;">₹${Number(totalAmount).toLocaleString('en-IN')}</strong></p>` : ''}

            <div class="note">
              If you did not request this order confirmation code, please ignore this email or contact support.
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Jersey Junction. Authentic Football Jerseys & Performance Gear.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: cleanEmail,
      subject: `Your Jersey Junction Order Confirmation OTP: ${otp}`,
      html,
    });
    console.log(`[EMAIL SERVICE] OTP email delivered to ${cleanEmail}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EMAIL SERVICE] Failed to deliver OTP email to ${cleanEmail}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sends a full Order Confirmation receipt email to the customer upon order confirmation.
 */
const sendOrderConfirmationReceipt = async (order) => {
  const cleanEmail = (order?.email || '').trim().toLowerCase();
  if (!cleanEmail) return { success: false, error: 'No recipient email provided' };

  const transporter = getTransporter();
  const senderEmail = (process.env.EMAIL_USER || process.env.GMAIL_USER || 'no-reply@jerseyjunction.com').trim();
  const senderName = process.env.EMAIL_FROM_NAME || 'Jersey Junction';

  if (!transporter) {
    console.log('\n============================================================');
    console.log(`[EMAIL SERVICE] Simulated Order Confirmation Receipt:`);
    console.log(`[SIMULATED EMAIL] To: ${cleanEmail}`);
    console.log(`[SIMULATED EMAIL] Order ID: ${order.orderId || order.id}`);
    console.log(`[SIMULATED EMAIL] Total: ₹${order.totalAmount}`);
    console.log(`[SIMULATED EMAIL] Items: ${(order.items || []).length} jersey(s)`);
    console.log('============================================================\n');
    return { success: true, simulated: true };
  }

  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <tr style="border-bottom: 1px solid #28282c;">
        <td style="padding: 12px 8px; font-size: 14px; color: #ffffff;">
          <strong>${item.name}</strong><br/>
          <span style="font-size: 12px; color: #a1a1aa;">
            Size: ${item.size || 'M'} ${item.version ? `| ${item.version}` : ''}
            ${item.customName ? `| Custom: ${item.customName} #${item.customNumber || ''}` : ''}
          </span>
        </td>
        <td style="padding: 12px 8px; font-size: 14px; text-align: center; color: #d4d4d8;">
          ${item.quantity || 1}
        </td>
        <td style="padding: 12px 8px; font-size: 14px; text-align: right; color: #C99682; font-weight: bold;">
          ₹${Number((item.unitPrice || 0) * (item.quantity || 1)).toLocaleString('en-IN')}
        </td>
      </tr>
    `
    )
    .join('');

  const shippingAddr = order.shippingAddress || {};

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Confirmed - Jersey Junction</title>
      <style>
        body { margin: 0; padding: 0; background-color: #0c0c0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; }
        .container { max-width: 600px; margin: 0 auto; background-color: #141416; border-radius: 16px; overflow: hidden; border: 1px solid #28282c; }
        .header { background-color: #050505; padding: 32px 24px; text-align: center; border-bottom: 2px solid #C99682; }
        .brand { font-size: 24px; font-weight: 900; letter-spacing: 3px; color: #ffffff; text-transform: uppercase; margin: 0; }
        .brand span { color: #C99682; }
        .body { padding: 32px 24px; }
        .badge { display: inline-block; background-color: rgba(201, 150, 130, 0.15); color: #C99682; border: 1px solid rgba(201, 150, 130, 0.3); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
        .title { font-size: 22px; font-weight: 800; color: #ffffff; margin-top: 0; margin-bottom: 8px; }
        .subtitle { font-size: 14px; color: #a1a1aa; line-height: 1.5; margin-bottom: 24px; }
        .card { background-color: #1a1a1e; border-radius: 12px; border: 1px solid #28282c; padding: 18px 20px; margin-bottom: 20px; }
        .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #a1a1aa; margin: 0 0 12px 0; }
        table { width: 100%; border-collapse: collapse; }
        .summary-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; color: #d4d4d8; }
        .total-row { display: flex; justify-content: space-between; font-size: 18px; font-weight: 800; color: #ffffff; border-top: 1px solid #28282c; padding-top: 12px; margin-top: 12px; }
        .footer { background-color: #09090b; padding: 20px 24px; text-align: center; font-size: 12px; color: #52525b; border-top: 1px solid #28282c; }
      </style>
    </head>
    <body>
      <div style="padding: 24px 12px;">
        <div class="container">
          <div class="header">
            <h1 class="brand">JERSEY <span>JUNCTION</span></h1>
          </div>
          <div class="body">
            <span class="badge">Order Confirmed</span>
            <h2 class="title">THANK YOU FOR YOUR ORDER!</h2>
            <p class="subtitle">
              Hi <strong>${order.customerName || 'Customer'}</strong>,<br/>
              Your order <strong>${order.orderId || order.id}</strong> has been confirmed and is being prepared for dispatch.
            </p>

            <div class="card">
              <h3 class="card-title">Order Items</h3>
              <table>
                <thead>
                  <tr style="border-bottom: 1px solid #3f3f46; text-align: left; font-size: 11px; text-transform: uppercase; color: #71717a;">
                    <th style="padding: 6px 8px;">Jersey</th>
                    <th style="padding: 6px 8px; text-align: center;">Qty</th>
                    <th style="padding: 6px 8px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </div>

            <div class="card">
              <h3 class="card-title">Order Breakdown</h3>
              <table style="font-size: 14px;">
                <tr>
                  <td style="padding: 4px 0; color: #a1a1aa;">Subtotal:</td>
                  <td style="padding: 4px 0; text-align: right; color: #ffffff;">₹${Number(order.subtotal || 0).toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #a1a1aa;">Shipping Fee:</td>
                  <td style="padding: 4px 0; text-align: right; color: #ffffff;">${Number(order.shippingFee || 0) === 0 ? 'FREE' : `₹${Number(order.shippingFee).toLocaleString('en-IN')}`}</td>
                </tr>
                ${Number(order.discountAmount || 0) > 0 ? `
                  <tr>
                    <td style="padding: 4px 0; color: #10b981;">Coupon Discount:</td>
                    <td style="padding: 4px 0; text-align: right; color: #10b981;">-₹${Number(order.discountAmount).toLocaleString('en-IN')}</td>
                  </tr>
                ` : ''}
                <tr style="border-top: 1px solid #28282c;">
                  <td style="padding: 10px 0 0 0; font-weight: 800; font-size: 16px; color: #ffffff;">Total Amount:</td>
                  <td style="padding: 10px 0 0 0; text-align: right; font-weight: 800; font-size: 16px; color: #C99682;">₹${Number(order.totalAmount || 0).toLocaleString('en-IN')}</td>
                </tr>
              </table>
            </div>

            <div class="card">
              <h3 class="card-title">Shipping & Payment Details</h3>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #d4d4d8;">
                <strong>Deliver To:</strong> ${shippingAddr.name || order.customerName}<br/>
                ${shippingAddr.addressLine || ''}, ${shippingAddr.city || ''}, ${shippingAddr.state || ''} - ${shippingAddr.pincode || ''}<br/>
                <strong>Phone:</strong> ${shippingAddr.phone || order.phone || 'N/A'}
              </p>
              <p style="margin: 8px 0 0 0; font-size: 13px; color: #d4d4d8;">
                <strong>Payment Method:</strong> ${order.paymentMethod || 'Prepaid'} (${order.paymentStatus || 'Confirmed'})
              </p>
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Jersey Junction. Need help? Reply directly to this email or visit our store.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: cleanEmail,
      subject: `Order Confirmed: ${order.orderId || order.id} - Jersey Junction`,
      html,
    });
    console.log(`[EMAIL SERVICE] Order confirmation receipt delivered to ${cleanEmail}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EMAIL SERVICE] Failed to deliver order confirmation receipt to ${cleanEmail}:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOrderConfirmationOtp,
  sendOrderConfirmationReceipt,
  getTransporter,
};
