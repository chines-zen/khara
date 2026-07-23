import { pool } from '../db/index.js';
import { checkHasDirectReports, resolveScUserId } from '../services/sc-lookup.js';
import { ensureDefaultOppScope } from '../services/opp-scope.js';

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
  const user = result.rows[0];

  // Seed the user's default opp scope (ARR threshold + fiscal-year range) if they
  // don't have one yet. Without it the opportunities page treats the missing
  // preference as "not set up" and force-navigates them to Settings. Idempotent
  // (ON CONFLICT DO NOTHING), so a user's later changes are never overwritten.
  await ensureDefaultOppScope(user.id);

  return user;
}

/**
 * Resolve the SE's real full name via email > userID > name (Snowflake
 * USER_HISTORY), the same path opportunities use. Falls back to `fallbackName`
 * when there's no email or the lookup fails/returns nothing — never throws.
 */
async function resolveUserName(email, fallbackName) {
  if (!email) return fallbackName;
  try {
    const scUser = await resolveScUserId(email);
    if (scUser?.fullName) return scUser.fullName;
  } catch (error) {
    console.error('Failed to resolve user name from Snowflake:', error);
  }
  return fallbackName;
}

/**
 * Load an existing user by id (read-only).
 * Used to reuse the session's already-upserted user on subsequent requests so
 * we don't re-run upsertUser — which would burn a SERIAL sequence value and
 * refresh last_login — on every authenticated API call.
 */
async function getUserById(id) {
  const result = await pool.query(
    'SELECT id, email, sub, name, created_at, last_login, is_manager FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
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

      // Reuse the user already upserted earlier in this session so last_login is
      // a once-per-session write. This also skips the Snowflake name lookup
      // below on every request. Re-upsert only for a new session or when the
      // dev test email changes.
      let user = null;
      if (req.session?.userId && req.session.userEmail === devEmail) {
        user = await getUserById(req.session.userId);
      }

      if (!user) {
        // Resolve the real full name from Snowflake so the dev user lines up with
        // the rest of the app (e.g. "Chad Hines") instead of a placeholder. Only
        // possible once a real email is captured; failures fall back to the
        // placeholder and never block login.
        const devName = await resolveUserName(capturedEmail, 'Development User');

        // Upsert through the real user path so preferences/SC lookups exercise
        // the same code as a real Pomerium login when switching test emails.
        user = await upsertUser({ email: devEmail, sub: `dev-local-${devEmail}`, name: devName });

        // Set session if available
        if (req.session) {
          req.session.userId = user.id;
          req.session.userEmail = user.email;
        }
      }

      req.user = user;
      // No real email captured yet (session override or DEV_USER_EMAIL) — the
      // frontend uses this to show a first-use email capture dialog instead of
      // silently querying Snowflake/Salesforce data as the 'dev@localhost' placeholder.
      req.user.needsEmailSetup = !capturedEmail;

      if (capturedEmail) {
        await ensureManagerFlag(req.user, capturedEmail);
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

    // Reuse the user already upserted earlier in this session. This keeps
    // last_login a once-per-session write and avoids burning a SERIAL sequence
    // value on every authenticated API call. Re-upsert only for a new session
    // or when the authenticated email changes.
    let user = null;
    if (req.session.userId && req.session.userEmail === pomeriumUser.email) {
      user = await getUserById(req.session.userId);
    }

    if (!user) {
      // New session (or changed identity) — upsert refreshes last_login.
      // Resolve the real full name via email > userID > name (Snowflake) so the
      // stored name matches the rest of the app, falling back to the Pomerium
      // header name when Snowflake can't resolve the email.
      const resolvedName = await resolveUserName(pomeriumUser.email, pomeriumUser.name);
      user = await upsertUser({ ...pomeriumUser, name: resolvedName });
      req.session.userId = user.id;
      req.session.userEmail = user.email;
    }

    // Attach user to request object
    req.user = user;

    await ensureManagerFlag(req.user, pomeriumUser.email);

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
