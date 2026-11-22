/**
 * Shared, email-client-safe HTML layout (tables + inline styles only).
 * Every outgoing GHAFRA email goes through emailLayout() so they all look the same.
 */

const BRAND   = '#0B6E4F';   // GHAFRA green
const GOLD    = '#F2B705';
const RED     = '#CE1126';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text → paragraphs, with line breaks kept. */
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2933;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function emailLayout(opts: {
  title:      string;
  preheader?: string;
  bodyHtml:   string;
  cta?:       { label: string; url: string };
  footer?:    string;
}): string {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 32px 28px;">
         <a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">${escapeHtml(opts.cta.label)}</a>
       </td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader ?? '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="height:6px;background:linear-gradient(90deg,${RED} 0 33%,${GOLD} 33% 66%,${BRAND} 66% 100%);background-color:${GOLD};"></td></tr>
      <tr><td style="padding:24px 32px 4px;">
        <div style="font-size:13px;font-weight:800;letter-spacing:2px;color:${BRAND};">GHAFRA</div>
        <h1 style="margin:10px 0 16px;font-size:22px;line-height:1.3;color:#111827;">${escapeHtml(opts.title)}</h1>
      </td></tr>
      <tr><td style="padding:0 32px 8px;">${opts.bodyHtml}</td></tr>
      ${cta}
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #eef0ef;font-size:12px;line-height:1.5;color:#6b7280;">
        ${escapeHtml(opts.footer ?? 'You are receiving this because you are a GHAFRA member. You can turn email notifications off in the app under More → Preferences.')}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
