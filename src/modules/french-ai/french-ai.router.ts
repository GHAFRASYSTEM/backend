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