import Stripe from 'stripe';
import { supabase } from '../../config/supabase';
import { mailService } from '../mail/mail.service';
import { notificationService } from '../notifications/notifications.service';
import { Errors } from '../../shared/errors';
import { env } from '../../config/env';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia',
});

const DUES_CURRENCY = 'eur';

// ── Occupation-based dues amount ──────────────────────────────────────────
function getDuesAmountCents(occupation) {
  return occupation?.toLowerCase() === 'student' ? 500 : 1000; // €5 or €10
}

export const duesService = {

  // ── Check if user has paid dues this month ───────────────────────────────
  async getStatus(userId) {
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    const { data: profile } = await supabase
      .from('profiles')
      .select('occupation')
      .eq('id', userId)
      .single();

    const occupation       = profile?.occupation ?? '';
    const duesAmountCents  = getDuesAmountCents(occupation);

    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'dues')
      .eq('month', month)
      .eq('year', year)
      .single();

    const monthName = now.toLocaleString('en-GB', { month: 'long' });

    return {
      paid:     !!data,
      payment:  data ?? null,
      month,
      year,
      label:    `${monthName} Dues ${year}`,
      amount:   duesAmountCents / 100,
      currency: DUES_CURRENCY.toUpperCase(),
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
  ) {
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, occupation')
      .eq('id', userId)
      .single();

    if (!profile) throw Errors.notFound('Profile');

    const monthName = now.toLocaleString('en-GB', { month: 'long' });

    let amountCents;
    let label;
    let description;

    if (type === 'dues') {
      // Prevent double payment
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'dues')
        .eq('month', month)
        .eq('year', year)
        .single();

      if (existing) throw Errors.conflict('Dues already paid for this month');

      amountCents = getDuesAmountCents(profile.occupation ?? '');
      label       = `${monthName} Dues ${year}`;
      description = `GHAFRA ${monthName} ${year} Dues — ${profile.name}`;
    } else {
      // Donation
      if (!donationAmountCents || donationAmountCents < 100) {
        throw Errors.badRequest('Donation amount must be at least €1');
      }
      amountCents = donationAmountCents;
      label       = `Donation — ${monthName} ${year}`;
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
        month:   String(month),
        year:    String(year),
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

    // For dues, prevent duplicates
    if (type === 'dues') {
      const { data: duplicate } = await supabase
        .from('payments')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'dues')
        .eq('month', month)
        .eq('year', year)
        .maybeSingle();

      if (duplicate) return { already_recorded: true };
    }

    // Prevent re-recording the same payment intent
    const { data: intentDuplicate } = await supabase
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', intent.id)
      .maybeSingle();

    if (intentDuplicate) return { already_recorded: true };

    const { data: payment, error: insertError } = await supabase
      .from('payments')
      .insert({
        user_id:                  userId,
        type,
        month,
        year,
        amount:                   intent.amount / 100,
        currency:                 intent.currency.toUpperCase(),
        method:                   'card',
        status:                   'completed',
        stripe_payment_intent_id: intent.id,
        label:                    intent.metadata.label,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single();

    if (profile) {
      const monthName = new Date(intent.created * 1000)
        .toLocaleString('en-GB', { month: 'long' });

      const notifBody = type === 'dues'
        ? `Your ${monthName} ${year} dues of €${intent.amount / 100} have been received!`
        : `Your donation of €${intent.amount / 100} has been received. Thank you! 🙏`;

      const mailPayload = type === 'dues'
        ? mailService.sendDuesReceipt({
            name:     profile.name,
            email:    profile.email,
            month:    monthName,
            year,
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
          title: '✅ Payment confirmed',
          body:  notifBody,
        }),
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
        console.log(`✅ Webhook: ${t} paid — ${intent.metadata?.email}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        console.error(`❌ Webhook: payment failed — ${intent.metadata?.email}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }

    return { received: true };
  },
};