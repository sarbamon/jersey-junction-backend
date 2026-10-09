const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;

// Helper to check and configure Cloudinary
const isCloudinaryConfigured = () => {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  if (
    cloud_name &&
    api_key &&
    api_secret &&
    cloud_name !== 'your_cloud_name' &&
    api_key !== 'your_api_key'
  ) {
    cloudinary.config({
      cloud_name,
      api_key,
      api_secret,
    });
    return true;
  }
  return false;
};

// POST /api/upload - Upload product image to Cloudinary
router.post('/', async (req, res, next) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, message: 'Image data or URL is required' });
    }

    if (isCloudinaryConfigured()) {
      const uploadResponse = await cloudinary.uploader.upload(image, {
        folder: 'jersey-junction/products',
        resource_type: 'auto',
      });

      return res.status(200).json({
        success: true,
        url: uploadResponse.secure_url,
        public_id: uploadResponse.public_id,
        message: 'Image uploaded successfully to Cloudinary',
      });
    } else {
      // Return provided image or fallback preview if credentials not configured
      return res.status(200).json({
        success: true,
        url: image,
        isMock: true,
        message: 'Cloudinary API credentials missing in .env, using direct image URL',
      });
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Image upload failed',
    });
  }
});

module.exports = router;
