import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { notificationsController as c } from './notifications.controller';

const router = Router();
router.use(requireAuth);

// ── Member ───────────────────────────────────────────────────────────────────
router.get('/',              c.list);
router.get('/unread-count',  c.unreadCount);
router.post('/read',         c.markRead);
router.get('/preferences',   c.getPreferences);
router.patch('/preferences', c.updatePreferences);

// ── Admin (dashboard) ────────────────────────────────────────────────────────
router.post('/admin/send',     requireRole('admin'), c.send);
router.post('/admin/preview',  requireRole('admin'), c.preview);
router.get('/admin/campaigns', requireRole('admin'), c.campaigns);

export default router;
