/**
 * push.transport.ts
 *
 * Delivers push messages to device tokens. The mobile app registers Expo push
 * tokens (ExponentPushToken[...]), which Firebase Admin cannot deliver to — they
 * must go through Expo's push service, which then hands them to APNs / FCM.
 * Any raw FCM tokens (older installs, other clients) still go through Firebase.
 *
 * Tokens the providers report as dead are deleted so they stop costing sends.
 */
import { fcm }      from '../../config/firebase';
import { supabase } from '../../config/supabase';
import { env }      from '../../config/env';

const EXPO_PUSH_URL   = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;   // Expo's documented max per request
const FCM_BATCH_SIZE  = 500;   // FCM multicast max

export type PushMessage = {
  title:     string;
  body:      string;
  data?:     Record<string, string>;
  /** Android notification channel; the app creates these on startup */
  channelId?: string;
  /** iOS badge count */
  badge?:    number;
};

export type PushResult = { sent: number; failed: number; removed: number };

export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function removeTokens(tokens: string[]) {
  if (!tokens.length) return;
  const { error } = await supabase.from('fcm_tokens').delete().in('token', tokens);
  if (error) console.error('[push] failed to remove dead tokens:', error.message);
  else console.log(`[push] removed ${tokens.length} dead token(s)`);
}

// ── Expo ─────────────────────────────────────────────────────────────────────

type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

async function sendExpo(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  const dead: string[] = [];

  for (const batch of chunk(tokens, EXPO_BATCH_SIZE)) {
    const payload = batch.map(to => ({
      to,
      title:     msg.title,
      body:      msg.body,
      data:      msg.data ?? {},
      sound:     'default',
      priority:  'high',
      channelId: msg.channelId ?? 'default',
      ...(msg.badge !== undefined ? { badge: msg.badge } : {}),
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: {
          Accept:            'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type':    'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error(`[push] Expo responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
        result.failed += batch.length;
        continue;
      }

      const json = await res.json() as { data?: ExpoTicket[] };
      (json.data ?? []).forEach((ticket, i) => {
        if (ticket.status === 'ok') { result.sent++; return; }
        result.failed++;
        if (ticket.details?.error === 'DeviceNotRegistered') dead.push(batch[i]);
        else console.warn('[push] Expo ticket error:', ticket.message);
      });
    } catch (err: any) {
      console.error('[push] Expo request failed:', err?.message);
      result.failed += batch.length;
    }
  }

  await removeTokens(dead);
  result.removed = dead.length;
  return result;
}

// ── FCM ──────────────────────────────────────────────────────────────────────

const DEAD_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

async function sendFcm(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  const dead: string[] = [];

  for (const batch of chunk(tokens, FCM_BATCH_SIZE)) {
    try {
      const res = await fcm.sendEachForMulticast({
        tokens:       batch,
        notification: { title: msg.title, body: msg.body },
        data:         msg.data,
        android:      { priority: 'high', notification: { channelId: msg.channelId ?? 'default', sound: 'default' } },
        apns:         { payload: { aps: { sound: 'default', ...(msg.badge !== undefined ? { badge: msg.badge } : {}) } } },
      });
      result.sent   += res.successCount;
      result.failed += res.failureCount;
      res.responses.forEach((r, i) => {
        if (!r.success && r.error && DEAD_FCM_CODES.has(r.error.code)) dead.push(batch[i]);
      });
    } catch (err: any) {
      console.error('[push] FCM request failed:', err?.message);
      result.failed += batch.length;
    }
  }

  await removeTokens(dead);
  result.removed = dead.length;
  return result;
}

// ── Public ───────────────────────────────────────────────────────────────────

export async function sendPush(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (!unique.length) return { sent: 0, failed: 0, removed: 0 };

  const expo = unique.filter(isExpoToken);
  const raw  = unique.filter(t => !isExpoToken(t));

  const [a, b] = await Promise.all([
    expo.length ? sendExpo(expo, msg) : Promise.resolve({ sent: 0, failed: 0, removed: 0 }),
    raw.length  ? sendFcm(raw, msg)   : Promise.resolve({ sent: 0, failed: 0, removed: 0 }),
  ]);

  return { sent: a.sent + b.sent, failed: a.failed + b.failed, removed: a.removed + b.removed };
}
