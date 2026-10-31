const express = require('express');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { sendEmployeeWelcomeEmail, sendEmployeePasswordResetEmail } = require('../utils/emailService');

const router = express.Router();

// Only Boss / Admin can manage employees
router.use(protect);
router.use(authorize('admin'));

// @route   GET /api/employees
// @desc    Get all employees with their permissions and titles
// @access  Private (Boss/Admin only)
router.get('/', async (req, res, next) => {
  try {
    const employees = await User.find({ role: 'employee' })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = employees.map((emp) => ({
      id: emp._id.toString(),
      _id: emp._id.toString(),
      name: emp.name,
      email: emp.email,
      phone: emp.phone || '',
      role: emp.role,
      employeeTitle: emp.employeeTitle || 'Staff Member',
      permissions: Array.isArray(emp.permissions) ? emp.permissions : [],
      status: emp.status || (emp.isBanned ? 'Suspended' : 'Active'),
      createdAt: emp.createdAt,
    }));

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/employees
// @desc    Create new employee with specific section permissions
// @access  Private (Boss/Admin only)
router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, employeeTitle, permissions, phone } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanName = (name || '').trim();

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({
        success: false,
        error: 'Employee name, email, and password are required',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long',
      });
    }

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists',
      });
    }

    // Standardize permissions array
    const validPerms = Array.isArray(permissions) ? permissions.map((p) => p.toLowerCase().trim()) : [];

    const newEmployee = await User.create({
      name: cleanName,
      email: cleanEmail,
      password,
      role: 'employee',
      employeeTitle: (employeeTitle || 'Staff Member').trim(),
      permissions: validPerms,
      phone: (phone || '').trim(),
      status: 'Active',
    });

    // Send credentials and login portal email to the newly created employee
    try {
      await sendEmployeeWelcomeEmail({
        name: cleanName,
        email: cleanEmail,
        password,
        employeeTitle: (employeeTitle || 'Staff Member').trim(),
        permissions: validPerms,
      });
      console.log(`[EMPLOYEE] Welcome email with password sent to ${cleanEmail}`);
    } catch (mailErr) {
      console.warn(`[EMPLOYEE] Failed to send credentials email to ${cleanEmail}:`, mailErr.message);
    }

    res.status(201).json({
      success: true,
      data: {
        id: newEmployee._id.toString(),
        name: newEmployee.name,
        email: newEmployee.email,
        role: newEmployee.role,
        employeeTitle: newEmployee.employeeTitle,
        permissions: newEmployee.permissions,
        status: newEmployee.status,
        phone: newEmployee.phone,
        createdAt: newEmployee.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// @route   PUT /api/employees/:id
// @desc    Update employee permissions, title, status, or reset password
// @access  Private (Boss/Admin only)
router.put('/:id', async (req, res, next) => {
  try {
    const { name, email, password, employeeTitle, permissions, status, phone } = req.body;
    const employee = await User.findById(req.params.id);

    if (!employee || employee.role !== 'employee') {
      return res.status(404).json({
        success: false,
        error: 'Employee account not found',
      });
    }

    if (name) employee.name = name.trim();
    if (email) employee.email = email.toLowerCase().trim();
    if (phone !== undefined) employee.phone = phone.trim();
    if (employeeTitle) employee.employeeTitle = employeeTitle.trim();
    if (Array.isArray(permissions)) {
      employee.permissions = permissions.map((p) => p.toLowerCase().trim());
    }
    if (status) {
      employee.status = status;
      employee.isBanned = status === 'Suspended' || status === 'Banned';
    }

    // Optional password reset by Boss
    const isPasswordReset = Boolean(password && password.trim().length > 0);
    if (isPasswordReset) {
      if (password.trim().length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        });
      }
      employee.password = password.trim();
    }

    await employee.save();

    // If password was reset, notify the employee via email
    if (isPasswordReset) {
      try {
        await sendEmployeePasswordResetEmail({
          name: employee.name,
          email: employee.email,
          newPassword: password.trim(),
        });
        console.log(`[EMPLOYEE] Password reset email sent to ${employee.email}`);
      } catch (mailErr) {
        console.warn(`[EMPLOYEE] Failed to send password reset email to ${employee.email}:`, mailErr.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        id: employee._id.toString(),
        name: employee.name,
        email: employee.email,
        role: employee.role,
        employeeTitle: employee.employeeTitle,
        permissions: employee.permissions,
        status: employee.status,
        phone: employee.phone,
        updatedAt: employee.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee account
// @access  Private (Boss/Admin only)
router.delete('/:id', async (req, res, next) => {
  try {
    const employee = await User.findById(req.params.id);

    if (!employee || employee.role !== 'employee') {
      return res.status(404).json({
        success: false,
        error: 'Employee account not found',
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: `Employee account "${employee.name}" has been deleted.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
