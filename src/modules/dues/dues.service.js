import Stripe from 'stripe';
import { supabase } from '../../config/supabase';
import { mailService } from '../mail/mail.service';
import { notificationService } from '../notifications/notifications.service';
import { Errors } from '../../shared/errors';
import { env } from '../../config/env';
import crypto from 'crypto';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia',
});

const DUES_CURRENCY = 'eur';

// ── Occupation-based dues amount ──────────────────────────────────────────
function getDuesAmountCents(occupation) {
  return occupation?.toLowerCase() === 'student' ? 500 : 1000; // €5 or €10
}

const MAX_ADVANCE_MONTHS = 12;

// Dues months follow the association's calendar (Paris), not the server's zone
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.APP_TIMEZONE, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return {
    year:  Number(parts.find(p => p.type === 'year').value),
    month: Number(parts.find(p => p.type === 'month').value),
  };
}

function nextMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

const monthKey  = ({ year, month }) => year * 100 + month;
const monthName = (m) => new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
const shortName = (m) => new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

// "November 2026 Dues" or "Nov 2026 – Jan 2027 Dues (3 months)"
function duesLabel(months) {
  if (months.length === 1) return `${monthName(months[0])} Dues ${months[0].year}`;
  const a = months[0], b = months[months.length - 1];
  return `${shortName(a)} ${a.year} – ${shortName(b)} ${b.year} Dues (${months.length} months)`;
}

// Set of yyyymm keys the member has already paid, from `from` onwards
async function paidMonthKeys(userId, from) {
  const { data } = await supabase
    .from('payments')
    .select('month, year')
    .eq('user_id', userId)
    .eq('type', 'dues')
    .eq('status', 'completed')
    .gte('year', from.year);
  return new Set((data ?? []).map(monthKey).filter(k => k >= monthKey(from)));
}

// The next `count` unpaid months, starting with the current month
async function nextUnpaidMonths(userId, count) {
  let cursor = currentMonth();
  const paid = await paidMonthKeys(userId, cursor);
  const out = [];
  for (let i = 0; i < 36 && out.length < count; i++) {
    if (!paid.has(monthKey(cursor))) out.push(cursor);
    cursor = nextMonth(cursor);
  }
  return out;
}

export const duesService = {

  // ── Dues status: this month + how far ahead the member has paid ──────────
  async getStatus(userId) {
    const now = currentMonth();
    const { month, year } = now;

    const { data: profile } = await supabase
      .from('profiles')
      .select('occupation')
      .eq('id', userId)
      .single();

    const duesAmountCents = getDuesAmountCents(profile?.occupation ?? '');

    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'dues')
      .eq('month', month)
      .eq('year', year)
      .maybeSingle();

    // Walk forward from this month while consecutive months are paid
    const paid = await paidMonthKeys(userId, now);
    let cursor = now, paidThrough = null, monthsAhead = 0;
    while (paid.has(monthKey(cursor)) && monthsAhead < 36) {
      paidThrough = cursor;
      monthsAhead++;
      cursor = nextMonth(cursor);
    }
    const advanceMonths = [...paid].filter(k => k > monthKey(now)).sort()
      .map(k => ({ year: Math.floor(k / 100), month: k % 100 }));

    return {
      paid:               !!data,
      payment:            data ?? null,
      month,
      year,
      label:              `${monthName(now)} Dues ${year}`,
      amount:             duesAmountCents / 100,
      amount_per_month:   duesAmountCents / 100,
      currency:           DUES_CURRENCY.toUpperCase(),
      paid_through:       paidThrough,          // { year, month } | null
      paid_through_label: paidThrough ? `${monthName(paidThrough)} ${paidThrough.year}` : null,
      months_paid_ahead:  Math.max(0, monthsAhead - (data ? 1 : 0)),
      advance_months:     advanceMonths,
      max_advance_months: MAX_ADVANCE_MONTHS,
    };
  },

  // ── Get payment history (dues only) ─────────────────────────────────────
  async getHistory(userId) {
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'dues')
      .order('year',  { ascending: false })
      .order('month', { ascending: false });

    return data ?? [];
  },

  // ── Create PaymentIntent (dues or donation) ──────────────────────────────
  async createPaymentIntent(
    userId,
    type,
    donationAmountCents,
    monthsCount = 1,
  ) {
    const { month, year } = currentMonth();
    let coveredMonths = [];

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, occupation')
      .eq('id', userId)
      .single();

    if (!profile) throw Errors.notFound('Profile');

    const thisMonthName = monthName({ year, month });

    let amountCents;
    let label;
    let description;

    if (type === 'dues') {
      // Next N unpaid months — skips months already paid, so paying ahead
      // after this month is settled simply starts from next month.
      const count = Math.min(Math.max(1, Number(monthsCount) || 1), MAX_ADVANCE_MONTHS);
      coveredMonths = await nextUnpaidMonths(userId, count);
      if (!coveredMonths.length) throw Errors.conflict('Dues are already paid for the coming months');

      amountCents = getDuesAmountCents(profile.occupation ?? '') * coveredMonths.length;
      label       = duesLabel(coveredMonths);
      description = `GHAFRA ${label} — ${profile.name}`;
    } else {
      // Donation
      if (!donationAmountCents || donationAmountCents < 100) {
        throw Errors.badRequest('Donation amount must be at least €1');
      }
      amountCents = donationAmountCents;
      label       = `Donation — ${thisMonthName} ${year}`;
      description = `GHAFRA Donation — ${profile.name}`;
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: DUES_CURRENCY,
      metadata: {
        user_id: userId,
        email:   profile.email,
        name:    profile.name,
        type,
        month:   String(coveredMonths[0]?.month ?? month),
        year:    String(coveredMonths[0]?.year ?? year),
        // "2026-11,2026-12,2027-1" — every month this payment covers
        months:  coveredMonths.map(m => `${m.year}-${m.month}`).join(','),
        label,
      },
      description,
      receipt_email: profile.email,
    });

    return {
      client_secret:     intent.client_secret,
      payment_intent_id: intent.id,
      amount:            amountCents / 100,
      currency:          DUES_CURRENCY.toUpperCase(),
      label,
      type,
      months: coveredMonths,
    };
  },

  // ── Confirm Payment ─────────────────────────────────────────────────────
  async confirmPayment(
    userId,
    paymentIntentId,
    type,
  ) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'succeeded') {
      throw Errors.badRequest(`Payment not completed. Status: ${intent.status}`);
    }

    if (intent.metadata.user_id !== userId) {
      throw Errors.forbidden();
    }

    const month = parseInt(intent.metadata.month);
    const year  = parseInt(intent.metadata.year);

    // Months covered (older intents only carry month/year)
    const covered = type === 'dues'
      ? (intent.metadata.months
          ? intent.metadata.months.split(',').map(s => { const [y, m] = s.split('-').map(Number); return { year: y, month: m }; })
          : [{ year, month }])
      : [{ year, month }];

    // Already recorded (retry / webhook race)?
    const { data: intentRows } = await supabase
      .from('payments')
      .select('id, month, year')
      .eq('stripe_payment_intent_id', intent.id);
    const recordedKeys = new Set((intentRows ?? []).map(monthKey));

    // Months paid separately in the meantime are skipped, not double-recorded
    let toInsert = covered.filter(m => !recordedKeys.has(monthKey(m)));
    if (type === 'dues' && toInsert.length) {
      const paid = await paidMonthKeys(userId, toInsert[0]);
      toInsert = toInsert.filter(m => !paid.has(monthKey(m)));
    }
    if (!toInsert.length) return { already_recorded: true };

    const perMonth = Math.round(intent.amount / covered.length) / 100;
    const rows = toInsert.map(m => ({
      user_id:                  userId,
      type,
      month:                    m.month,
      year:                     m.year,
      amount:                   type === 'dues' ? perMonth : intent.amount / 100,
      currency:                 intent.currency.toUpperCase(),
      method:                   'card',
      status:                   'completed',
      stripe_payment_intent_id: intent.id,
      label:                    type === 'dues' && covered.length > 1
        ? `${monthName(m)} Dues ${m.year} (advance)`
        : intent.metadata.label,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('payments')
      .insert(rows)
      .select();

    if (insertError) throw insertError;
    const payment = { ...inserted[0], months_covered: toInsert };

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single();

    if (profile) {
      const coveredLabel = toInsert.length === 1
        ? `${monthName(toInsert[0])} ${toInsert[0].year}`
        : `${toInsert.length} months (${shortName(toInsert[0])} ${toInsert[0].year} – ${shortName(toInsert[toInsert.length - 1])} ${toInsert[toInsert.length - 1].year})`;

      const notifBody = type === 'dues'
        ? `Your dues for ${coveredLabel} (€${intent.amount / 100}) have been received. Thank you!`
        : `Your donation of €${intent.amount / 100} has been received. Thank you! `;

      const mailPayload = type === 'dues'
        ? mailService.sendDuesReceipt({
            name:     profile.name,
            email:    profile.email,
            month:    coveredLabel,
            year:     '',
            amount:   intent.amount / 100,
            currency: intent.currency.toUpperCase(),
          })
        : mailService.sendDonationReceipt?.({
            name:     profile.name,
            email:    profile.email,
            amount:   intent.amount / 100,
            currency: intent.currency.toUpperCase(),
          });

      await Promise.allSettled([
        mailPayload,
        notificationService.sendToUser(userId, {
          title: 'Payment confirmed',
          body:  notifBody,
        }, { type: 'dues' }, 'dues'),
      ]);
    }

    return payment;
  },

  // ── Stripe Webhook ──────────────────────────────────────────────────────
  async handleWebhook(rawBody, signature) {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      throw Errors.badRequest(`Webhook signature failed: ${err.message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const t = intent.metadata?.type ?? 'unknown';
        console.log(`Webhook: ${t} paid — ${intent.metadata?.email}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        console.error(`Webhook: payment failed — ${intent.metadata?.email}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return { received: true };
  },

  async verifyCode(code) {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Reconstruct every possible code for this month and compare
  const { data: payments } = await supabase
    .from('payments')
    .select('user_id, month, year')
    .eq('type', 'dues')
    .eq('month', month)
    .eq('year', year)
    .eq('status', 'completed');

  if (!payments?.length) return { valid: false };

  for (const payment of payments) {
    const expected = crypto
      .createHmac('sha256', env.CARD_SECRET)
      .update(`${payment.user_id}-${payment.month}-${payment.year}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();

    if (expected === code.toUpperCase().replace(/\s/g, '')) {
      // Fetch the member's name to show the verifier
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, photo_url, city, member_type')
        .eq('id', payment.user_id)
        .single();

      return {
        valid:  true,
        month,
        year,
        member: profile ?? null,
      };
    }
  }

  return { valid: false };
},


async getVerifyCode(userId ) {
  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Only generate a code if dues are paid this month
  const { data } = await supabase
    .from('payments')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'dues')
    .eq('month', month)
    .eq('year', year)
    .eq('status', 'completed')
    .single();

  if (!data) return null;

  const code = crypto
    .createHmac('sha256', env.CARD_SECRET)
    .update(`${userId}-${month}-${year}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();

  // Format as "A3F9 B21C" for readability
  return `${code.slice(0, 4)} ${code.slice(4)}`;
},
};