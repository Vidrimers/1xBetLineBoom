// Middleware: multer конфиг для загрузки файлов
import fs from "fs";
import path from "path";
import multer from "multer";
import { AWARD_IMAGE_UPLOAD_DIR } from "../config.js";

// Создаём папку для наград если не существует
if (!fs.existsSync(AWARD_IMAGE_UPLOAD_DIR)) {
  fs.mkdirSync(AWARD_IMAGE_UPLOAD_DIR, { recursive: true });
}

// Хранилище для изображений наград
const awardImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AWARD_IMAGE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}${extension}`;
    cb(null, name);
  },
});

// Upload middleware для изображений наград
const awardImageUpload = multer({
  storage: awardImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения разрешены"));
    }
  },
});

export { awardImageUpload };
