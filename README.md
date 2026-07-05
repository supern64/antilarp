# student-verify-bot

Discord bot that verifies a user's student status by having them sign in with
their university Microsoft (Entra ID) account, then parses their 7-digit
student ID out of the `verified_secondary_email` token claim
(`UXXYYZZZ@student.mahidol.ac.th`).

## Flow

1. User runs `/verify` in Discord.
2. Bot generates a random `state`, stores `state -> discord_user_id` in
   SQLite, and DMs/replies with a Microsoft sign-in link containing that
   `state`.
3. User signs in through Microsoft's actual login page (bot never sees
   credentials).
4. Microsoft redirects to the Express server's `/callback` with `code` and
   `state`.
5. Server looks up `state`, exchanges `code` for tokens, verifies the ID
   token's signature/issuer/audience/tenant, and extracts the student email
   from `verified_secondary_email`.
6. Result is stored in SQLite and `onVerified()` in `src/index.js` fires —
   this is where you add role-assignment logic based on `facultyCode` /
   `enrollmentYear`.

## Setup

```bash
npm install
cp .env.example .env   # fill in the values below
npm start
```

Requires Node.js 18+ (uses the built-in `fetch`, no separate HTTP client
dependency).

### Environment variables

See `.env.example`. The important ones:

- `MS_TENANT_ID` — your restricted tenant GUID (not `organizations`).
- `MS_REDIRECT_URI` — must exactly match a registered redirect URI, and must
  be HTTPS in production (Entra ID only allows plain `http://` for
  `localhost`).
- `STUDENT_EMAIL_DOMAIN` — used to build the parsing regex.

## Entra ID (Azure portal) configuration checklist

Some of this you've likely already done based on your testing — included for
completeness:

- [ ] **Supported account types** (App registration → Authentication) set to
      *"Accounts in this organizational directory only"*, scoped to your
      tenant.
- [ ] **Platform → Web** added under Authentication, with a **Redirect URI**
      exactly matching `MS_REDIRECT_URI` (e.g.
      `https://your-domain.example.com/callback`). Use the "Web" platform
      type, not SPA — this app is a confidential client that exchanges the
      code server-side with a client secret.
  - Do **not** enable the "ID tokens (used for implicit and hybrid flows)"
    checkbox — this app only uses the standard authorization code flow, not
    the implicit/hybrid flow.
- [ ] **Certificates & secrets** → a **client secret** created, copied into
      `MS_CLIENT_SECRET`. Note its expiry and plan to rotate it.
- [ ] **API permissions** (Microsoft Graph, delegated): `openid`, `profile`,
      `email`, `User.Read`. If your tenant requires admin consent for
      delegated permissions, the university's IT/tenant admin needs to grant
      consent once so individual students aren't blocked by an approval
      screen.
- [ ] **Token configuration** → **Add optional claim** → ID token →
      `verified_secondary_email` (already done per your testing). Worth also
      confirming `oid` shows up in your tokens (it's included by default
      once the `profile` scope is granted for org accounts) since it's used
      as the stable per-user identifier alongside the student email.

## Security / production notes

- The SQLite DB (`data/bot.sqlite`) contains verified users' institutional
  email addresses — treat it as PII and restrict filesystem access
  accordingly.
- `state` values are single-use and expire after `STATE_TTL_MINUTES`;
  starting a new `/verify` invalidates any previous unfinished attempt for
  that user.
- The server rejects re-linking a student ID that's already claimed by a
  different Discord account (`db.findByStudentEmail`).
- `verified_secondary_email`'s exact shape (single string vs. array vs.
  delimited string) isn't documented by Microsoft, so `extractStudentEmail`
  in `src/server.js` normalizes several possible shapes defensively. Worth
  double-checking against a few real tokens (e.g. by temporarily logging
  `claims.verified_secondary_email` in `server.js`) before relying on it in
  production, and removing that log line afterward since it's PII.
- Rate-limit or otherwise throttle `/verify` if abuse becomes a concern —
  there's currently no cooldown beyond the state TTL.

## Where to add role logic

`onVerified()` in `src/index.js` receives `{ discordUserId, enrollmentYear,
facultyCode, ordinal, studentEmail }` after a successful verification. A
skeleton for mapping `facultyCode` to a Discord role ID is commented in
there.
