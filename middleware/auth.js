import { pool } from '../db/index.js';
import { resolveUserIdentity } from '../services/sc-lookup.js';
import { ensureDefaultOppScope } from '../services/opp-scope.js';

// How long a cached identity (sfdc_user_id + is_manager) is trusted before it's
// re-resolved from USER_HISTORY. Long, because these change rarely — but not
// never, so a re-provisioned USER_ID or a promotion isn't cached permanently.
const IDENTITY_TTL_DAYS = 7;

// Identity resolutions in flight, keyed by email. The frontend fires ~8 parallel
// requests on a cold load (three /api/me plus opportunities/preferences/hidden),
// and every one of them hits this middleware before any of them has written a
// session or a users row — so the "already resolved?" checks below all miss and
// each request would run its own USER_HISTORY query. Sharing the promise means
// the first request does the lookup and the rest await its result.
//
// Same pattern as `connecting` in snowflake-connection.js. Note that dedupes the
// *connection*, which is why a cold load only opens one SSO tab; this dedupes the
// *queries* that then run over it.
const identityInFlight = new Map();

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
    RETURNING id, email, sub, name, created_at, last_login, is_manager,
              sfdc_user_id, identity_resolved_at
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
 * Load an existing user by id (read-only).
 * Used to reuse the session's already-upserted user on subsequent requests so
 * we don't re-run upsertUser — which would burn a SERIAL sequence value and
 * refresh last_login — on every authenticated API call.
 */
async function getUserById(id) {
  const result = await pool.query(
    `SELECT id, email, sub, name, created_at, last_login, is_manager,
            sfdc_user_id, identity_resolved_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Whether a user's cached identity (sfdc_user_id + is_manager) still needs
 * resolving from Snowflake. Anything unresolved or past the TTL does.
 */
function needsIdentityRefresh(user) {
  if (!user.sfdc_user_id || user.is_manager === null) {
    return true;
  }
  if (!user.identity_resolved_at) {
    return true;
  }
  const ageMs = Date.now() - new Date(user.identity_resolved_at).getTime();
  return ageMs > IDENTITY_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Resolve a user's identity from Snowflake at most once per email at a time,
 * sharing the in-flight promise across concurrent requests. Never throws —
 * a failure resolves to null and is left for a later request to retry.
 */
function resolveIdentityOnce(email) {
  const inFlight = identityInFlight.get(email);
  if (inFlight) {
    return inFlight;
  }

  const promise = resolveUserIdentity(email)
    .catch((error) => {
      console.error('Failed to resolve user identity from Snowflake:', error);
      return null;
    })
    .finally(() => {
      identityInFlight.delete(email);
    });

  identityInFlight.set(email, promise);
  return promise;
}

/**
 * Populate and cache the user's Snowflake identity: their SC USER_ID and
 * whether they manage anyone. One USER_HISTORY query covers both, and the
 * result is persisted so subsequent logins — and, more importantly, cache
 * refreshes — read it from Postgres instead of re-querying Snowflake.
 *
 * `fallbackName` (from the Pomerium header, or a dev placeholder) is used when
 * Snowflake can't resolve a name. Mutates `user` in place so callers see the
 * resolved values on req.user.
 *
 * Failures never block login: is_manager stays NULL, which callers must treat
 * as "unknown", not "not a manager".
 */
async function ensureUserIdentity(user, email, fallbackName) {
  if (!email || !needsIdentityRefresh(user)) {
    return user;
  }

  const identity = await resolveIdentityOnce(email);

  if (!identity) {
    return user;
  }

  // A user with no current employment record resolves isManager as null. Keep
  // any previously-known value rather than regressing it to unknown.
  const isManager = identity.isManager ?? user.is_manager ?? null;
  const name = identity.fullName || user.name || fallbackName;

  const result = await pool.query(
    `UPDATE users
     SET sfdc_user_id = $1,
         is_manager = $2,
         name = COALESCE($3, name),
         identity_resolved_at = NOW()
     WHERE id = $4
     RETURNING id, email, sub, name, created_at, last_login, is_manager,
               sfdc_user_id, identity_resolved_at`,
    [identity.userId, isManager, name, user.id]
  );

  Object.assign(user, result.rows[0]);
  return user;
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
        // Upsert through the real user path so preferences/SC lookups exercise
        // the same code as a real Pomerium login when switching test emails.
        // The real name comes from the identity resolution below, which also
        // fills in sfdc_user_id and is_manager — one Snowflake query for all
        // three instead of a separate name lookup here.
        user = await upsertUser({ email: devEmail, sub: `dev-local-${devEmail}`, name: 'Development User' });

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
        await ensureUserIdentity(req.user, capturedEmail, 'Development User');
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
      // New session (or changed identity) — upsert refreshes last_login. The
      // Pomerium header name seeds the row; ensureUserIdentity below replaces it
      // with the real USER_HISTORY full name when it can resolve one.
      user = await upsertUser(pomeriumUser);
      req.session.userId = user.id;
      req.session.userEmail = user.email;
    }

    // Attach user to request object
    req.user = user;

    // Resolves USER_ID + manager status in one Snowflake query, cached in
    // Postgres. Awaited before next() so every handler sees a settled
    // is_manager rather than racing the lookup.
    await ensureUserIdentity(req.user, pomeriumUser.email, pomeriumUser.name);

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
