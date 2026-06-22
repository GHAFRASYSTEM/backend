import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import * as interviewController from './interview.controller';

const router = Router();

// Multer config for audio upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files allowed'));
    }
  }
});

router.use(requireAuth);

// Important: upload middleware only on transcribe
router.post('/context',    interviewController.upsertContext);
router.get('/context',     interviewController.getContext);
router.post('/respond',    interviewController.respond);
router.post('/transcribe', upload.single('audio'), interviewController.transcribe);

export default router;