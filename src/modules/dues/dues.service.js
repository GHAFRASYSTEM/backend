import Stripe from 'stripe';
import { supabase } from '../../config/supabase';
import { mailService } from '../mail/mail.service';
import { notificationService } from '../notifications/notifications.service';
import { Errors } from '../../shared/errors';
import { env } from '../../config/env';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia',
});

const DUES_AMOUNT_CENTS = 1000; // €10.00
const DUES_CURRENCY = 'eur';

export const duesService = {

  // ── Check if user has paid this month ───────────────────────────────
  async getStatus(userId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const { data } = await supabase
      .from('dues_payments')
      .select('*')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .single();

    const monthName = now.toLocaleString('en-GB', { month: 'long' });

    return {
      paid: !!data,
      payment: data ?? null,
      month,
      year,
      label: `${monthName} Dues ${year}`,
      amount: DUES_AMOUNT_CENTS / 100,
      currency: DUES_CURRENCY.toUpperCase(),
    };
  },

  // ── Get payment history ─────────────────────────────────────────────
  async getHistory(userId) {
    const { data } = await supabase
      .from('dues_payments')
      .select('*')
      .eq('user_id', userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    return data ?? [];
  },

  // ── Create PaymentIntent ────────────────────────────────────────────
  async createPaymentIntent(userId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const { data: existing } = await supabase
      .from('dues_payments')
      .select('id')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .single();

    if (existing) throw Errors.conflict('Dues already paid for this month');

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', userId)
      .single();

    if (!profile) throw Errors.notFound('Profile');

    const monthName = now.toLocaleString('en-GB', { month: 'long' });

    const intent = await stripe.paymentIntents.create({
      amount: DUES_AMOUNT_CENTS,
      currency: DUES_CURRENCY,
      metadata: {
        user_id: userId,
        email: profile.email,
        name: profile.name,
        month: String(month),
        year: String(year),
        type: 'dues',
        label: `${monthName} Dues ${year}`,
      },
      description: `GHAFRA ${monthName} ${year} Dues — ${profile.name}`,
      receipt_email: profile.email,
    });

    return {
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      amount: DUES_AMOUNT_CENTS / 100,
      currency: DUES_CURRENCY.toUpperCase(),
      label: `${monthName} Dues ${year}`,
    };
  },

  // ── Confirm Payment ─────────────────────────────────────────────────
  async confirmPayment(userId, paymentIntentId, method) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'succeeded') {
      throw Errors.badRequest(`Payment not completed. Status: ${intent.status}`);
    }

    if (intent.metadata.user_id !== userId) {
      throw Errors.forbidden();
    }

    const month = parseInt(intent.metadata.month);
    const year = parseInt(intent.metadata.year);

    const { data: duplicate, error: checkError } = await supabase
      .from('dues_payments')
      .select('id')
      .eq('user_id', userId)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle();

    if (checkError) throw checkError;
    if (duplicate) return { already_recorded: true };

    const { data: payment, error: insertError } = await supabase
      .from('dues_payments')
      .insert({
        user_id: userId,
        month,
        year,
        amount: intent.amount / 100,
        currency: intent.currency.toUpperCase(),
        method,
        status: 'completed',
        stripe_payment_intent_id: intent.id,
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
      const now = new Date(intent.created * 1000);
      const monthName = now.toLocaleString('en-GB', { month: 'long' });

      await Promise.allSettled([
        mailService.sendDuesReceipt({
          name: profile.name,
          email: profile.email,
          month: monthName,
          year,
          amount: intent.amount / 100,
          currency: intent.currency.toUpperCase(),
        }),
        notificationService.sendToUser(userId, {
          title: '✅ Payment confirmed',
          body: `Your ${monthName} ${year} dues of €${intent.amount / 100} have been received!`,
        }),
      ]);
    }

    return payment;
  },

  // ── Stripe Webhook ─────────────────────────────────────────────────
  async handleWebhook(rawBody, signature) {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      throw Errors.badRequest(`Webhook signature failed: ${err.message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        if (intent.metadata?.type === 'dues') {
          console.log(`✅ Webhook: dues paid — ${intent.metadata.email}`);
        }
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