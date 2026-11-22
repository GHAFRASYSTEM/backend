import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.middleware';
import * as FrenchAIController from './french-ai.controller';
import { logPractice } from './french-ai.service';

const router = Router();

// Audio uploads stay in memory (no disk I/O) — max 10 MB
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/x-wav',
  'audio/wave', 'audio/vnd.wave', 'audio/webm', 'audio/ogg', 'audio/x-m4a', 'audio/aac']);
const AUDIO_EXT = /\.(m4a|mp4|mp3|wav|webm|ogg|aac|caf)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  // Some Android builds send application/octet-stream — accept by extension too
  fileFilter: (_req, file, cb) => {
    cb(null, AUDIO_MIME.has(file.mimetype) || AUDIO_EXT.test(file.originalname ?? ''));
  },
});

// Every successful POST to the tutor counts as practice for today (streaks +
// the 19:00 reminder). Logged after the response, never slows the request.
router.use((req, res, next) => {
  if (req.method === 'POST') {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user) {
        logPractice(req.user.id, req.path.replace(/^\//, '') || 'tutor').catch(() => {});
      }
    });
  }
  next();
});

/** GET /french-ai/progress — streak + last 7 days */
router.get('/progress', requireAuth, FrenchAIController.progress);

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

// ══════════════════════════════════════════════════════════════════════════
// AI WRITING + INSTANT CORRECTION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/writing/correct
 * Body: WritingCorrectionRequest (JSON) — { text, userLevel, context? }
 * Returns: WritingCorrectionResult
 */
router.post('/writing/correct', requireAuth, FrenchAIController.correctWriting);

// ══════════════════════════════════════════════════════════════════════════
// LISTENING & DICTATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/dictation/passage
 * Body: DictationPassageRequest (JSON) — { userLevel, topic?, lengthWords? }
 * Returns: { text, audioBase64 }
 */
router.post('/dictation/passage', requireAuth, FrenchAIController.generateDictationPassage);

/**
 * POST /french-ai/dictation/check
 * Body: DictationCheckRequest (JSON) — { originalText, userAttempt, userLevel }
 * Returns: DictationCheckResult
 */
router.post('/dictation/check', requireAuth, FrenchAIController.checkDictation);

// ══════════════════════════════════════════════════════════════════════════
// READING COMPREHENSION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/reading/generate
 * Body: ReadingExerciseRequest (JSON) — { userLevel, topic? }
 * Returns: ReadingExercise
 */
router.post('/reading/generate', requireAuth, FrenchAIController.generateReadingExercise);

/**
 * POST /french-ai/reading/grade
 * Body: ReadingAnswerCheckRequest (JSON) — { exercise, userLevel, userAnswers }
 * Returns: ReadingAnswerResult
 */
router.post('/reading/grade', requireAuth, FrenchAIController.gradeReadingAnswers);

// ══════════════════════════════════════════════════════════════════════════
// FILL-IN-THE-BLANK / SENTENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/fill-blank/generate
 * Body: FillBlankRequest (JSON) — { userLevel, focus?, count? }
 * Returns: FillBlankExercise[]
 */
router.post('/fill-blank/generate', requireAuth, FrenchAIController.generateFillBlankSet);

/**
 * POST /french-ai/fill-blank/check
 * Body: FillBlankCheckRequest (JSON) — { exercise, userAnswer }
 * Returns: FillBlankCheckResult
 */
router.post('/fill-blank/check', requireAuth, FrenchAIController.checkFillBlankAnswer);

// ══════════════════════════════════════════════════════════════════════════
// AI FLASHCARDS
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/flashcards/generate
 * Body: FlashcardGenerateRequest (JSON) — { items, userLevel, count? }
 * Returns: Flashcard[]
 */
router.post('/flashcards/generate', requireAuth, FrenchAIController.generateFlashcards);

/**
 * POST /french-ai/flashcards/audio
 * Body: { word: string }
 * Returns: audio/mpeg binary
 */
router.post('/flashcards/audio', requireAuth, FrenchAIController.flashcardAudio);

// ══════════════════════════════════════════════════════════════════════════
// VOCAB QUIZ
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/vocab-quiz/generate
 * Body: VocabQuizRequest (JSON) — { category? | words?, userLevel, count?, questionTypes? }
 * Returns: VocabQuizResult (questions include options, correctness, wrong-answer
 * explanations, and per-question audioBase64 — no separate check endpoint needed)
 */
router.post('/vocab-quiz/generate', requireAuth, FrenchAIController.generateVocabQuiz);

export default router;