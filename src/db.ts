import path from 'path';
import fs from 'fs';
import { Database } from 'bun:sqlite';

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bot.sqlite'),  { strict: true });
db.run('PRAGMA journal_mode = WAL');

db.run(`
  CREATE TABLE IF NOT EXISTS pending_states (
    state TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_users (
    discord_user_id TEXT PRIMARY KEY,
    ms_oid TEXT NOT NULL,
    enrollment_year TEXT NOT NULL,
    faculty_code TEXT NOT NULL,
    verified_at INTEGER NOT NULL
  );
`);

export type PendingState = {
  state: string;
  discord_user_id: string;
  created_at: number;
  expires_at: number;
}

export type VerifiedUser = {
  discord_user_id: string;
  ms_oid: string;
  enrollment_year: string;
  faculty_code: string;
  verified_at: number;
}

/**
 * Creates a pending OAuth state tied to a Discord user.
 * Any previous unfinished attempt for that user is discarded first, so only
 * one verification link is ever "live" per user.
 */
export function createPendingState(state: string, discordUserId: string, ttlMinutes: number) {
  db.prepare(`DELETE FROM pending_states WHERE discord_user_id = ?`).run(discordUserId);

  const now = Date.now();
  const expiresAt = now + ttlMinutes * 60 * 1000;
  db.prepare(`
    INSERT INTO pending_states (state, discord_user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(state, discordUserId, now, expiresAt);
}

/**
 * Looks up and deletes (single-use) a pending state. Returns null if it
 * doesn't exist or has expired.
 */
export function consumePendingState(state: string): PendingState | null {
  const row = db.prepare(`SELECT * FROM pending_states WHERE state = ?`).get(state) as PendingState;
  if (!row) return null;
  db.prepare(`DELETE FROM pending_states WHERE state = ?`).run(state);
  if (Date.now() > row.expires_at) return null;
  return row;
}

export function cleanupExpiredStates() {
  db.prepare(`DELETE FROM pending_states WHERE expires_at < ?`).run(Date.now());
}

export function upsertVerifiedUser(data: VerifiedUser) {
  db.prepare(`
    INSERT INTO verified_users
      (discord_user_id, ms_oid, enrollment_year, faculty_code, verified_at)
    VALUES (@discord_user_id, @ms_oid, @enrollment_year, @faculty_code, @verified_at)
    ON CONFLICT(discord_user_id) DO UPDATE SET
      ms_oid = excluded.ms_oid,
      enrollment_year = excluded.enrollment_year,
      faculty_code = excluded.faculty_code,
      verified_at = excluded.verified_at
  `).run(data);
}

export function getVerifiedUser(discordUserId: string): VerifiedUser {
  return db.prepare(`SELECT * FROM verified_users WHERE discord_user_id = ?`).get(discordUserId) as VerifiedUser;
}

export function deleteVerifiedUser(discordUserId: string) {
  db.prepare(`DELETE FROM verified_users WHERE discord_user_id = ?`).run(discordUserId);
}

export function findByOID(userOID: string): VerifiedUser {
  return db.prepare(`SELECT * FROM verified_users WHERE ms_oid = ?`).get(userOID) as VerifiedUser;
}