import express from 'express';
import { config } from './config';
import { consumePendingState, findByOID, upsertVerifiedUser, type VerifiedUser } from './db';
import { exchangeCodeForToken, verifyIdToken, type VerifiedUserPayload } from './oauth';

/**
 * `verified_secondary_email` isn't documented as strictly single- or
 * multi-valued, and its on-the-wire shape can vary (a single string, an
 * array of strings, an array of objects, or a delimited string). This
 * normalizes any of those into a flat array of candidate strings.
 */
function normalizeToArray(claimValue: string[] | string | undefined): string[] {
  if (claimValue === undefined || claimValue === null) return [];
  if (Array.isArray(claimValue)) return claimValue;
  if (typeof claimValue === 'string') {
    try {
      const parsed = JSON.parse(claimValue);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      // Not JSON - fall through to treat as plain/delimited string.
    }
    if (claimValue.includes(',') || claimValue.includes(' ')) {
      return claimValue.split(/[\s,]+/).filter(Boolean);
    }
    return [claimValue];
  }
  return [claimValue];
}

function extractStudentInfo(decodedToken: VerifiedUserPayload): { enrollmentYear: string, facultyCode: string } | null {
  const candidates = normalizeToArray(decodedToken.verified_secondary_email);
  for (const entry of candidates) {
    const match = entry.match(config.studentEmail.pattern);
    if (match) {
      const [, enrollmentYear, facultyCode, ] = match;
      return { enrollmentYear: enrollmentYear as string, facultyCode: facultyCode as string };
    }
  }
  return null;
}

function renderResult(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Verification ${success ? 'Complete' : 'Failed'}</title>
</head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4rem;">
  <h1>${success ? '✅ Verified' : '❌ Something went wrong'}</h1>
  <p>${message}</p>
</body>
</html>`;
}

export function createServer(onVerify: (user: VerifiedUser) => Promise<void>) {
  const app = express();

  app.get('/callback', async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      console.error(`MS API returned error: ${errorDescription}`)
      return res.status(400).send(renderResult(false, `Microsoft API returned an error. Please try again or contact an admin.`));
    }
    if (!code || !state) {
      return res.status(400).send(renderResult(false, 'Missing required parameters.'));
    }

    const pending = consumePendingState(String(state));
    if (!pending) {
      return res.status(400).send(renderResult(false, 'This verification link is invalid or has expired. Run /verify again in Discord.'));
    }

    try {
      const tokens = await exchangeCodeForToken(String(code));
      const claims = await verifyIdToken(tokens.id_token);

      const studentInfo = extractStudentInfo(claims);
      if (!studentInfo) {
        return res.status(400).send(renderResult(false,
          'Signed in successfully, but no verified secondary email matching the expected student ID format was found on your account. Contact an admin if you believe this is an error.'));
      }

      const existing = findByOID(claims.oid);
      if (existing && existing.discord_user_id !== pending.discord_user_id) {
        return res.status(409).send(renderResult(false,
          'This student ID is already linked to a different Discord account. Contact a server admin if you believe this is a mistake.'));
      }

      const user: VerifiedUser = {
        discord_user_id: pending.discord_user_id,
        ms_oid: claims.oid,
        enrollment_year: studentInfo.enrollmentYear,
        faculty_code: studentInfo.facultyCode,
        verified_at: Date.now(),
      }

      upsertVerifiedUser(user);
      await onVerify(user);

      return res.send(renderResult(true, 'You can close this tab and return to Discord.'));
    } catch (err) {
      console.error('Verification failed:', err);
      return res.status(500).send(renderResult(false, 'Something went wrong while verifying your account. Please try again or contact an admin.'));
    }
  });

  return app;
}

