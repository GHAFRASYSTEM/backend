import { Router } from 'express';
import { attendanceController } from './attendance.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';

const router = Router();

router.use(requireAuth);

router.post('/check-in', attendanceController.checkIn);
router.get('/me', attendanceController.getMyHistory);
router.get('/meetings', attendanceController.listMeetings);
router.get('/meetings/:id', attendanceController.getMeeting);

router.post('/meetings', requireRole('admin'), attendanceController.createMeeting);
router.patch('/meetings/:id', requireRole('admin'), attendanceController.updateMeeting);
router.patch('/meetings/:id/active', requireRole('admin'), attendanceController.setMeetingActive);
router.delete('/meetings/:id', requireRole('admin'), attendanceController.deleteMeeting);

router.get('/meetings/:id/roster', requireRole('admin'), attendanceController.getMeetingRoster);
router.post('/meetings/:id/records', requireRole('admin'), attendanceController.markAttendanceManually);
router.delete('/records/:recordId', requireRole('admin'), attendanceController.deleteRecord);
router.get('/records', requireRole('admin'), attendanceController.listRecords);
router.get('/summary', requireRole('admin'), attendanceController.getMonthlySummary);
router.get('/members/:userId', requireRole('admin'), attendanceController.getMemberHistory);

export default router;
