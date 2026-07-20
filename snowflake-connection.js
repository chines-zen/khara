import snowflake from 'snowflake-sdk';

let connection = null;
let connecting = null;
let lastError = null;

export function getSnowflakeConfig() {
  return getConfig();
}

export function isSnowflakeConnected() {
  return connection !== null;
}

export function getSnowflakeLastError() {
  return lastError;
}

function getConfig() {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USERNAME;
  const password = process.env.SNOWFLAKE_PASSWORD;
  const warehouse = process.env.SNOWFLAKE_WAREHOUSE;
  const database = process.env.SNOWFLAKE_DATABASE;
  const schema = process.env.SNOWFLAKE_SCHEMA;
  const role = process.env.SNOWFLAKE_ROLE;

  if (username && password) {
    return {
      account,
      username,
      password,
      authenticator: 'SNOWFLAKE',
      warehouse,
      database,
      schema,
      role,
    };
  }

  return {
    account,
    authenticator: 'EXTERNALBROWSER',
    warehouse,
    database,
    schema,
    role,
  };
}

export async function connectToSnowflake() {
  if (connection) {
    return connection;
  }

  if (connecting) {
    return connecting;
  }

  connecting = new Promise((resolve, reject) => {
    const conn = snowflake.createConnection(getConfig());
    conn.connect((err, connected) => {
      connecting = null;
      if (err) {
        lastError = err.message;
        reject(err);
        return;
      }
      connection = connected;
      lastError = null;
      resolve(connected);
    });
  });

  return connecting;
}

export async function executeQuery(sql, binds) {
  const conn = await connectToSnowflake();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds,
      complete: (err, _stmt, rows) => {
        if (err) {
          // The cached connection may be dead (e.g. an expired SSO session
          // over an idle weekend). Drop it so the next request re-authenticates
          // instead of repeatedly failing against the same stale handle.
          connection = null;
          lastError = err.message;
          reject(err);
          return;
        }
        resolve(rows || []);
      },
    });
  });
}

export async function closeConnection() {
  if (!connection) {
    return;
  }

  await new Promise((resolve) => {
    connection.destroy((err) => {
      if (err) {
        console.error('Failed to close Snowflake connection:', err);
      }
      resolve(undefined);
    });
  });

  connection = null;
}
