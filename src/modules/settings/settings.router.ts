import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { settingsService } from './settings.service';
import { ok } from '../../shared/response';

const UpdateSettingsSchema = z.object({
  card_section_enabled: z.boolean().optional(),
}).strict();

const router = Router();

// Public: the app reads feature switches before and after sign-in
router.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return ok(res, await settingsService.getAll());
  } catch (err) { next(err); }
});

router.patch('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const patch = UpdateSettingsSchema.parse(req.body);
    return ok(res, await settingsService.update(patch, req.user!.id));
  } catch (err) { next(err); }
});

export default router;
