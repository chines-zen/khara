import snowflake from 'snowflake-sdk';

const SERVICE_ACCOUNT_KEY = 'service-account';

// Keyed by identity (email in EXTERNALBROWSER mode, SERVICE_ACCOUNT_KEY otherwise)
// so each user's SSO session is cached separately instead of sharing one connection.
const connections = new Map();
const connecting = new Map();
const lastErrors = new Map();

function isServiceAccountMode() {
  return Boolean(process.env.SNOWFLAKE_USERNAME && process.env.SNOWFLAKE_PASSWORD);
}

function resolveKey(email) {
  if (isServiceAccountMode()) {
    return SERVICE_ACCOUNT_KEY;
  }

  if (!email) {
    throw new Error('Snowflake is configured for EXTERNALBROWSER auth; an email is required to establish a per-user connection');
  }

  return email;
}

export function getSnowflakeConfig(email) {
  return getConfig(email);
}

// Status checks tolerate a missing email (e.g. the public /api/health probe,
// which has no logged-in user yet) by reporting "not connected" rather than throwing.
export function isSnowflakeConnected(email) {
  if (!isServiceAccountMode() && !email) {
    return false;
  }
  return connections.has(resolveKey(email));
}

export function getSnowflakeLastError(email) {
  if (!isServiceAccountMode() && !email) {
    return null;
  }
  return lastErrors.get(resolveKey(email)) ?? null;
}

function getConfig(email) {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const warehouse = process.env.SNOWFLAKE_WAREHOUSE;
  const database = process.env.SNOWFLAKE_DATABASE;
  const schema = process.env.SNOWFLAKE_SCHEMA;
  const role = process.env.SNOWFLAKE_ROLE;

  if (isServiceAccountMode()) {
    return {
      account,
      username: process.env.SNOWFLAKE_USERNAME,
      password: process.env.SNOWFLAKE_PASSWORD,
      authenticator: 'SNOWFLAKE',
      warehouse,
      database,
      schema,
      role,
    };
  }

  return {
    account,
    username: email,
    authenticator: 'EXTERNALBROWSER',
    warehouse,
    database,
    schema,
    role,
  };
}

export async function connectToSnowflake(email) {
  const key = resolveKey(email);

  const existing = connections.get(key);
  if (existing) {
    return existing;
  }

  const inFlight = connecting.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = new Promise((resolve, reject) => {
    const conn = snowflake.createConnection(getConfig(email));
    conn.connect((err, connected) => {
      connecting.delete(key);
      if (err) {
        lastErrors.set(key, err.message);
        reject(err);
        return;
      }
      connections.set(key, connected);
      lastErrors.delete(key);
      resolve(connected);
    });
  });

  connecting.set(key, promise);
  return promise;
}

export async function executeQuery(sql, binds, email) {
  const key = resolveKey(email);
  const conn = await connectToSnowflake(email);
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, _stmt, rows) => {
        if (err) {
          // The cached connection may be dead (e.g. an expired SSO session
          // over an idle weekend). Drop it so the next request re-authenticates
          // instead of repeatedly failing against the same stale handle.
          connections.delete(key);
          lastErrors.set(key, err.message);
          reject(err);
          return;
        }
        resolve(rows || []);
      },
    });
  });
}

export async function closeConnection(email) {
  const key = resolveKey(email);
  const conn = connections.get(key);
  if (!conn) {
    return;
  }

  await new Promise((resolve) => {
    conn.destroy((err) => {
      if (err) {
        console.error('Failed to close Snowflake connection:', err);
      }
      resolve(undefined);
    });
  });

  connections.delete(key);
}
