import { resend } from '../../config/resend';
import { env }    from '../../config/env';

export const mailService = {

  async sendWelcome({ name, email }: { name: string; email: string }) {
    await resend.emails.send({
      from:    env.RESEND_FROM_EMAIL,
      to:      email,
      subject: 'Welcome to GHAFRA 🇬🇭🇫🇷',
      html:    `<h1>Welcome ${name}!</h1><p>Your GHAFRA membership profile is now active.</p>`,
    });
  },

  async sendDuesReceipt(payload: {
    name:     string;
    email:    string;
    month:    string;
    year:     number;
    amount:   number;
    currency: string;
  }) {
    await resend.emails.send({
      from:    env.RESEND_FROM_EMAIL,
      to:      payload.email,
      subject: `GHAFRA — ${payload.month} ${payload.year} Dues Receipt`,
      html:    `<p>Hi ${payload.name}, we received your ${payload.currency} ${payload.amount} dues for ${payload.month} ${payload.year}. Thank you!</p>`,
    });
  },

  async sendDonationReceipt(payload: {
    name:     string;
    email:    string;
    amount:   number;
    currency: string;
    campaign: string;
  }) {
    await resend.emails.send({
      from:    env.RESEND_FROM_EMAIL,
      to:      payload.email,
      subject: 'Thank you for your GHAFRA donation 🙏',
      html:    `<p>Hi ${payload.name}, thank you for your generous donation of ${payload.currency} ${payload.amount} to ${payload.campaign}.</p>`,
    });
  },
};