const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please add a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'employee'],
      default: 'user',
    },
    employeeTitle: {
      type: String,
      default: 'Staff Member',
    },
    permissions: {
      type: [String],
      default: [],
    },
    phone: {
      type: String,
      default: '',
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      default: 'Active',
    },
  },
  {
    timestamps: true,
  }
);

// Encrypt password before save
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  if (typeof this.password === 'string') {
    this.password = this.password.trim();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match password (supports direct and trimmed comparisons)
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!enteredPassword || !this.password) return false;
  let isMatch = await bcrypt.compare(enteredPassword, this.password);
  if (!isMatch && typeof enteredPassword === 'string') {
    const trimmed = enteredPassword.trim();
    if (trimmed !== enteredPassword) {
      isMatch = await bcrypt.compare(trimmed, this.password);
    }
  }
  return isMatch;
};

module.exports = mongoose.model('User', userSchema);
