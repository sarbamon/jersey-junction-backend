const User = require('../models/User');

const seedData = async () => {
  try {
    // Seed default master admin if not exists
    const adminEmail = 'admin@jerseyspot.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      await User.create({
        name: 'Master Admin',
        email: adminEmail,
        password: 'admin123',
        role: 'admin',
        phone: '+919876543210'
      });
      console.log('Seed: Default Admin user created (admin@jerseyspot.com)');
    }

    const secondaryAdminEmail = 'admin@jerseyjunction.com';
    let secondaryAdmin = await User.findOne({ email: secondaryAdminEmail });
    if (!secondaryAdmin) {
      await User.create({
        name: 'Jersey Junction Admin',
        email: secondaryAdminEmail,
        password: 'admin123',
        role: 'admin',
      });
      console.log('Seed: Secondary Admin user created (admin@jerseyjunction.com)');
    }
  } catch (error) {
    console.error('Seeding error:', error.message);
  }
};

module.exports = seedData;
