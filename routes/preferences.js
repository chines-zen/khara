import express from 'express';
import {
  getUserPreferences,
  getUserPreference,
  setUserPreference,
  deleteUserPreference,
  migratePreferencesFromLocalStorage
} from '../services/preferences.js';
import { resolveScopeUserIds } from '../services/opp-scope.js';

const router = express.Router();

// Saving this key can carry a manager's Sales Engineer list, whose emails we
// resolve to Snowflake USER_IDs once here so the data-refresh paths don't have to.
const OPP_SCOPE_KEY = 'oppScopeSettings';

/**
 * GET /api/user-preferences
 * Get all preferences for current user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await getUserPreferences(userId);
    res.json(preferences);
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

/**
 * GET /api/user-preferences/:key
 * Get specific preference for current user
 */
router.get('/:key', async (req, res) => {
  try {
    const userId = req.user.id;
    const { key } = req.params;
    const value = await getUserPreference(userId, key);

    if (value === null) {
      return res.status(404).json({ error: 'Preference not found' });
    }

    res.json({ key, value });
  } catch (error) {
    console.error('Error fetching preference:', error);
    res.status(500).json({ error: 'Failed to fetch preference' });
  }
});

/**
 * PUT /api/user-preferences/:key
 * Set preference for current user
 * Body: { value: any }
 */
router.put('/:key', async (req, res) => {
  try {
    const userId = req.user.id;
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Missing "value" in request body' });
    }

    const result = await setUserPreference(userId, key, value);

    // A manager saving their SE list: resolve those emails to USER_IDs now and
    // cache them on the preference, so each later cache refresh is a single
    // Snowflake query instead of an identity lookup plus the data query.
    //
    // Best-effort — a Snowflake failure must not fail the save, since the
    // preference itself is already stored and the refresh path falls back to a
    // live lookup when no cached IDs are present.
    let scUserIdResolution = null;
    if (key === OPP_SCOPE_KEY && req.user.is_manager && Array.isArray(value?.scEmails) && value.scEmails.length > 0) {
      try {
        scUserIdResolution = await resolveScopeUserIds(userId, req.user.email);
      } catch (error) {
        console.error('Failed to resolve SE emails to Snowflake USER_IDs:', error);
      }
    }

    res.json(scUserIdResolution ? { ...result, scUserIdResolution } : result);
  } catch (error) {
    console.error('Error setting preference:', error);
    res.status(500).json({ error: 'Failed to set preference' });
  }
});

/**
 * DELETE /api/user-preferences/:key
 * Delete preference for current user
 */
router.delete('/:key', async (req, res) => {
  try {
    const userId = req.user.id;
    const { key } = req.params;

    await deleteUserPreference(userId, key);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting preference:', error);
    res.status(500).json({ error: 'Failed to delete preference' });
  }
});

/**
 * POST /api/user-preferences/migrate
 * Migrate localStorage preferences to database (one-time migration)
 * Body: { preferences: { key: value, ... } }
 */
router.post('/migrate', async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid "preferences" in request body' });
    }

    await migratePreferencesFromLocalStorage(userId, preferences);
    res.json({ success: true, message: 'Preferences migrated successfully' });
  } catch (error) {
    console.error('Error migrating preferences:', error);
    res.status(500).json({ error: 'Failed to migrate preferences' });
  }
});

export default router;
