const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User no longer exists' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role '${req.user ? req.user.role : 'guest'}' is not authorized to access this route`,
      });
    }
    next();
  };
};

// Grant access if user is admin OR employee with specific section permission
exports.authorizePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Boss/Admin has full access to every section
    if (req.user.role === 'admin') {
      return next();
    }

    // Employee checking
    if (req.user.role === 'employee') {
      const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (perms.includes(permission) || perms.includes('*')) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: `Access denied: Your employee account does not have permission for '${permission}'.`,
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Access denied: Administrative privileges required.',
    });
  };
};
