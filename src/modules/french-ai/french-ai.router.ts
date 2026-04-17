import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import * as FrenchAIController from './french-ai.controller';

const router = Router();

// Audio uploads stay in memory (no disk I/O) — max 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav',
                     'audio/webm', 'audio/ogg', 'audio/x-m4a'];
    cb(null, allowed.includes(file.mimetype));
  },
});

/**
 * POST /french-ai/chat
 * Body: ChatRequest (JSON)
 * Returns: { reply, translation, correction, pronunciationTip }
 */
router.post('/chat', requireAuth, FrenchAIController.chat);

/**
 * POST /french-ai/transcribe
 * Form-data: audio (file)
 * Query:     language? (default: "fr")
 * Returns: { text, language }
 */
router.post(
  '/transcribe',
  requireAuth,
  upload.single('audio'),
  FrenchAIController.transcribe,
);

/**
 * POST /french-ai/tts
 * Body: TTSRequest (JSON)
 * Returns: audio/wav binary
 */
router.post('/tts', requireAuth, FrenchAIController.tts);

router.get('/config', requireAuth, FrenchAIController.getConfig);

/**
 * POST /french-ai/score-pronunciation
 * Form-data: audio (file) + expectedText (string)
 * Returns: { score, transcript, wordScores, feedback }
 */
router.post(
  '/score-pronunciation',
  requireAuth,
  upload.single('audio'),
  FrenchAIController.scorePronunciation,
);

export default router;