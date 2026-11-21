import type { Request, Response, NextFunction } from 'express';
import { attendanceService } from './attendance.service';
import {
  CheckInSchema,
  HistoryQuerySchema,
  CreateMeetingSchema,
  UpdateMeetingSchema,
  SetMeetingActiveSchema,
  ListMeetingsQuerySchema,
  MeetingIdSchema,
  RecordIdSchema,
  UserIdSchema,
  RosterQuerySchema,
  ManualMarkSchema,
  ListRecordsQuerySchema,
  SummaryQuerySchema,
} from './attendance.schema';
import { ok, created, paginated } from '../../shared/response';

export const attendanceController = {

  // POST /attendance/check-in
  async checkIn(req: Request, res: Response, next: NextFunction) {
    try {
      const input = CheckInSchema.parse(req.body);
      const result = await attendanceService.checkIn(req.user!.id, input);
      return created(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/me?year=
  async getMyHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const query = HistoryQuerySchema.parse(req.query);
      const result = await attendanceService.getMyHistory(req.user!.id, query);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/meetings?status=upcoming|cancelled|completed&page=&limit=
  async listMeetings(req: Request, res: Response, next: NextFunction) {
    try {
      const query = ListMeetingsQuerySchema.parse(req.query);
      const { data, total } = await attendanceService.listMeetings(query);
      return paginated(res, data, total, query.page, query.limit);
    } catch (err) { next(err); }
  },

  // GET /attendance/meetings/:id
  async getMeeting(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = MeetingIdSchema.parse(req.params);
      const result = await attendanceService.getMeeting(id);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // POST /attendance/meetings
  async createMeeting(req: Request, res: Response, next: NextFunction) {
    try {
      const input = CreateMeetingSchema.parse(req.body);
      const result = await attendanceService.createMeeting(input);
      return created(res, result);
    } catch (err) { next(err); }
  },

  // PATCH /attendance/meetings/:id
  async updateMeeting(req: Request, res: Response, next: NextFunction) {
    try {
      const input = UpdateMeetingSchema.parse(req.body);
      const result = await attendanceService.updateMeeting(MeetingIdSchema.parse(req.params).id, input);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // PATCH /attendance/meetings/:id/active
  async setMeetingActive(req: Request, res: Response, next: NextFunction) {
    try {
      const input = SetMeetingActiveSchema.parse(req.body);
      const result = await attendanceService.setMeetingActive(MeetingIdSchema.parse(req.params).id, input);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // DELETE /attendance/meetings/:id
  async deleteMeeting(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await attendanceService.deleteMeeting(MeetingIdSchema.parse(req.params).id);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/meetings/:id/roster?status=attended|unavailable
  async getMeetingRoster(req: Request, res: Response, next: NextFunction) {
    try {
      const query = RosterQuerySchema.parse(req.query);
      const result = await attendanceService.getMeetingRoster(MeetingIdSchema.parse(req.params).id, query);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // POST /attendance/meetings/:id/records
  async markAttendanceManually(req: Request, res: Response, next: NextFunction) {
    try {
      const input = ManualMarkSchema.parse(req.body);
      const result = await attendanceService.markAttendanceManually(MeetingIdSchema.parse(req.params).id, input);
      return created(res, result);
    } catch (err) { next(err); }
  },

  // DELETE /attendance/records/:recordId
  async deleteRecord(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await attendanceService.deleteRecord(RecordIdSchema.parse(req.params).recordId);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/records?month=&year=&status=&user_id=
  async listRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const query = ListRecordsQuerySchema.parse(req.query);
      const result = await attendanceService.listRecords(query);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/summary?month=&year=
  async getMonthlySummary(req: Request, res: Response, next: NextFunction) {
    try {
      const query = SummaryQuerySchema.parse(req.query);
      const result = await attendanceService.getMonthlySummary(query);
      return ok(res, result);
    } catch (err) { next(err); }
  },

  // GET /attendance/members/:userId?year=
  async getMemberHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const query = HistoryQuerySchema.parse(req.query);
      const result = await attendanceService.getMemberHistory(UserIdSchema.parse(req.params).userId, query);
      return ok(res, result);
    } catch (err) { next(err); }
  },
};
