// Outbound email.
//
// Three providers, chosen by which environment variables are present:
//   SMTP_USER + SMTP_PASS -> SMTP (Gmail by default)
//   RESEND_API_KEY        -> Resend, over plain HTTPS (no SDK)
//   neither               -> log the link and hand it back to the admin
//
// The last case is deliberate: a missing or broken mail setup must never stop
// an account being created. The caller reports `delivered` so the UI can show
// the link for the admin to pass on by hand.
//
// Gmail needs an App Password (Google account -> Security -> App passwords),
// which requires 2FA. A normal account password will be rejected.

const https = require('https');

const RESEND_ENDPOINT = { hostname: 'api.resend.com', path: '/emails', port: 443 };

// Resend's shared sender works without verifying a domain, which is useful
// before MAIL_FROM is configured, but it can only deliver to the account
// owner's own address. Set MAIL_FROM once a domain is verified.
const DEFAULT_FROM = 'QualChek <onboarding@resend.dev>';

function postJson(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        ...RESEND_ENDPOINT,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let msg = `Resend error ${res.statusCode}`;
            try {
              const j = JSON.parse(raw);
              msg = j.message || j.error || msg;
            } catch {
              /* non-JSON error body — keep the status-code message */
            }
            return reject(new Error(msg));
          }
          resolve(raw ? JSON.parse(raw) : {});
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function describeTtl(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// Wording per flow. 'invite' is an admin creating the account; 'reset' is the
// user asking from the sign-in page. Same link, same rules, different framing.
const COPY = {
  invite: {
    subject: appName => `Set your password for ${appName}`,
    intro: appName => `An account has been created for you on ${appName}.`,
    introHtml: 'An account has been created for you. Choose a password to activate it.',
    action: 'Open the link below to choose a password and activate it:',
    button: 'Set your password',
    ifExpired: 'If it has expired, ask an administrator to send another.',
  },
  reset: {
    subject: appName => `Reset your ${appName} password`,
    intro: () => 'We received a request to reset the password for this account.',
    introHtml: 'We received a request to reset your password. Choose a new one below.',
    action: 'Open the link below to choose a new password:',
    button: 'Choose a new password',
    ifExpired: 'If it has expired, request another from the sign-in page. If you did not ask for this, you can ignore this email; your password has not changed.',
  },
};

function inviteText({ name, link, appName, expiresInMinutes, mode = 'invite' }) {
  const c = COPY[mode] || COPY.invite;
  return [
    `Hi ${name},`,
    '',
    c.intro(appName),
    c.action,
    '',
    link,
    '',
    `This link expires in ${describeTtl(expiresInMinutes)} and can only be used once.`,
    c.ifExpired,
    '',
    `-- ${appName}`,
  ].join('\n');
}

function inviteHtml({ name, link, appName, expiresInMinutes, mode = 'invite' }) {
  const c = COPY[mode] || COPY.invite;
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#a31211">${appName}</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55">
        ${c.introHtml}
      </p>
      <p style="margin:0 0 24px">
        <a href="${link}" style="display:inline-block;background:#e81613;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">${c.button}</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280">
        This link expires in ${describeTtl(expiresInMinutes)} and can only be used once.
        ${escapeHtml(c.ifExpired)}
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280">
        If the button does not work, paste this into your browser:<br>
        <span style="word-break:break-all;color:#374151">${link}</span>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/**
 * Send a "set your password" invite.
 * Never throws: user creation must not fail because email delivery did. The
 * caller reports `delivered` so the admin can be told to pass the link on.
 */
async function sendViaSmtp({ to, subject, html, text }) {
  // Required lazily: if the dependency is ever missing from a deployment, this
  // throws here and is caught below, instead of crashing the whole API at boot.
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    // Gmail rewrites From to the authenticated account anyway, so default the
    // address to SMTP_USER and let MAIL_FROM only set the display name.
    from: process.env.MAIL_FROM || `QualChek <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
    // Transactional mail, not bulk - say so explicitly. Some filters look for
    // this and it also stops well-behaved clients offering to unsubscribe.
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
  });
}


// Addresses that can never receive mail.
//
// RFC 2606 and RFC 6761 reserve these for documentation and testing, so no MX
// record will ever exist for them. Handing one to a provider does not fail
// fast: the message is accepted and bounces back minutes later, so a test run
// quietly fills a real inbox with delivery failures. Refusing up front is also
// the right answer for a typo in production - "@gmial.test" is not mail worth
// attempting.
const UNROUTABLE = /@(?:[^@]*\.)?(?:test|example|invalid|localhost)$|@example\.(?:com|net|org)$/i;

const isUnroutable = address => UNROUTABLE.test(String(address || '').trim());

async function sendInvite({ to, name, link, appName = 'QualChek', expiresInMinutes = 60, mode = 'invite' }) {
  if (isUnroutable(to)) {
    console.log(`[mailer] ${to} is a reserved address that cannot receive mail - invite not sent`);
    return { delivered: false, reason: 'unroutable_address', link };
  }
  const subject = (COPY[mode] || COPY.invite).subject(appName);
  const html = inviteHtml({ name, link, appName, expiresInMinutes, mode });
  const text = inviteText({ name, link, appName, expiresInMinutes, mode });

  const useSmtp = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  const useResend = !!process.env.RESEND_API_KEY;

  if (!useSmtp && !useResend) {
    console.log(`[mailer] no mail provider configured — invite link for ${to}: ${link}`);
    return { delivered: false, reason: 'not_configured', link };
  }

  try {
    if (useSmtp) {
      await sendViaSmtp({ to, subject, html, text });
      console.log(`[mailer] invite sent to ${to} via SMTP`);
    } else {
      await postJson(process.env.RESEND_API_KEY, {
        from: process.env.MAIL_FROM || DEFAULT_FROM,
        to: [to],
        subject,
        text,
        html,
      });
      console.log(`[mailer] invite sent to ${to} via Resend`);
    }
    return { delivered: true, link };
  } catch (err) {
    console.error(`[mailer] invite to ${to} failed: ${err.message}`);
    console.log(`[mailer] invite link for ${to}: ${link}`);
    return { delivered: false, reason: err.message, link };
  }
}

/** Public base URL of this deployment, derived from the incoming request. */
function baseUrlFrom(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}


// ---------------------------------------------------------------------------
// Trial decisions
// ---------------------------------------------------------------------------

function decisionHtml({ name, workspace, signInUrl, approved, reason, appName }) {
  const body = approved
    ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Your workspace <strong>${escapeHtml(workspace)}</strong> is ready, and your 14-day trial has started.</p>
       <p style="margin:0 0 20px;font-size:15px;line-height:1.55">Sign in with the email address and password you chose when you applied — there is nothing else to set up.</p>
       <p style="margin:0 0 24px">
         <a href="${signInUrl}" style="display:inline-block;background:#0d8a80;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:15px;font-weight:600">Sign in to ${escapeHtml(appName)}</a>
       </p>
       <p style="margin:0;font-size:13px;color:#6b7280">If the button does not work, paste this into your browser:<br>
         <span style="word-break:break-all;color:#374151">${signInUrl}</span></p>`
    : `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">Thank you for your interest in ${escapeHtml(appName)}. We are not able to set up a trial workspace for you at this time.</p>
       ${reason ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(reason)}</p>` : ''}
       <p style="margin:0;font-size:13px;color:#6b7280">If you think this was a mistake, reply to this message and we will take another look.</p>`;

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#0d8a80">${escapeHtml(appName)}</h1>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.55">Hi ${escapeHtml(name)},</p>
      ${body}
    </td></tr>
  </table>
</body></html>`;
}

function decisionText({ name, workspace, signInUrl, approved, reason, appName }) {
  return approved
    ? [`Hi ${name},`, '',
       `Your workspace "${workspace}" is ready, and your 14-day trial has started.`, '',
       'Sign in with the email address and password you chose when you applied:',
       signInUrl, '', `— ${appName}`].join('\n')
    : [`Hi ${name},`, '',
       `Thank you for your interest in ${appName}. We are not able to set up a trial workspace for you at this time.`,
       ...(reason ? ['', reason] : []),
       '', 'If you think this was a mistake, reply to this message and we will take another look.',
       '', `— ${appName}`].join('\n');
}

/**
 * Tell an applicant what was decided.
 *
 * Never throws. An operator approving a request has already provisioned the
 * workspace by the time this runs, and a mail outage must not turn a successful
 * approval into an error - the applicant can still be told by hand.
 */
async function sendTrialDecision({ to, name, workspace, signInUrl, approved, reason, appName = 'QualChek' }) {
  if (isUnroutable(to)) {
    console.log(`[mailer] ${to} is a reserved address that cannot receive mail - decision not sent`);
    return { delivered: false, reason: 'unroutable_address' };
  }
  const subject = approved
    ? `Your ${appName} workspace is ready`
    : `About your ${appName} trial request`;
  const html = decisionHtml({ name, workspace, signInUrl, approved, reason, appName });
  const text = decisionText({ name, workspace, signInUrl, approved, reason, appName });

  const useSmtp = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  const useResend = !!process.env.RESEND_API_KEY;

  if (!useSmtp && !useResend) {
    console.log(`[mailer] no mail provider configured — ${approved ? 'approval' : 'decline'} for ${to} not sent`);
    return { delivered: false, reason: 'not_configured' };
  }
  try {
    if (useSmtp) await sendViaSmtp({ to, subject, html, text });
    else await postJson(process.env.RESEND_API_KEY, {
      from: process.env.MAIL_FROM || DEFAULT_FROM, to: [to], subject, text, html,
    });
    console.log(`[mailer] trial ${approved ? 'approval' : 'decline'} sent to ${to}`);
    return { delivered: true };
  } catch (err) {
    console.error(`[mailer] trial decision to ${to} failed: ${err.message}`);
    return { delivered: false, reason: err.message };
  }
}

module.exports = { sendInvite, sendTrialDecision, baseUrlFrom };
