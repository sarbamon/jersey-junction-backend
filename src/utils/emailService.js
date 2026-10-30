const nodemailer = require('nodemailer');

/**
 * Returns a configured Nodemailer transporter for Brevo (Sendinblue) SMTP Relay.
 * Server: smtp-relay.brevo.com, Port: 587 (TLS)
 * Auth Pass: xsmtpsib-... key
 */
const getBrevoSmtpTransporter = () => {
  const brevoKey = (
    process.env.BREVO_SMTP_KEY ||
    process.env.BREVO_SMTP_PASS ||
    (process.env.SMTP_PASS && process.env.SMTP_PASS.startsWith('xsmtpsib-') ? process.env.SMTP_PASS : '') ||
    ''
  ).trim();

  if (!brevoKey || brevoKey.length < 10) return null;

  const brevoLogin = (
    process.env.BREVO_SMTP_LOGIN ||
    process.env.BREVO_LOGIN ||
    process.env.BREVO_SMTP_USER ||
    process.env.BREVO_USER ||
    process.env.SMTP_USER ||
    'support@jerseyjunction.shop'
  ).trim();

  return nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: brevoLogin,
      pass: brevoKey,
    },
  });
};

/**
 * Returns a configured Nodemailer transporter for Hostinger SMTP (or custom SMTP).
 * Default host: smtp.hostinger.com, port: 465 (SSL)
 * User: support@jerseyjunction.shop
 */
const getTransporter = () => {
  const host = (process.env.SMTP_HOST || 'smtp.hostinger.com').trim();
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = (process.env.SMTP_USER || process.env.EMAIL_USER || 'support@jerseyjunction.shop').trim();
  const pass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;

  if (!pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: true,
    },
  });
};

/**
 * Resilient Dispatcher:
 * 1. Attempts Brevo SMTP Relay (smtp-relay.brevo.com:587) - bypasses IP restrictions.
 * 2. Attempts Brevo REST HTTP API.
 * 3. Falls back to Hostinger SMTP (smtp.hostinger.com:465).
 */
const dispatchEmail = async ({ to, customerName, subject, html }) => {
  const cleanEmail = (to || '').trim().toLowerCase();
  if (!cleanEmail) return { success: false, error: 'Recipient email required' };

  const senderEmail = (
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    'support@jerseyjunction.shop'
  ).trim();

  const senderName = process.env.EMAIL_FROM_NAME || 'Jersey Junction';

  // 1. Try Brevo SMTP Relay first if configured (works across cloud hosts without IP lock)
  const brevoTransporter = getBrevoSmtpTransporter();
  if (brevoTransporter) {
    try {
      const info = await brevoTransporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        replyTo: senderEmail,
        to: cleanEmail,
        subject,
        html,
      });
      console.log(`[EMAIL SERVICE (BREVO SMTP)] Delivered to ${cleanEmail}: ${info.messageId}`);
      return { success: true, provider: 'brevo-smtp', messageId: info.messageId };
    } catch (brevoSmtpErr) {
      console.warn(`[EMAIL SERVICE] Brevo SMTP relay notice: ${brevoSmtpErr.message}. Trying next provider...`);
    }
  }

  const brevoApiKey = (
    process.env.BRAVO_EMAIL_API_KEY ||
    process.env.BREVO_EMAIL_API_KEY ||
    process.env.BREVO_API_KEY ||
    ''
  ).trim();

  // 2. Try Brevo REST API if configured
  if (brevoApiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: cleanEmail, name: customerName || 'Customer' }],
          replyTo: { email: senderEmail, name: senderName },
          subject,
          htmlContent: html,
        }),
      });

      const resData = await response.json();

      if (response.ok && resData.messageId) {
        console.log(`[EMAIL SERVICE (BREVO)] Delivered to ${cleanEmail} (ID: ${resData.messageId})`);
        return { success: true, provider: 'brevo', messageId: resData.messageId };
      }

      console.warn(`[EMAIL SERVICE] Brevo API notice:`, resData.message || resData);
      console.log(`[EMAIL SERVICE] Falling back to Hostinger SMTP...`);
    } catch (brevoErr) {
      console.warn(`[EMAIL SERVICE] Brevo request failed: ${brevoErr.message}. Falling back to Hostinger SMTP...`);
    }
  }

  // 3. Fallback to Hostinger SMTP (or custom SMTP)
  const transporter = getTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        replyTo: senderEmail,
        to: cleanEmail,
        subject,
        html,
      });
      console.log(`[EMAIL SERVICE (HOSTINGER SMTP)] Delivered from ${senderEmail} to ${cleanEmail}: ${info.messageId}`);
      return { success: true, provider: 'hostinger', messageId: info.messageId };
    } catch (smtpErr) {
      console.error(`[EMAIL SERVICE (HOSTINGER SMTP)] Failed to deliver to ${cleanEmail}:`, smtpErr.message);
      return { success: false, error: smtpErr.message };
    }
  }

  // 3. Fallback when credentials are not configured yet
  console.log('\n============================================================');
  console.log(`[EMAIL SERVICE] No Brevo API Key or Hostinger SMTP Pass configured.`);
  console.log(`[SIMULATED ORDER CONFIRMATION]`);
  console.log(`  To: ${cleanEmail}`);
  console.log(`  From: "${senderName}" <${senderEmail}>`);
  console.log(`  Subject: ${subject}`);
  console.log('============================================================\n');
  return { success: true, simulated: true };
};

/**
 * Sends a full Order Confirmation receipt email to the customer's email upon order placement.
 */
const sendOrderConfirmationReceipt = async (order) => {
  const orderData = order && typeof order.toObject === 'function' ? order.toObject() : (order || {});
  const cleanEmail = (orderData.email || order?.email || '').trim().toLowerCase();
  if (!cleanEmail) return { success: false, error: 'No recipient email provided' };

  const senderEmail = (process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || 'support@jerseyjunction.shop').trim();

  const itemsHtml = (orderData.items || [])
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

  const shippingAddr = orderData.shippingAddress || {};

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
              Hi <strong>${orderData.customerName || 'Customer'}</strong>,<br/>
              Your order <strong>${orderData.orderId || orderData.id}</strong> has been received and confirmed. We are preparing it for dispatch.
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
                  <td style="padding: 4px 0; text-align: right; color: #ffffff;">₹${Number(orderData.subtotal || 0).toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #a1a1aa;">Shipping Fee:</td>
                  <td style="padding: 4px 0; text-align: right; color: #ffffff;">${Number(orderData.shippingFee || 0) === 0 ? 'FREE' : `₹${Number(orderData.shippingFee).toLocaleString('en-IN')}`}</td>
                </tr>
                ${Number(orderData.discountAmount || 0) > 0 ? `
                  <tr>
                    <td style="padding: 4px 0; color: #10b981;">Coupon Discount:</td>
                    <td style="padding: 4px 0; text-align: right; color: #10b981;">-₹${Number(orderData.discountAmount).toLocaleString('en-IN')}</td>
                  </tr>
                ` : ''}
                <tr style="border-top: 1px solid #28282c;">
                  <td style="padding: 10px 0 0 0; font-weight: 800; font-size: 16px; color: #ffffff;">Total Amount:</td>
                  <td style="padding: 10px 0 0 0; text-align: right; font-weight: 800; font-size: 16px; color: #C99682;">₹${Number(orderData.totalAmount || 0).toLocaleString('en-IN')}</td>
                </tr>
              </table>
            </div>

            <div class="card">
              <h3 class="card-title">Shipping & Payment Details</h3>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #d4d4d8;">
                <strong>Deliver To:</strong> ${shippingAddr.name || orderData.customerName}<br/>
                ${shippingAddr.addressLine || ''}, ${shippingAddr.city || ''}, ${shippingAddr.state || ''} - ${shippingAddr.pincode || ''}<br/>
                <strong>Phone:</strong> ${shippingAddr.phone || orderData.phone || 'N/A'}
              </p>
              <p style="margin: 8px 0 0 0; font-size: 13px; color: #d4d4d8;">
                <strong>Payment Method:</strong> ${orderData.paymentMethod || 'Prepaid'} (${orderData.paymentStatus || 'Confirmed'})
              </p>
            </div>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} Jersey Junction. Need help? Contact us at <strong>${senderEmail}</strong>.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await dispatchEmail({
    to: cleanEmail,
    customerName: orderData.customerName,
    subject: `Order Confirmed: ${orderData.orderId || orderData.id} - Jersey Junction`,
    html,
  });
};

/**
 * Sends OTP verification if required.
 */
const sendOrderConfirmationOtp = async ({ email, otp, customerName }) => {
  const cleanEmail = (email || '').trim().toLowerCase();

  const html = `
    <div style="font-family: sans-serif; background: #0c0c0c; color: #fff; padding: 24px; text-align: center;">
      <h2 style="color: #C99682;">JERSEY JUNCTION</h2>
      <p>Hello ${customerName || 'Customer'},</p>
      <p>Your verification code is:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #C99682; margin: 16px 0;">${otp}</div>
      <p style="font-size: 12px; color: #888;">Valid for 10 minutes.</p>
    </div>
  `;

  return await dispatchEmail({
    to: cleanEmail,
    customerName,
    subject: `Your Jersey Junction Verification Code: ${otp}`,
    html,
  });
};

module.exports = {
  sendOrderConfirmationReceipt,
  sendOrderConfirmationOtp,
  getTransporter,
  dispatchEmail,
};
