const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Helper to generate JWT token and cookie
const sendTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );

  const options = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
    });
};

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanName = (name || '').trim();
    const cleanPhone = (phone || '').trim();

    if (!cleanEmail || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const user = await User.create({
      name: cleanName || cleanEmail.split('@')[0],
      email: cleanEmail,
      password,
      phone: cleanPhone,
    });

    sendTokenResponse(user, 201, res);
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide email and password' });
    }

    const cleanEmail = (email || '').toLowerCase().trim();

    // Find by exact lowercased email or case-insensitive regex fallback
    const user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { email: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.isBanned || user.status === 'Banned') {
      return res.status(403).json({
        success: false,
        error: user.banReason
          ? `Account Suspended: ${user.banReason}. Please contact support.`
          : 'Your account has been suspended by the administrator. Please contact support.',
      });
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/auth/google
// @desc    Register or login user with Google
// @access  Public
router.post('/google', async (req, res, next) => {
  try {
    let { email, name, credential, accessToken } = req.body;

    // 1. If accessToken provided (from Google OAuth2 token client popup)
    if (accessToken) {
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json();
          email = userInfo.email || email;
          name = userInfo.name || name;
        }
      } catch (err) {
        console.error('Google userInfo fetch error:', err);
      }
    }

    // 2. If credential provided (from Google Identity Services ID Token / One Tap)
    if (credential) {
      try {
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (tokenInfoRes.ok) {
          const tokenInfo = await tokenInfoRes.json();
          if (tokenInfo.email) {
            email = tokenInfo.email;
            name = tokenInfo.name || name;
          }
        }
      } catch (fetchErr) {
        console.error('Google tokeninfo fetch error:', fetchErr);
      }

      // Fallback: decode JWT directly if network verification was unavailable
      if (!email) {
        try {
          const decoded = jwt.decode(credential);
          if (decoded && decoded.email) {
            email = decoded.email;
            name = decoded.name || name;
          }
        } catch (e) {
          console.error('Google JWT decode error:', e);
        }
      }
    }

    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanEmail) {
      return res.status(400).json({ success: false, error: 'Google email is required' });
    }

    let user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { email: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    });

    // Check if user account is suspended/banned
    if (user && (user.isBanned || user.status === 'Banned')) {
      return res.status(403).json({
        success: false,
        error: `Account Suspended: ${user.banReason || 'Your account has been suspended by store administration'}. Please contact support.`,
      });
    }

    if (!user) {
      // Create new customer account in MongoDB
      const randomPassword = Math.random().toString(36).substring(2, 15) + '!A1';
      user = await User.create({
        name: name || cleanEmail.split('@')[0],
        email: cleanEmail,
        password: randomPassword,
        role: 'user',
        status: 'Active',
        isBanned: false,
        phone: '',
      });
    } else if (name && (!user.name || user.name === user.email.split('@')[0])) {
      user.name = name;
      await user.save();
    }

    sendTokenResponse(user, 200, res);
  } catch (err) {
    next(err);
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  res.status(200).json({
    success: true,
    data: req.user,
  });
});

// @route   GET /api/auth/logout
// @desc    Log user out / clear cookie
// @access  Private
router.get('/logout', protect, (req, res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });
  res.status(200).json({ success: true, data: {} });
});

// @route   GET /api/auth/users
// @desc    Get all registered users for admin directory
// @access  Admin only
router.get('/users', protect, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find({ role: { $ne: 'admin' } }).select('-password').sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (err) {
    next(err);
  }
});

// @route   PUT /api/auth/users/:id/ban
// @desc    Ban or Unban customer account (Admin only)
// @access  Admin only
router.put('/users/:id/ban', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { isBanned, reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    if (user.role === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot ban admin accounts' });
    }

    user.isBanned = Boolean(isBanned);
    user.status = user.isBanned ? 'Banned' : 'Active';
    user.banReason = user.isBanned ? (reason || 'Account suspended by store admin') : '';
    await user.save();

    res.status(200).json({
      success: true,
      message: user.isBanned ? 'Customer account has been BANNED' : 'Customer account has been RESTORED (Active)',
      user: {
        id: user._id,
        isBanned: user.isBanned,
        status: user.status,
        banReason: user.banReason,
      },
    });
  } catch (err) {
    next(err);
  }
});

// @route   PUT /api/auth/users/:id/reset-password
// @desc    Admin manually reset customer password
// @access  Admin only
router.put('/users/:id/reset-password', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Password successfully updated for ${user.email}`,
    });
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/auth/reset-password
// @desc    Customer self-service reset password by email
// @access  Public
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, newPassword } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanEmail || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { email: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'No account found with this email' });
    }

    if (user.isBanned || user.status === 'Banned') {
      return res.status(403).json({ success: false, error: 'This account is suspended. Please contact store support.' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
