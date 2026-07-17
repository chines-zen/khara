import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from '../db/index.js';

const PgSession = connectPgSimple(session);

/**
 * Configure express-session with PostgreSQL store
 */
export function createSessionMiddleware() {
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret || sessionSecret === 'change-this-to-a-long-random-string-in-production') {
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
