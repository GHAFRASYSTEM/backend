import { randomInt } from 'crypto';
import { supabase } from '../../config/supabase';
import { Errors } from '../../shared/errors';
import { runAttendanceReminders } from '../../jobs/attendance-reminders.job';
import { notifyInBackground } from '../notifications/notifications.service';
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

const MEMBER_FIELDS = 'id, name, email, photo_url';
const RECORD_SELECT = `id, meeting_id, user_id, status, recorded_at, validation_status, distance_m, member:profiles!attendance_records_user_id_profiles_fkey(${MEMBER_FIELDS})`;

// No 0/O or 1/I, since the code is read out in the room and typed on a phone
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const EARTH_RADIUS_M = 6371000;
// Phone fixes worse than this are rejected rather than trusted
const MAX_ACCURACY_M = 100;

type HistoryStatus = 'Attended' | 'Unavailable';

type MeetingTiming = {
  meeting_date: string;
  ends_at: string | null;
  cancelled_at: string | null;
};

type MeetingRow = MeetingTiming & {
  id: string;
  title: string;
  location_name: string | null;
  starts_at: string | null;
};

type Member = { id: string; name: string | null; email: string | null; photo_url: string | null };

type MemberWithJoinDate = Member & { joined_on: string };

type RecordRow = {
  id: string;
  meeting_id: string;
  user_id: string;
  status: string;
  recorded_at: string;
  validation_status: string;
  distance_m: number | null;
  member: Member | null;
};

// Calendar date in Paris, as YYYY-MM-DD
function parisDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date);
}

function parisToday(): string {
  return parisDate(new Date());
}

// Status is derived rather than stored — only cancellation is recorded.
// Must stay in line with the filters in listMeetings.
function getMeetingStatus(meeting: MeetingTiming, today: string, now: Date): MeetingStatus {
  if (meeting.cancelled_at) return 'cancelled';
  if (meeting.meeting_date < today) return 'completed';
  if (meeting.ends_at && new Date(meeting.ends_at) < now) return 'completed';
  return 'upcoming';
}

function withStatus<T extends MeetingTiming>(meeting: T) {
  return { ...meeting, status: getMeetingStatus(meeting, parisToday(), new Date()) };
}

// member_since, or the account creation date when it is empty
function joinedOn(profile: { member_since: string | null; created_at: string }): string {
  return profile.member_since ?? profile.created_at.slice(0, 10);
}

function generateCheckInCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// The check-in window must sit on meeting_date in Paris time, ending after it starts
function assertValidWindow(window: { meeting_date: string; starts_at?: string | null; ends_at?: string | null }) {
  for (const time of [window.starts_at, window.ends_at]) {
    if (time && parisDate(new Date(time)) !== window.meeting_date) {
      throw Errors.badRequest('starts_at and ends_at must fall on meeting_date (Paris time)');
    }
  }
  if (window.starts_at && window.ends_at && new Date(window.ends_at) <= new Date(window.starts_at)) {
    throw Errors.badRequest('ends_at must be after starts_at');
  }
}

// First and last day of a year, or of one month in it
function periodRange(year: number, month?: number) {
  if (!month) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDay}` };
}

// Haversine distance between two coordinates, in metres
function distanceInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Meeting is active, today is meeting_date (Europe/Paris), window open.
// With no starts_at / ends_at, check-in stays open all day while active.
function assertCheckInOpen(meeting: MeetingTiming & { is_active: boolean; starts_at: string | null }) {
  const now = new Date();
  if (meeting.cancelled_at) throw Errors.badRequest('This meeting was cancelled');
  if (!meeting.is_active) throw Errors.badRequest('Check-in is not open for this meeting');
  if (meeting.meeting_date !== parisToday()) throw Errors.badRequest('Check-in is only open on the day of the meeting');
  if (meeting.starts_at && now < new Date(meeting.starts_at)) throw Errors.badRequest('Check-in has not opened yet');
  if (meeting.ends_at && now > new Date(meeting.ends_at)) throw Errors.badRequest('Check-in has closed');
}

// Submitted point is within meeting radius and GPS accuracy is acceptable.
// Returns the distance so it can be stored on the record.
function assertWithinGeofence(meeting: { latitude: number; longitude: number; radius_m: number }, input: CheckInInput): number {
  if (input.accuracy > MAX_ACCURACY_M) {
    throw Errors.badRequest('Your location is not precise enough. Move somewhere with better signal and try again');
  }

  const distance = distanceInMeters(meeting.latitude, meeting.longitude, input.latitude, input.longitude);
  if (distance > meeting.radius_m) {
    throw Errors.badRequest(`You are ${Math.round(distance)} m from the meeting; check-in requires being within ${meeting.radius_m} m`);
  }

  return distance;
}

// Members who could be expected at a meeting on or before upTo — complete
// member profiles, filtered per meeting by joined_on in buildAttendance
async function getExpectedMembers(upTo: string): Promise<MemberWithJoinDate[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(`${MEMBER_FIELDS}, member_since, created_at`)
    .eq('role', 'member')
    .eq('is_complete', true)
    .order('name');

  if (error) throw Errors.internal(error.message);

  return (data ?? [])
    .map(({ member_since, created_at, ...member }) => ({ ...member, joined_on: joinedOn({ member_since, created_at }) }))
    .filter(member => member.joined_on <= upTo);
}

async function getRecords(meetingIds: string[]): Promise<RecordRow[]> {
  const { data, error } = await supabase
    .from(RECORDS)
    .select(RECORD_SELECT)
    .in('meeting_id', meetingIds)
    .order('recorded_at');

  if (error) throw Errors.internal(error.message);
  return (data ?? []) as unknown as RecordRow[];
}

async function getMeetingsInPeriod(year: number, month?: number): Promise<MeetingRow[]> {
  const { from, to } = periodRange(year, month);

  const { data, error } = await supabase
    .from(MEETINGS)
    .select(MEETING_COLUMNS)
    .is('cancelled_at', null)
    .gte('meeting_date', from)
    .lte('meeting_date', to)
    .order('meeting_date', { ascending: false })
    .order('starts_at', { ascending: false, nullsFirst: false });

  if (error) throw Errors.internal(error.message);
  return data ?? [];
}

// Attended comes from records, so it includes anyone an admin marked.
// Unavailable is expected members with no record, and only once the meeting
// is completed, so nobody is Unavailable while check-in is still open.
async function buildAttendance(meetings: MeetingRow[]) {
  if (!meetings.length) return [];

  const today = parisToday();
  const now = new Date();
  const latest = meetings.reduce((max, m) => (m.meeting_date > max ? m.meeting_date : max), meetings[0].meeting_date);

  const [members, records] = await Promise.all([
    getExpectedMembers(latest),
    getRecords(meetings.map(m => m.id)),
  ]);

  const recordsByMeeting = new Map<string, RecordRow[]>();
  for (const record of records) {
    const list = recordsByMeeting.get(record.meeting_id) ?? [];
    list.push(record);
    recordsByMeeting.set(record.meeting_id, list);
  }

  return meetings.map(meeting => {
    const status = getMeetingStatus(meeting, today, now);
    const attended = recordsByMeeting.get(meeting.id) ?? [];
    const attendedIds = new Set(attended.map(r => r.user_id));
    const expected = members.filter(m => m.joined_on <= meeting.meeting_date);
    const unavailable = status === 'completed' ? expected.filter(m => !attendedIds.has(m.id)) : [];

    return { meeting: { ...meeting, status }, expected: expected.length, attended, unavailable };
  });
}

type MeetingAttendance = Awaited<ReturnType<typeof buildAttendance>>[number];

// One row per member, Attended first, in the order records were made
function attendanceRows(entry: MeetingAttendance) {
  const attended = entry.attended.map(r => ({
    record_id: r.id,
    user_id: r.user_id,
    member: r.member,
    status: 'Attended' as HistoryStatus,
    recorded_at: r.recorded_at,
    validation_status: r.validation_status,
    distance_m: r.distance_m,
  }));

  const unavailable = entry.unavailable.map(({ joined_on, ...member }) => ({
    record_id: null,
    user_id: member.id,
    member,
    status: 'Unavailable' as HistoryStatus,
    recorded_at: null,
    validation_status: null,
    distance_m: null,
  }));

  return [...attended, ...unavailable];
}

// Writes a meeting patch; if migration 011 (activated_at) isn't applied yet,
// retries without that column instead of failing the admin's action.
async function updateMeetingRow(meetingId: string, patch: Record<string, unknown>) {
  let res = await supabase.from(MEETINGS).update(patch).eq('id', meetingId).select(MEETING_COLUMNS).single();
  if (res.error && 'activated_at' in patch && /activated_at/.test(res.error.message)) {
    const { activated_at, ...rest } = patch;
    res = await supabase.from(MEETINGS).update(rest).eq('id', meetingId).select(MEETING_COLUMNS).single();
  }
  if (res.error) throw Errors.internal(res.error.message);
  return res.data;
}

// Push + email "meeting ongoing" right away instead of waiting for the next job tick
function triggerReminders(meetingId: string) {
  runAttendanceReminders(meetingId).catch(err =>
    console.error('[attendance] reminder trigger failed:', err?.message ?? err));
}

function matchesStatus(rowStatus: HistoryStatus, filter?: 'attended' | 'unavailable') {
  return !filter || rowStatus.toLowerCase() === filter;
}

export const attendanceService = {

  // Validate window + code + geofence, insert record; conflict on duplicate.
  // The code check comes before the geofence so a wrong code never reveals distance.
  async checkIn(userId: string, input: CheckInInput) {
    const { data: meeting, error: meetingError } = await supabase
      .from(MEETINGS)
      .select('id, meeting_date, starts_at, ends_at, cancelled_at, is_active, latitude, longitude, radius_m, check_in_code')
      .eq('id', input.meeting_id)
      .maybeSingle();

    if (meetingError) throw Errors.internal(meetingError.message);
    if (!meeting) throw Errors.notFound('Meeting');

    assertCheckInOpen(meeting);
    if (input.check_in_code !== meeting.check_in_code) throw Errors.badRequest('Invalid check-in code');
    const distance = assertWithinGeofence(meeting, input);

    const { data, error } = await supabase
      .from(RECORDS)
      .insert({
        meeting_id: meeting.id,
        user_id: userId,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy_m: input.accuracy,
        distance_m: Math.round(distance * 10) / 10,
        validation_status: 'geofence_verified',
      })
      .select('id, meeting_id, status, recorded_at, distance_m')
      .single();

    if (error?.code === '23505') throw Errors.conflict('You have already checked in to this meeting');
    if (error) throw Errors.internal(error.message);

    return data;
  },

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

    const joined = joinedOn(profile);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const from = joined > yearStart ? joined : yearStart;
    const to = today < yearEnd ? today : yearEnd;

    const empty = { year, joined_on: joined, totals: { attended: 0, unavailable: 0 }, months: [] };
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

    return { year, joined_on: joined, totals, months };
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

    return withStatus(data);
  },

  // The only response that carries check_in_code, for the admin to announce
  async createMeeting(input: CreateMeetingInput) {
    assertValidWindow(input);

    const row: Record<string, unknown> = { ...input, check_in_code: generateCheckInCode() };
    if (input.is_active) row.activated_at = new Date().toISOString();

    let res = await supabase.from(MEETINGS).insert(row).select(`${MEETING_COLUMNS}, check_in_code`).single();
    if (res.error && /activated_at/.test(res.error.message)) {
      delete row.activated_at;
      res = await supabase.from(MEETINGS).insert(row).select(`${MEETING_COLUMNS}, check_in_code`).single();
    }
    if (res.error) throw Errors.internal(res.error.message);

    if (input.is_active) triggerReminders(res.data.id);
    return withStatus(res.data);
  },

  // cancelled: true stamps cancelled_at and deactivates; false restores the meeting
  async updateMeeting(meetingId: string, input: UpdateMeetingInput) {
    const { cancelled, ...fields } = input;
    const current = await attendanceService.getMeeting(meetingId);

    assertValidWindow({
      meeting_date: fields.meeting_date ?? current.meeting_date,
      starts_at: fields.starts_at !== undefined ? fields.starts_at : current.starts_at,
      ends_at: fields.ends_at !== undefined ? fields.ends_at : current.ends_at,
    });

    const patch: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() };
    if (cancelled !== undefined) {
      patch.cancelled_at = cancelled ? (current.cancelled_at ?? new Date().toISOString()) : null;
      if (cancelled) patch.is_active = false;
    }

    const data = await updateMeetingRow(meetingId, patch);

    // Tell members when an upcoming meeting is called off
    if (cancelled === true && !current.cancelled_at && current.status === 'upcoming') {
      notifyInBackground({
        category: 'meetings',
        title:    'Meeting cancelled',
        body:     `${current.title} on ${current.meeting_date} has been cancelled. We'll share the new date soon.`,
        audience: { type: 'all' },
        channels: ['push', 'email'],
        data:     { route: '/(tabs)/(community)/attendance', type: 'meeting_cancelled', meeting_id: meetingId },
        source:   'automatic',
        jobKey:   `meeting:${meetingId}:cancelled`,
      });
    }
    return withStatus(data);
  },

  // Only upcoming meetings can be activated; any meeting can be deactivated
  async setMeetingActive(meetingId: string, input: SetMeetingActiveInput) {
    const current = await attendanceService.getMeeting(meetingId);
    if (input.is_active && current.status !== 'upcoming') {
      throw Errors.badRequest(`Cannot activate a ${current.status} meeting`);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { is_active: input.is_active, updated_at: now };
    if (input.is_active && !current.is_active) patch.activated_at = now;

    const data = await updateMeetingRow(meetingId, patch);
    if (input.is_active) triggerReminders(meetingId);
    return withStatus(data);
  },

  // Admin: read the code to announce in the room (it is never sent to members)
  async getCheckInCode(meetingId: string) {
    const { data, error } = await supabase
      .from(MEETINGS).select('id, check_in_code').eq('id', meetingId).maybeSingle();
    if (error) throw Errors.internal(error.message);
    if (!data) throw Errors.notFound('Meeting');
    return { meeting_id: data.id, check_in_code: data.check_in_code };
  },

  // Admin: issue a fresh code, e.g. if the old one leaked outside the room
  async regenerateCheckInCode(meetingId: string) {
    await attendanceService.getMeeting(meetingId);
    const code = generateCheckInCode();
    const { error } = await supabase
      .from(MEETINGS).update({ check_in_code: code, updated_at: new Date().toISOString() }).eq('id', meetingId);
    if (error) throw Errors.internal(error.message);
    return { meeting_id: meetingId, check_in_code: code };
  },

  // Records go with it through the cascading foreign key
  async deleteMeeting(meetingId: string) {
    const { data, error } = await supabase
      .from(MEETINGS)
      .delete()
      .eq('id', meetingId)
      .select('id');

    if (error) throw Errors.internal(error.message);
    if (!data?.length) throw Errors.notFound('Meeting');

    return { deleted: true, id: meetingId };
  },

  // Expected members for one meeting, split into attended / unavailable
  async getMeetingRoster(meetingId: string, query: RosterQuery) {
    const meeting = await attendanceService.getMeeting(meetingId);
    const [entry] = await buildAttendance([meeting]);

    return {
      meeting: entry.meeting,
      totals: { expected: entry.expected, attended: entry.attended.length, unavailable: entry.unavailable.length },
      members: attendanceRows(entry).filter(row => matchesStatus(row.status, query.status)),
    };
  },

  // Admin override — validation_status = 'admin_override'
  async markAttendanceManually(meetingId: string, input: ManualMarkInput) {
    const meeting = await attendanceService.getMeeting(meetingId);
    if (meeting.status === 'cancelled') throw Errors.badRequest('Cannot mark attendance for a cancelled meeting');
    if (meeting.meeting_date > parisToday()) throw Errors.badRequest('Cannot mark attendance before the meeting date');

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', input.user_id)
      .maybeSingle();

    if (profileError) throw Errors.internal(profileError.message);
    if (!profile) throw Errors.notFound('Member');

    const { data, error } = await supabase
      .from(RECORDS)
      .insert({ meeting_id: meetingId, user_id: input.user_id, validation_status: 'admin_override' })
      .select(RECORD_SELECT)
      .single();

    if (error?.code === '23505') throw Errors.conflict('Member is already marked as attended for this meeting');
    if (error) throw Errors.internal(error.message);

    return data;
  },

  async deleteRecord(recordId: string) {
    const { data, error } = await supabase
      .from(RECORDS)
      .delete()
      .eq('id', recordId)
      .select('id');

    if (error) throw Errors.internal(error.message);
    if (!data?.length) throw Errors.notFound('Attendance record');

    return { deleted: true, id: recordId };
  },

  // Records across meetings, filtered by month / year / status / member.
  // Unavailable rows are derived, so they have no record_id.
  async listRecords(query: ListRecordsQuery) {
    const year = query.year ?? Number(parisToday().slice(0, 4));
    const entries = await buildAttendance(await getMeetingsInPeriod(year, query.month));

    const records = entries.flatMap(entry => {
      const meeting = {
        id: entry.meeting.id,
        title: entry.meeting.title,
        location_name: entry.meeting.location_name,
        meeting_date: entry.meeting.meeting_date,
        starts_at: entry.meeting.starts_at,
      };
      return attendanceRows(entry)
        .filter(row => matchesStatus(row.status, query.status))
        .filter(row => !query.user_id || row.user_id === query.user_id)
        .map(row => ({ meeting, ...row }));
    });

    return { year, month: query.month ?? null, total: records.length, records };
  },

  // Per-meeting attended vs unavailable counts for a month
  async getMonthlySummary(query: SummaryQuery) {
    const today = parisToday();
    const year = query.year ?? Number(today.slice(0, 4));
    const month = query.month ?? Number(today.slice(5, 7));
    const entries = await buildAttendance(await getMeetingsInPeriod(year, month));

    const meetings = entries.map(entry => ({
      meeting_id: entry.meeting.id,
      title: entry.meeting.title,
      meeting_date: entry.meeting.meeting_date,
      starts_at: entry.meeting.starts_at,
      status: entry.meeting.status,
      expected: entry.expected,
      attended: entry.attended.length,
      unavailable: entry.unavailable.length,
    }));

    const totals = {
      meetings: meetings.length,
      attended: meetings.reduce((sum, m) => sum + m.attended, 0),
      unavailable: meetings.reduce((sum, m) => sum + m.unavailable, 0),
    };

    return { year, month, totals, meetings };
  },

  // One member's history — same shape as getMyHistory
  async getMemberHistory(userId: string, query: HistoryQuery) {
    return attendanceService.getMyHistory(userId, query);
  },
};
