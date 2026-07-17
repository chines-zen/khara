import { pool } from '../db/index.js';

/**
 * Get all preferences for a user
 * Returns object like: { defaultFilters: {...}, savedViews: [...], theme: 'dark' }
 */
export async function getUserPreferences(userId) {
  const query = `
    SELECT preference_key, preference_value
    FROM user_preferences
    WHERE user_id = $1
  `;

  const result = await pool.query(query, [userId]);

  // Convert rows to object
  const preferences = {};
  for (const row of result.rows) {
    preferences[row.preference_key] = row.preference_value;
  }

  return preferences;
}

/**
 * Get specific preference for a user
 */
export async function getUserPreference(userId, key) {
  const query = `
    SELECT preference_value
    FROM user_preferences
    WHERE user_id = $1 AND preference_key = $2
  `;

  const result = await pool.query(query, [userId, key]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].preference_value;
}

/**
 * Set preference for a user (upsert)
 */
export async function setUserPreference(userId, key, value) {
  const query = `
    INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, preference_key)
    DO UPDATE SET
      preference_value = EXCLUDED.preference_value,
      updated_at = NOW()
    RETURNING preference_key, preference_value, updated_at
  `;

  const result = await pool.query(query, [userId, key, JSON.stringify(value)]);
  return result.rows[0];
}

/**
 * Delete preference for a user
 */
export async function deleteUserPreference(userId, key) {
  await pool.query(
    'DELETE FROM user_preferences WHERE user_id = $1 AND preference_key = $2',
    [userId, key]
  );
}

/**
 * Migrate localStorage preferences to database
 * This is a one-time migration function that can be called from frontend
 */
export async function migratePreferencesFromLocalStorage(userId, localStoragePrefs) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const [key, value] of Object.entries(localStoragePrefs)) {
      await client.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, preference_key) DO NOTHING`,
        [userId, key, JSON.stringify(value)]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
