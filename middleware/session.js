import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { setEnvVar } from '../services/env-writer.js';

const PgSession = connectPgSimple(session);

const PLACEHOLDER_SECRET = 'change-this-to-a-long-random-string-in-production';

function isMissingSecret(secret) {
  return !secret || secret === PLACEHOLDER_SECRET;
}

/**
 * Configure express-session with PostgreSQL store
 */
export function createSessionMiddleware() {
  // Local-dev convenience: if no real secret is configured, generate a strong
  // one once and persist it to .env (via setEnvVar) so it stays stable across
  // restarts — a changing secret would invalidate every stored session and log
  // everyone out on each restart. Only in DEV_MODE: production must supply the
  // secret through the environment, and the app shouldn't write files there.
  if (isMissingSecret(process.env.SESSION_SECRET) && process.env.DEV_MODE === 'true') {
    const generated = crypto.randomBytes(32).toString('hex');
    process.env.SESSION_SECRET = generated; // effective immediately for the line below
    setEnvVar('SESSION_SECRET', generated).catch((error) => {
      console.error('Failed to persist generated SESSION_SECRET to .env:', error);
    });
    console.log('🔑 Generated a SESSION_SECRET for local dev and saved it to .env');
  }

  const sessionSecret = process.env.SESSION_SECRET;

  if (isMissingSecret(sessionSecret)) {
    console.warn('⚠️  WARNING: Using default SESSION_SECRET. Set a secure random string in production!');
  }

  return session({
    store: new PgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: false, // We create it in db/index.js
    }),
    secret: sessionSecret || 'fallback-secret-for-development-only',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000'), // 24 hours
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax',
    },
    name: 'se.opp.sid', // Custom session cookie name
  });
}
