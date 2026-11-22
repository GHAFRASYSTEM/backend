import { resend } from '../../config/resend';
import { env }    from '../../config/env';
import { emailLayout, escapeHtml } from './templates/layout';

const from = () => `${env.APP_NAME} <${env.RESEND_FROM_EMAIL}>`;

function p(html: string) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2933;">${html}</p>`;
}

export const mailService = {

  async sendWelcome({ name, email }: { name: string; email: string }) {
    await resend.emails.send({
      from:    from(),
      to:      email,
      subject: 'Welcome to GHAFRA',
      html:    emailLayout({
        title:    `Akwaaba, ${name}!`,
        preheader: 'Your GHAFRA membership profile is now active.',
        bodyHtml: p('Your GHAFRA membership profile is now active.') +
                  p('In the app you can sign meeting attendance, pay dues (even months in advance), practise French with your AI tutor, and stay on top of community news.'),
      }),
    });
  },

  /** `month` may be a single month ("November") or a period ("3 months (Nov 2026 – Jan 2027)"). */
  async sendDuesReceipt(payload: {
    name:     string;
    email:    string;
    month:    string;
    year:     number | string;
    amount:   number;
    currency: string;
  }) {
    const period = `${payload.month} ${payload.year}`.trim();
    await resend.emails.send({
      from:    from(),
      to:      payload.email,
      subject: `GHAFRA — Dues receipt for ${period}`,
      html:    emailLayout({
        title:    'Dues received — thank you!',
        preheader: `We received your ${payload.currency} ${payload.amount} dues.`,
        bodyHtml: p(`Hi ${escapeHtml(payload.name)},`) +
                  p(`We received your dues of <strong>${escapeHtml(payload.currency)} ${payload.amount}</strong> for <strong>${escapeHtml(period)}</strong>.`) +
                  p('Your support keeps GHAFRA strong. You can see all your payments in the app under My Card → View Transactions.'),
      }),
    });
  },

  async sendDonationReceipt(payload: {
    name:     string;
    email:    string;
    amount:   number;
    currency: string;
    campaign?: string;
  }) {
    await resend.emails.send({
      from:    from(),
      to:      payload.email,
      subject: 'Thank you for your GHAFRA donation',
      html:    emailLayout({
        title:    'Thank you for your donation',
        bodyHtml: p(`Hi ${escapeHtml(payload.name)},`) +
                  p(`Thank you for your generous donation of <strong>${escapeHtml(payload.currency)} ${payload.amount}</strong>${payload.campaign ? ` to ${escapeHtml(payload.campaign)}` : ''}.`),
      }),
    });
  },
};
