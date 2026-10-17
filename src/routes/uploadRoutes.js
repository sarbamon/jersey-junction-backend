const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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

// POST /api/upload - Upload product image to Cloudinary or local disk
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
      // If already a hosted URL (http/https), return it directly
      if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
        return res.status(200).json({
          success: true,
          url: image,
          message: 'External image URL accepted',
        });
      }

      // If base64 data URI, save to local disk to avoid localStorage QuotaExceeded errors
      const matches = typeof image === 'string' ? image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/) : null;
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        let ext = 'jpg';
        if (mimeType.includes('png')) ext = 'png';
        else if (mimeType.includes('webp')) ext = 'webp';
        else if (mimeType.includes('gif')) ext = 'gif';
        else if (mimeType.includes('svg')) ext = 'svg';

        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const filepath = path.join(uploadsDir, filename);
        const buffer = Buffer.from(matches[2], 'base64');
        fs.writeFileSync(filepath, buffer);

        const host = req.get('host') || 'localhost:5000';
        const protocol = req.protocol || 'http';
        const fileUrl = `${protocol}://${host}/uploads/${filename}`;

        return res.status(200).json({
          success: true,
          url: fileUrl,
          message: 'Image saved locally to /uploads',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Invalid image format. Expected base64 data URI or HTTP URL.',
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Image upload failed',
    });
  }
});

module.exports = router;

