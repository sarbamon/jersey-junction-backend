const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const Product = require('./src/models/Product');

const logPath = 'C:/Users/sarba/.gemini/antigravity-ide/brain/76738750-1a5a-43cc-8e36-68806d0d027b/.system_generated/tasks/task-1004.log';
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function run() {
  console.log('Reading task-1004.log...');
  const content = fs.readFileSync(logPath, 'utf8');
  const jsonStr = content.substring(content.indexOf('['), content.lastIndexOf(']') + 1);
  const products = JSON.parse(jsonStr);
  console.log('Read', products.length, 'products from log.');

  // Save base64 images to files
  const cleanProducts = products.map((p) => {
    const copy = { ...p };
    const id = p._id;

    if (copy.image && copy.image.startsWith('data:image')) {
      const match = copy.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const filename = `prod-${id}.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
        copy.image = `/upload/disk/${filename}`;
        console.log(`Saved image for ${p.name} -> ${filename}`);
      }
    }

    if (Array.isArray(copy.images)) {
      copy.images = copy.images.map((img, idx) => {
        if (img && img.startsWith('data:image')) {
          const match = img.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (match) {
            const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
            const filename = `prod-${id}-${idx}.${ext}`;
            const filePath = path.join(uploadsDir, filename);
            fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
            return `/upload/disk/${filename}`;
          }
        }
        return img;
      });
    }

    return copy;
  });

  // Save clean json in frontend lib/mock/products.ts as instant fallback cache
  const frontendMockPath = 'E:/2025/new-2025/abhisek/2nd-project/jersey-junction/lib/mock/products.ts';
  const fileContent = `export const SEED_ADMIN_PRODUCTS = ${JSON.stringify(cleanProducts, null, 2)};\n`;
  fs.writeFileSync(frontendMockPath, fileContent, 'utf8');
  console.log('Wrote clean products to frontend mock:', cleanProducts.length);

  // Now update database
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected! Updating products in DB...');

  for (const cp of cleanProducts) {
    await Product.findByIdAndUpdate(cp._id, {
      image: cp.image,
      images: cp.images
    });
  }

  console.log('All products successfully updated in MongoDB with clean static URLs!');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
