import { Request, Response, NextFunction } from 'express';
import {
  ChatRequestSchema,
  TTSRequestSchema,
  PronunciationScoreRequestSchema,
  TranscribeQuerySchema,
  WritingCorrectionRequestSchema,
  DictationPassageRequestSchema,
  DictationCheckRequestSchema,
  ReadingExerciseRequestSchema,
  ReadingAnswerCheckRequestSchema,
  FillBlankRequestSchema,
  FillBlankCheckRequestSchema,
  FlashcardGenerateRequestSchema,
  FlashcardAudioRequestSchema,
  VocabQuizRequestSchema,
} from './french-ai.schema';
import * as FrenchAIService from './french-ai.service';
import { ok } from '../../shared/response';
import { AppError } from '../../shared/errors';

// french-ai.controller.ts

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    const body = ChatRequestSchema.parse(req.body);
    const result = await FrenchAIService.chatWithTutor(body);
    ok(res, result);                          // ✅ not res.json(ok(...))
  } catch (err) {
    next(err);
  }
}

export async function transcribe(req: Request, res: Response, next: NextFunction) {
  try {
    const query = TranscribeQuerySchema.parse(req.query);
    if (!req.file) throw new AppError('No audio file uploaded (field: "audio")', 400);
    const result = await FrenchAIService.transcribeAudio(
      req.file.buffer,
      req.file.mimetype,
      query.language,
    );
    ok(res, result);                          // ✅
  } catch (err) {
    next(err);
  }
}

export async function tts(req: Request, res: Response, next: NextFunction) {
  try {
    const body = TTSRequestSchema.parse(req.body);
    const audioBuffer = await FrenchAIService.synthesizeSpeech(body);
    if (!audioBuffer.length) { res.status(204).end(); return; }
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(audioBuffer.length));
    res.send(audioBuffer);                    // ✅ unchanged — binary, not ok()
  } catch (err) {
    next(err);
  }
}

export async function getConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const config = FrenchAIService.getTutorConfig();
    ok(res, config);                          // ✅
  } catch (err) {
    next(err);
  }
}

export async function scorePronunciation(req: Request, res: Response, next: NextFunction) {
  try {
    const body = PronunciationScoreRequestSchema.parse(req.body);
    if (!req.file) throw new AppError('No audio file uploaded (field: "audio")', 400);
    const result = await FrenchAIService.scorePronunciation(
      req.file.buffer,
      req.file.mimetype,
      body.expectedText,
    );
    ok(res, result);                          // ✅
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AI WRITING + INSTANT CORRECTION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/writing/correct
 * Body: WritingCorrectionRequest (JSON)
 * Returns: WritingCorrectionResult
 */
export async function correctWriting(req: Request, res: Response, next: NextFunction) {
  try {
    const body = WritingCorrectionRequestSchema.parse(req.body);
    const result = await FrenchAIService.gradeWriting(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LISTENING & DICTATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/dictation/passage
 * Body: DictationPassageRequest (JSON)
 * Returns: { text, audioBase64 }
 */
export async function generateDictationPassage(req: Request, res: Response, next: NextFunction) {
  try {
    const body = DictationPassageRequestSchema.parse(req.body);
    const result = await FrenchAIService.generateDictationPassage(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /french-ai/dictation/check
 * Body: DictationCheckRequest (JSON)
 * Returns: DictationCheckResult
 */
export async function checkDictation(req: Request, res: Response, next: NextFunction) {
  try {
    const body = DictationCheckRequestSchema.parse(req.body);
    const result = await FrenchAIService.checkDictation(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// READING COMPREHENSION
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/reading/generate
 * Body: ReadingExerciseRequest (JSON)
 * Returns: ReadingExercise
 * NOTE: correctAnswer fields are included in the response since there's no
 * server-side store to withhold them from — see TODO in the schema file.
 */
export async function generateReadingExercise(req: Request, res: Response, next: NextFunction) {
  try {
    const body = ReadingExerciseRequestSchema.parse(req.body);
    const result = await FrenchAIService.generateReadingExercise(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /french-ai/reading/grade
 * Body: ReadingAnswerCheckRequest (JSON) — client sends back the exercise it received plus its answers
 * Returns: ReadingAnswerResult
 */
export async function gradeReadingAnswers(req: Request, res: Response, next: NextFunction) {
  try {
    const body = ReadingAnswerCheckRequestSchema.parse(req.body);
    const result = await FrenchAIService.gradeReadingAnswers(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FILL-IN-THE-BLANK / SENTENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/fill-blank/generate
 * Body: FillBlankRequest (JSON)
 * Returns: FillBlankExercise[]
 */
export async function generateFillBlankSet(req: Request, res: Response, next: NextFunction) {
  try {
    const body = FillBlankRequestSchema.parse(req.body);
    const result = await FrenchAIService.generateFillBlankSet(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /french-ai/fill-blank/check
 * Body: FillBlankCheckRequest (JSON) — client sends back the exercise it received plus its answer
 * Returns: FillBlankCheckResult
 */
export async function checkFillBlankAnswer(req: Request, res: Response, next: NextFunction) {
  try {
    const body = FillBlankCheckRequestSchema.parse(req.body);
    const result = FrenchAIService.checkFillBlankAnswer(body); // synchronous, no AI call
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AI FLASHCARDS
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/flashcards/generate
 * Body: FlashcardGenerateRequest (JSON)
 * Returns: Flashcard[]
 */
export async function generateFlashcards(req: Request, res: Response, next: NextFunction) {
  try {
    const body = FlashcardGenerateRequestSchema.parse(req.body);
    const result = await FrenchAIService.generateFlashcardsFromContent(
      body.items,
      body.userLevel,
      body.count,
    );
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /french-ai/flashcards/audio
 * Body: { word: string }
 * Returns: audio/mpeg binary (same shape as /tts)
 */
export async function flashcardAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const body = FlashcardAudioRequestSchema.parse(req.body);
    const audioBuffer = await FrenchAIService.synthesizeFlashcardAudio(body.word);
    if (!audioBuffer.length) { res.status(204).end(); return; }
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', String(audioBuffer.length));
    res.send(audioBuffer);
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// VOCAB QUIZ
// ══════════════════════════════════════════════════════════════════════════

/**
 * POST /french-ai/vocab-quiz/generate
 * Body: VocabQuizRequest (JSON) — { category? | words?, userLevel, count?, questionTypes? }
 * Returns: VocabQuizResult — questions already carry per-option correctness
 * and wrong-answer explanations, plus audioBase64 per question, so the
 * client can run the whole quiz (play, answer, explain) without further calls.
 */
export async function generateVocabQuiz(req: Request, res: Response, next: NextFunction) {
  try {
    const body = VocabQuizRequestSchema.parse(req.body);
    const result = await FrenchAIService.generateVocabQuiz(body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}