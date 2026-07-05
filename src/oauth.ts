import { randomBytes }from 'crypto';
import { verify, type JwtHeader, type JwtPayload, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from './config';

const AUTHORITY = `https://login.microsoftonline.com/${config.microsoft.tenantId}`;
const AUTHORIZE_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/token`;
const JWKS_URI = `${AUTHORITY}/discovery/v2.0/keys`;

const jwks = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
});

type ErrorResponse = {
  error: string;
  error_description: string;
}

type TokenRequestResponse = {
  access_token: string;
  token_type: string,
  expires_in: number;
  scope: string | undefined;
  id_token: string;
}

export type VerifiedUserPayload = JwtPayload & {
  verified_secondary_email: string;
  oid: string;
};

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err || key == null) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function generateState() {
  return randomBytes(24).toString('hex');
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: 'code',
    redirect_uri: config.microsoft.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<TokenRequestResponse> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.microsoft.redirectUri,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    const error = data as ErrorResponse;
    throw new Error(`Token exchange failed: ${error.error} - ${error.error_description || ''}`);
  }
  return data as TokenRequestResponse;
}

/**
 * Verifies the ID token's signature against Microsoft's JWKS, plus issuer,
 * audience and tenant. Returns the decoded claims on success.
 */
export function verifyIdToken(idToken: string): Promise<VerifiedUserPayload> {
  return new Promise((resolve, reject) => {
    verify(
      idToken,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: `${AUTHORITY}/v2.0`,
        audience: config.microsoft.clientId,
      },
      (err, decoded) => {
        if (err || !decoded) return reject(err);
        // Belt-and-suspenders: issuer already encodes the tenant, but check explicitly too.
        if ((decoded as JwtPayload).tid !== config.microsoft.tenantId) {
          return reject(new Error('Token tid does not match configured tenant'));
        }
        resolve(decoded as VerifiedUserPayload);
      }
    );
  });
}