import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import type {
  CheckInInput,
  HistoryQuery,
  CreateMeetingInput,
  UpdateMeetingInput,
  SetMeetingActiveInput,
  ListMeetingsQuery,
  MeetingStatus,
  RosterQuery,
  ManualMarkInput,
  ListRecordsQuery,
  SummaryQuery,
} from './attendance.schema';

const MEETINGS = 'attendance_meetings';
const RECORDS = 'attendance_records';

// Every column except check_in_code, which members must never receive
const MEETING_COLUMNS = 'id, title, description, location_name, meeting_date, starts_at, ends_at, latitude, longitude, radius_m, is_active, cancelled_at, created_at, updated_at';

type HistoryStatus = 'Attended' | 'Unavailable';

type MeetingTiming = {
  meeting_date: string;
  ends_at: string | null;
  cancelled_at: string | null;
};

// Today's calendar date in Paris, as YYYY-MM-DD
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

// Status is derived rather than stored — only cancellation is recorded.
// Must stay in line with the filters in listMeetings.
function getMeetingStatus(meeting: MeetingTiming, today: string, now: Date): MeetingStatus {
  if (meeting.cancelled_at) return 'cancelled';
  if (meeting.meeting_date < today) return 'completed';
  if (meeting.ends_at && new Date(meeting.ends_at) < now) return 'completed';
  return 'upcoming';
}

// Haversine distance between two coordinates, in metres
function distanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number) {}

// Meeting is active, today is meeting_date (Europe/Paris), window open
function assertCheckInOpen(meeting: unknown) {}

// Submitted point is within meeting radius and GPS accuracy is acceptable
function assertWithinGeofence(meeting: unknown, input: CheckInInput) {}

// Members expected at a meeting — complete profiles, joined on/before meeting_date
async function getExpectedMembers(meetingDate: string) {}

export const attendanceService = {

  // Validate window + geofence, insert record; conflict on duplicate
  async checkIn(userId: string, input: CheckInInput) {},

  // Meetings since the member joined, grouped by month, most recent first.
  // Cancelled meetings are left out, and today's meeting only appears once
  // attended or completed, so nobody is Unavailable while check-in is open.
  async getMyHistory(userId: string, query: HistoryQuery) {
    const today = parisToday();
    const now = new Date();
    const year = query.year ?? Number(today.slice(0, 4));

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('member_since, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) throw Errors.internal(profileError.message);
    if (!profile) throw Errors.notFound('Profile');

    const joinedOn: string = profile.member_since ?? profile.created_at.slice(0, 10);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const from = joinedOn > yearStart ? joinedOn : yearStart;
    const to = today < yearEnd ? today : yearEnd;

    const empty = { year, joined_on: joinedOn, totals: { attended: 0, unavailable: 0 }, months: [] };
    if (from > to) return empty;

    const { data: meetings, error: meetingsError } = await supabase
      .from(MEETINGS)
      .select('id, title, location_name, meeting_date, starts_at, ends_at, cancelled_at')
      .is('cancelled_at', null)
      .gte('meeting_date', from)
      .lte('meeting_date', to)
      .order('meeting_date', { ascending: false })
      .order('starts_at', { ascending: false, nullsFirst: false });

    if (meetingsError) throw Errors.internal(meetingsError.message);
    if (!meetings?.length) return empty;

    const { data: records, error: recordsError } = await supabase
      .from(RECORDS)
      .select('meeting_id, recorded_at')
      .eq('user_id', userId)
      .in('meeting_id', meetings.map(m => m.id));

    if (recordsError) throw Errors.internal(recordsError.message);

    const recordedAt = new Map<string, string>(
      (records ?? []).map(r => [r.meeting_id, r.recorded_at]),
    );

    const totals = { attended: 0, unavailable: 0 };
    const months: { month: string; meetings: unknown[] }[] = [];

    for (const meeting of meetings) {
      const attendedAt = recordedAt.get(meeting.id) ?? null;
      if (!attendedAt && getMeetingStatus(meeting, today, now) !== 'completed') continue;

      const status: HistoryStatus = attendedAt ? 'Attended' : 'Unavailable';
      if (attendedAt) totals.attended++;
      else totals.unavailable++;

      const month = meeting.meeting_date.slice(0, 7);
      if (months[months.length - 1]?.month !== month) months.push({ month, meetings: [] });

      months[months.length - 1].meetings.push({
        meeting_id: meeting.id,
        title: meeting.title,
        location_name: meeting.location_name,
        meeting_date: meeting.meeting_date,
        starts_at: meeting.starts_at,
        status,
        recorded_at: attendedAt,
      });
    }

    return { year, joined_on: joinedOn, totals, months };
  },

  // Paginated; upcoming soonest first, everything else most recent first
  async listMeetings(query: ListMeetingsQuery) {
    const { page, limit, status } = query;
    const from = (page - 1) * limit;
    const today = parisToday();
    const now = new Date();
    const nowIso = now.toISOString();

    let q = supabase.from(MEETINGS).select(MEETING_COLUMNS, { count: 'exact' });

    if (status === 'cancelled') {
      q = q.not('cancelled_at', 'is', null);
    } else if (status === 'upcoming') {
      q = q
        .is('cancelled_at', null)
        .gte('meeting_date', today)
        .or(`ends_at.is.null,ends_at.gte."${nowIso}"`);
    } else if (status === 'completed') {
      q = q
        .is('cancelled_at', null)
        .or(`meeting_date.lt.${today},ends_at.lt."${nowIso}"`);
    }

    const ascending = status === 'upcoming';
    const { data, error, count } = await q
      .order('meeting_date', { ascending })
      .order('starts_at', { ascending, nullsFirst: ascending })
      .range(from, from + limit - 1);

    if (error) throw Errors.internal(error.message);

    return {
      data: (data ?? []).map(m => ({ ...m, status: getMeetingStatus(m, today, now) })),
      total: count ?? 0,
    };
  },

  async getMeeting(meetingId: string) {
    const { data, error } = await supabase
      .from(MEETINGS)
      .select(MEETING_COLUMNS)
      .eq('id', meetingId)
      .maybeSingle();

    if (error) throw Errors.internal(error.message);
    if (!data) throw Errors.notFound('Meeting');

    return { ...data, status: getMeetingStatus(data, parisToday(), new Date()) };
  },

  async createMeeting(input: CreateMeetingInput) {},

  async updateMeeting(meetingId: string, input: UpdateMeetingInput) {},

  async setMeetingActive(meetingId: string, input: SetMeetingActiveInput) {},

  async deleteMeeting(meetingId: string) {},

  // Expected members for one meeting, split into attended / unavailable
  async getMeetingRoster(meetingId: string, query: RosterQuery) {},

  // Admin override — validation_status = 'admin_override'
  async markAttendanceManually(meetingId: string, input: ManualMarkInput) {},

  async deleteRecord(recordId: string) {},

  // Records across meetings, filtered by month / year / status / member
  async listRecords(query: ListRecordsQuery) {},

  // Per-meeting attended vs unavailable counts for a month
  async getMonthlySummary(query: SummaryQuery) {},

  // One member's history — same shape as getMyHistory
  async getMemberHistory(userId: string, query: HistoryQuery) {},
};
