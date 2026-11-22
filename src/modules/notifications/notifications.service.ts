/**
 * notifications.service.ts
 *
 * One entry point — notify() — for every notification the platform sends:
 * dashboard custom sends, attendance, dues, announcements, meeting countdown,
 * daily French practice. It:
 *
 *   1. resolves the audience to member ids
 *   2. drops members who switched that category off (push + email only;
 *      the in-app inbox always gets a copy)
 *   3. writes the inbox rows
 *   4. sends push (Expo + FCM) and, optionally, email
 *   5. records a campaign row with delivery counts
 *
 * Automatic sends pass a jobKey: the campaign row is claimed first via a
 * unique constraint, so a restart or a second instance never double-sends.
 */
import { supabase }  from '../../config/supabase';
import { resend }    from '../../config/resend';
import { env }       from '../../config/env';
import { sendPush }  from './push.transport';
import { emailLayout, textToHtml } from '../mail/templates/layout';

export const CATEGORIES = [
  'meetings', 'attendance', 'dues', 'announcements',
  'french_practice', 'opportunities', 'general',
] as const;
export type Category = typeof CATEGORIES[number];

export type Audience =
  | { type: 'all' }
  | { type: 'users';          userIds: string[] }
  | { type: 'unpaid_dues';    month: number; year: number }
  | { type: 'not_checked_in'; meetingId: string }
  | { type: 'not_practiced_today'; day: string }
  | { type: 'city';           city: string };

export type Channel = 'push' | 'email';

export type NotifyInput = {
  category:  Category;
  title:     string;
  body:      string;
  audience:  Audience;
  channels?: Channel[];                 // default ['push']
  data?:     Record<string, string>;    // deep-link payload for the app
  source?:   'manual' | 'automatic';
  jobKey?:   string;
  sentBy?:   string | null;
  email?:    { subject?: string; html?: string; cta?: { label: string; url: string } };
};

export type NotifyResult = {
  campaignId:  string | null;
  skipped:     boolean;     // jobKey already used
  recipients:  number;
  pushSent:    number;
  pushFailed:  number;
  emailsSent:  number;
};

const ANDROID_CHANNEL: Record<Category, string> = {
  meetings:        'meetings',
  attendance:      'meetings',
  dues:            'reminders',
  announcements:   'default',
  french_practice: 'reminders',
  opportunities:   'default',
  general:         'default',
};

const IN_CHUNK = 200;   // keep .in() URLs short

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Audience resolution ──────────────────────────────────────────────────────

/** Active members: completed profiles. Admin dashboard accounts are excluded. */
async function activeMemberIds(filter?: { city?: string }): Promise<string[]> {
  let q = supabase.from('profiles').select('id').eq('is_complete', true).neq('role', 'admin');
  if (filter?.city) q = q.ilike('city', filter.city);
  const { data, error } = await q;
  if (error) throw new Error(`audience lookup failed: ${error.message}`);
  return (data ?? []).map(r => r.id);
}

async function idsWithRows(table: string, column: string, ids: string[], apply: (q: any) => any): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids, IN_CHUNK)) {
    const { data, error } = await apply(supabase.from(table).select(column).in(column, part));
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);
    for (const row of data ?? []) found.add(row[column]);
  }
  return found;
}

export async function resolveAudience(audience: Audience): Promise<string[]> {
  switch (audience.type) {
    case 'all':
      return activeMemberIds();

    case 'users':
      return [...new Set(audience.userIds)];

    case 'city':
      return activeMemberIds({ city: audience.city });

    case 'unpaid_dues': {
      const members = await activeMemberIds();
      const paid = await idsWithRows('payments', 'user_id', members, q => q
        .eq('type', 'dues').eq('month', audience.month).eq('year', audience.year).eq('status', 'completed'));
      return members.filter(id => !paid.has(id));
    }

    case 'not_checked_in': {
      const members = await activeMemberIds();
      const { data, error } = await supabase
        .from('attendance_records').select('user_id').eq('meeting_id', audience.meetingId);
      if (error) throw new Error(`attendance lookup failed: ${error.message}`);
      const signed = new Set((data ?? []).map(r => r.user_id));
      return members.filter(id => !signed.has(id));
    }

    case 'not_practiced_today': {
      const members = await activeMemberIds();
      const practised = await idsWithRows('french_practice_log', 'user_id', members, q => q
        .eq('practiced_on', audience.day));
      return members.filter(id => !practised.has(id));
    }
  }
}

// ── Preferences ──────────────────────────────────────────────────────────────

type Prefs = Record<Category, boolean> & { email_enabled: boolean };

async function loadPrefs(userIds: string[]): Promise<Map<string, Prefs>> {
  const map = new Map<string, Prefs>();
  for (const part of chunk(userIds, IN_CHUNK)) {
    const { data, error } = await supabase.from('notification_preferences').select('*').in('user_id', part);
    if (error) {
      // Table not migrated yet → treat everyone as opted in rather than failing the send
      console.warn('[notify] preferences unavailable:', error.message);
      return map;
    }
    for (const row of data ?? []) map.set(row.user_id, row as Prefs);
  }
  return map;
}

// ── Delivery helpers ─────────────────────────────────────────────────────────

async function tokensFor(userIds: string[]): Promise<string[]> {
  const tokens: string[] = [];
  for (const part of chunk(userIds, IN_CHUNK)) {
    const { data, error } = await supabase.from('fcm_tokens').select('token').in('user_id', part);
    if (error) { console.error('[notify] token lookup failed:', error.message); continue; }
    tokens.push(...(data ?? []).map(r => r.token));
  }
  return tokens;
}

async function writeInbox(userIds: string[], input: NotifyInput, campaignId: string | null) {
  const rows = userIds.map(user_id => ({
    user_id,
    category:    input.category,
    title:       input.title,
    body:        input.body,
    data:        input.data ?? {},
    campaign_id: campaignId,
  }));
  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from('user_notifications').insert(part);
    if (error) { console.error('[notify] inbox insert failed:', error.message); return; }
  }
}

async function sendEmails(userIds: string[], input: NotifyInput): Promise<number> {
  if (!userIds.length) return 0;

  const people: { email: string; name: string | null }[] = [];
  for (const part of chunk(userIds, IN_CHUNK)) {
    const { data } = await supabase.from('profiles').select('email, name').in('id', part);
    people.push(...(data ?? []).filter(p => p.email));
  }

  const html = input.email?.html ?? emailLayout({
    title:     input.title,
    preheader: input.body.slice(0, 120),
    bodyHtml:  textToHtml(input.body),
    cta:       input.email?.cta,
  });
  const subject = input.email?.subject ?? input.title;
  const from    = `${env.APP_NAME} <${env.RESEND_FROM_EMAIL}>`;

  let sent = 0;
  // Resend batch API takes up to 100 emails per call
  for (const part of chunk(people, 100)) {
    try {
      const { error } = await resend.batch.send(
        part.map(p => ({ from, to: p.email, subject, html })),
      );
      if (error) console.error('[notify] email batch failed:', error.message);
      else sent += part.length;
    } catch (err: any) {
      console.error('[notify] email batch threw:', err?.message);
    }
  }
  return sent;
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const channels = input.channels ?? ['push'];
  const empty: NotifyResult = { campaignId: null, skipped: false, recipients: 0, pushSent: 0, pushFailed: 0, emailsSent: 0 };

  // 1. Claim the campaign (idempotent when jobKey is set)
  let campaignId: string | null = null;
  {
    const { data, error } = await supabase
      .from('notification_campaigns')
      .insert({
        category: input.category,
        title:    input.title,
        body:     input.body,
        audience: input.audience,
        channels,
        source:   input.source ?? 'manual',
        job_key:  input.jobKey ?? null,
        sent_by:  input.sentBy ?? null,
      })
      .select('id')
      .single();

    if (error?.code === '23505') return { ...empty, skipped: true };
    if (error) {
      // Without the campaign row a job can't prove it hasn't sent already —
      // refuse rather than risk re-sending every minute.
      if (input.jobKey) {
        console.error(`[notify] skipped job ${input.jobKey}: campaign log unavailable (run migration 011): ${error.message}`);
        return { ...empty, skipped: true };
      }
      console.warn('[notify] campaign log unavailable:', error.message);
    }
    campaignId = data?.id ?? null;
  }

  // 2. Audience + preferences
  const userIds = await resolveAudience(input.audience);
  if (!userIds.length) return { ...empty, campaignId };

  const prefs  = await loadPrefs(userIds);
  const wants  = (id: string) => prefs.get(id)?.[input.category] ?? true;
  const pushTo = userIds.filter(wants);
  const mailTo = channels.includes('email')
    ? pushTo.filter(id => prefs.get(id)?.email_enabled ?? true)
    : [];

  // 3. Inbox (everyone in the audience, regardless of push prefs)
  await writeInbox(userIds, input, campaignId);

  // 4. Push + email in parallel
  const pushMsg = {
    title:     input.title,
    body:      input.body,
    channelId: ANDROID_CHANNEL[input.category],
    data:      { category: input.category, ...(input.data ?? {}), ...(campaignId ? { campaign_id: campaignId } : {}) },
  };

  const [push, emailsSent] = await Promise.all([
    channels.includes('push') ? tokensFor(pushTo).then(t => sendPush(t, pushMsg)) : Promise.resolve({ sent: 0, failed: 0, removed: 0 }),
    sendEmails(mailTo, input),
  ]);

  const result: NotifyResult = {
    campaignId,
    skipped:    false,
    recipients: userIds.length,
    pushSent:   push.sent,
    pushFailed: push.failed,
    emailsSent,
  };

  if (campaignId) {
    await supabase.from('notification_campaigns').update({
      recipients:  result.recipients,
      push_sent:   result.pushSent,
      push_failed: result.pushFailed,
      emails_sent: result.emailsSent,
    }).eq('id', campaignId);
  }

  console.log(`[notify] ${input.category} "${input.title}" → ${result.recipients} members, push ${result.pushSent}/${result.pushSent + result.pushFailed}, email ${result.emailsSent}`);
  return result;
}

/** Fire-and-forget wrapper for request handlers: never throws, never blocks. */
export function notifyInBackground(input: NotifyInput) {
  notify(input).catch(err => console.error(`[notify] ${input.category} failed:`, err?.message ?? err));
}

// ── Backwards-compatible API (used by dues, auth, opportunities) ─────────────

export const notificationService = {
  async sendToUser(
    userId:       string,
    notification: { title: string; body: string },
    data?:        Record<string, string>,
    category:     Category = 'general',
  ) {
    return notify({ category, ...notification, data, audience: { type: 'users', userIds: [userId] }, source: 'automatic' });
  },

  async broadcast(
    notification: { title: string; body: string },
    data?:        Record<string, string>,
    category:     Category = 'general',
  ) {
    return notify({ category, ...notification, data, audience: { type: 'all' }, source: 'automatic' });
  },

  // ── Member inbox ──────────────────────────────────────────────────────────

  async listForUser(userId: string, page: number, limit: number) {
    const from = (page - 1) * limit;
    const [{ data, error, count }, unread] = await Promise.all([
      supabase.from('user_notifications')
        .select('id, category, title, body, data, read_at, created_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1),
      notificationService.unreadCount(userId),
    ]);
    if (error) throw new Error(error.message);
    return { data: data ?? [], total: count ?? 0, unread };
  },

  async unreadCount(userId: string): Promise<number> {
    const { count } = await supabase.from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('read_at', null);
    return count ?? 0;
  },

  async markRead(userId: string, ids: string[] | 'all') {
    let q = supabase.from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId).is('read_at', null);
    if (ids !== 'all') q = q.in('id', ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { unread: await notificationService.unreadCount(userId) };
  },

  async getPreferences(userId: string) {
    const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
    const defaults = Object.fromEntries(CATEGORIES.map(c => [c, true])) as Record<Category, boolean>;
    return { ...defaults, email_enabled: true, ...(data ?? {}) };
  },

  async updatePreferences(userId: string, patch: Partial<Record<Category | 'email_enabled', boolean>>) {
    const { data, error } = await supabase.from('notification_preferences')
      .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('*').single();
    if (error) throw new Error(error.message);
    return data;
  },

  // ── Admin ─────────────────────────────────────────────────────────────────

  async listCampaigns(page: number, limit: number) {
    const from = (page - 1) * limit;
    const { data, error, count } = await supabase.from('notification_campaigns')
      .select('id, category, title, body, audience, channels, source, recipients, push_sent, push_failed, emails_sent, created_at, sender:profiles!notification_campaigns_sent_by_fkey(name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw new Error(error.message);
    return { data: data ?? [], total: count ?? 0 };
  },

  async previewAudience(audience: Audience) {
    const ids = await resolveAudience(audience);
    return { recipients: ids.length };
  },
};
