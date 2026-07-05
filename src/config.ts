function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a regex for: U + XX (enrollment year, BE) + YY (faculty code) + ZZZ (ordinal) + @domain
 * e.g. U6801234@student.mahidol.ac.th
 */
function buildStudentEmailPattern(domain: string): RegExp {
  return new RegExp(`^u(\\d{2})(\\d{2})(\\d{3})@${escapeRegex(domain)}$`, 'i');
}

const studentEmailDomain = process.env.STUDENT_EMAIL_DOMAIN || 'student.mahidol.ac.th';

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || null,
  },
  microsoft: {
    tenantId: required('MS_TENANT_ID'),
    clientId: required('MS_CLIENT_ID'),
    clientSecret: required('MS_CLIENT_SECRET'),
    redirectUri: required('MS_REDIRECT_URI'),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  studentEmail: {
    domain: studentEmailDomain,
    pattern: buildStudentEmailPattern(studentEmailDomain),
  },
  state: {
    ttlMinutes: parseInt(process.env.STATE_TTL_MINUTES || '10', 10),
  },
};
