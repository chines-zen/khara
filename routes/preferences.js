import express from 'express';
import {
  getUserPreferences,
  getUserPreference,
  setUserPreference,
  deleteUserPreference,
  migratePreferencesFromLocalStorage
} from '../services/preferences.js';
import { resolveOnboardingUsers } from '../services/sc-lookup.js';

const router = express.Router();

// Saving this key can carry a manager's Sales Engineer list, whose emails we
// resolve to Snowflake USER_IDs once here so the data-refresh paths don't have to.
const OPP_SCOPE_KEY = 'oppScopeSettings';
const BLIND_SPOTS_SCOPE_KEY = 'blindSpotsSettings';

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

    if (key === BLIND_SPOTS_SCOPE_KEY && req.user.is_manager) {
      return res.status(403).json({
        error: 'Blind Spots settings are available to individual SCs only',
      });
    }

    let valueToSave = value;
    const shouldValidateOppScope =
      key === OPP_SCOPE_KEY && req.user.is_manager && Array.isArray(value?.scEmails);
    const shouldValidateBlindSpots =
      key === BLIND_SPOTS_SCOPE_KEY && !req.user.is_manager && Array.isArray(value?.ownerEmails);

    if (shouldValidateOppScope || shouldValidateBlindSpots) {
      const field = shouldValidateOppScope ? 'scEmails' : 'ownerEmails';
      const emails = [...new Set(
        value[field]
          .filter((email) => typeof email === 'string')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      )];
      const results = await resolveOnboardingUsers(emails, req.user.email);
      const invalidEmails = results.filter((result) => !result.found).map((result) => result.email);

      if (invalidEmails.length > 0) {
        return res.status(422).json({
          error: 'Invalid scope emails',
          code: 'INVALID_SCOPE_EMAILS',
          invalidEmails,
          details: `These emails were not found in Snowflake: ${invalidEmails.join(', ')}`,
        });
      }

      valueToSave = { ...value, [field]: emails };
      if (shouldValidateOppScope) {
        valueToSave.scUserIds = results.map((result) => result.userId);
        valueToSave.scUserIdsFor = emails;
      }
    }

    const result = await setUserPreference(userId, key, valueToSave);
    res.json(result);
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
