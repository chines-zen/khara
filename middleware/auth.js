import { pool } from '../db/index.js';
import { checkHasDirectReports } from '../services/sc-lookup.js';

/**
 * Extract user info from Pomerium headers
 * Pomerium proxy forwards these headers after successful SSO
 */
function extractPomeriumUser(req) {
  const email = req.headers['x-pomerium-claim-email'];
  const sub = req.headers['x-pomerium-claim-sub'];
  const name = req.headers['x-pomerium-claim-name'] || req.headers['x-pomerium-claim-given_name'];

  if (!email || !sub) {
    return null;
  }

  return { email, sub, name };
}

/**
 * Upsert user in database
 * Creates new user if doesn't exist, updates last_login if exists
 */
async function upsertUser(userInfo) {
  const { email, sub, name } = userInfo;

  const query = `
    INSERT INTO users (email, sub, name, last_login)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (email)
    DO UPDATE SET
      last_login = NOW(),
      name = COALESCE(EXCLUDED.name, users.name)
    RETURNING id, email, sub, name, created_at, last_login, is_manager
  `;

  const result = await pool.query(query, [email, sub, name]);
  return result.rows[0];
}

/**
 * Determine and cache whether a user is a manager (has direct reports).
 * Only hits Snowflake once per user — after that, is_manager is read from
 * Postgres. Failures here must never block login, so they're swallowed and
 * left for the next login to retry.
 */
async function ensureManagerFlag(user, email) {
  if (user.is_manager !== null) {
    return user.is_manager;
  }

  try {
    const isManager = await checkHasDirectReports(email);

    if (isManager !== null) {
      await pool.query('UPDATE users SET is_manager = $1 WHERE id = $2', [isManager, user.id]);
      user.is_manager = isManager;
    }

    return isManager;
  } catch (error) {
    console.error('Failed to determine manager status:', error);
    return null;
  }
}

/**
 * Middleware: Authenticate request via Pomerium headers
 *
 * Usage:
 *   app.get('/api/protected', authenticateWithPomerium, (req, res) => {
 *     const user = req.user; // { id, email, sub, name, ... }
 *   });
 */
export async function authenticateWithPomerium(req, res, next) {
  try {
    // Development mode bypass
    if (process.env.DEV_MODE === 'true') {
      console.log('⚠️  DEV_MODE: Bypassing authentication');
      const capturedEmail = req.session?.devEmailOverride || process.env.DEV_USER_EMAIL;
      const devEmail = capturedEmail || 'dev@localhost';

      // Upsert through the real user path so preferences/SC lookups exercise
      // the same code as a real Pomerium login when switching test emails.
      const user = await upsertUser({ email: devEmail, sub: `dev-local-${devEmail}`, name: 'Development User' });
      req.user = user;
      // No real email captured yet (session override or DEV_USER_EMAIL) — the
      // frontend uses this to show a first-use email capture dialog instead of
      // silently querying Snowflake/Salesforce data as the 'dev@localhost' placeholder.
      req.user.needsEmailSetup = !capturedEmail;

      if (capturedEmail) {
        await ensureManagerFlag(req.user, capturedEmail);
      }

      // Set session if available
      if (req.session) {
        req.session.userId = req.user.id;
        req.session.userEmail = req.user.email;
      }

      return next();
    }

    // Extract user from Pomerium headers
    const pomeriumUser = extractPomeriumUser(req);

    if (!pomeriumUser) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No valid Pomerium authentication headers found',
      });
    }

    // Upsert user in database (creates or updates last_login)
    const user = await upsertUser(pomeriumUser);

    // Attach user to request object
    req.user = user;

    await ensureManagerFlag(req.user, pomeriumUser.email);

    // Also store in session for persistence
    req.session.userId = user.id;
    req.session.userEmail = user.email;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message,
    });
  }
}

/**
 * Optional: Middleware to restore user from session
 * Use this if you want to allow session-based auth after initial Pomerium auth
 */
export async function restoreUserFromSession(req, res, next) {
  if (req.user) {
    // Already authenticated via Pomerium
    return next();
  }

  if (req.session && req.session.userId) {
    try {
      const result = await pool.query(
        'SELECT id, email, sub, name, created_at, last_login FROM users WHERE id = $1',
        [req.session.userId]
      );

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    } catch (error) {
      console.error('Session restore error:', error);
    }
  }

  next();
}
