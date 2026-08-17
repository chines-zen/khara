import { randomUUID } from "node:crypto";
import { pool } from "../db/index.js";

export async function startSyncRun(userId, scope) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO sync_runs (id, user_id, status, started_at, scope)
     VALUES ($1, $2, 'running', NOW(), $3)`,
    [id, userId, JSON.stringify(scope ?? {})],
  );
  return id;
}

export async function startSyncDomain(syncRunId, domain) {
  await pool.query(
    `INSERT INTO sync_run_domains (sync_run_id, domain, status, started_at)
     VALUES ($1, $2, 'running', NOW())`,
    [syncRunId, domain],
  );
}

export async function finishSyncDomain(
  syncRunId,
  domain,
  { status, durationMs = null, records = 0, syncedTargets = 0, error = null },
) {
  await pool.query(
    `UPDATE sync_run_domains
     SET status = $1,
         completed_at = NOW(),
         duration_ms = $2,
         records = $3,
         synced_targets = $4,
         error = $5
     WHERE sync_run_id = $6 AND domain = $7`,
    [status, durationMs, records, syncedTargets, error, syncRunId, domain],
  );
}

export async function finishSyncRun(syncRunId, error = null) {
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM sync_run_domains
     WHERE sync_run_id = $1`,
    [syncRunId],
  );
  const succeeded = Number(result.rows[0]?.succeeded ?? 0);
  const failed = Number(result.rows[0]?.failed ?? 0);
  const status = failed > 0 && succeeded > 0
    ? "partial"
    : failed > 0
      ? "failed"
      : "succeeded";

  await pool.query(
    `UPDATE sync_runs
     SET status = $1,
         completed_at = NOW(),
         duration_ms = EXTRACT(MILLISECONDS FROM (NOW() - started_at))::INTEGER,
         error = $2
     WHERE id = $3`,
    [status, error, syncRunId],
  );

  return status;
}

export async function getRecentSyncRuns(userId, limit = 10) {
  const result = await pool.query(
    `SELECT r.id, r.status, r.started_at, r.completed_at, r.duration_ms,
            r.scope, r.error,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'domain', d.domain,
                  'status', d.status,
                  'durationMs', d.duration_ms,
                  'records', d.records,
                  'syncedTargets', d.synced_targets,
                  'error', d.error
                ) ORDER BY d.domain
              ) FILTER (WHERE d.id IS NOT NULL),
              '[]'::jsonb
            ) AS domains
     FROM sync_runs r
     LEFT JOIN sync_run_domains d ON d.sync_run_id = r.id
     WHERE r.user_id = $1
     GROUP BY r.id
     ORDER BY r.started_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

export async function getSyncRunStatus(userId, runId) {
  const result = await pool.query(
    `SELECT r.id, r.status, r.started_at, r.completed_at, r.duration_ms, r.error,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'domain', d.domain,
                  'status', d.status,
                  'startedAt', d.started_at,
                  'completedAt', d.completed_at,
                  'durationMs', d.duration_ms,
                  'records', d.records,
                  'syncedTargets', d.synced_targets,
                  'error', d.error
                ) ORDER BY d.domain
              ) FILTER (WHERE d.id IS NOT NULL),
              '[]'::jsonb
            ) AS domains
     FROM sync_runs r
     LEFT JOIN sync_run_domains d ON d.sync_run_id = r.id
     WHERE r.user_id = $1 AND r.id = $2
     GROUP BY r.id`,
    [userId, runId],
  );
  return result.rows[0] ?? null;
}
