# VPC Deploy Log

## v10.0.0 — 2026-04-22

A forward-compatible release. No data loss paths, every migration is idempotent
and every new column has a safe default. Existing integrations, backups, pipelines
and sessions continue to work without manual intervention.

---

### 🚀 Highlights

- **Perfect 1-click Pipeline promotion** — preflight plan, typed confirmation, auto-snapshot, staged execute, one-click rollback.
- **Exact beta fork** — full data copy (not just schema), auto-deploy, env-var remap from prod → beta DB.
- **GitHub-style browser sign-in** across VS Code (`vpc-sync-10.0.0.vsix`) and CLI (`vpc-pull login`) — no more pasting PATs.
- **33 integration platforms** (up from 7) with one-click automations (Supabase→Backup, GitHub→Import, Slack→Alerts, Cloudflare→DNS+SSL).
- **Supabase backup destination** — off-site backups on a schedule + cloud-restore fallback.
- **Lazy-loaded apps** — main bundle 1.2 MB → 498 KB (−59%).
- **System Health widget** — central logger captures every error, Dashboard surfaces 24h counts.
- **Versioned encryption** with `rekey.js` script for key rotation.
- **Baseline tests** via `node --test` — 8/8 passing.

---

### 📦 Deploy checklist

Run in order. Each step is idempotent and safe to re-run.

```bash
# 1. Apply new migrations (all use CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
psql "$DATABASE_URL" < backend/migrations/041_vpc_device_codes.sql
psql "$DATABASE_URL" < backend/migrations/042_vpc_backup_destinations.sql
psql "$DATABASE_URL" < backend/migrations/043_vpc_pipeline_promotions.sql
psql "$DATABASE_URL" < backend/migrations/044_vpc_system_logs.sql

# 2. Restart backend — new schedulers + logger wire up on boot
pm2 restart vpc-backend   # or `systemctl restart vpc`

# 3. Rebuild frontend (lazy-split chunks)
cd frontend && npm install && npx vite build && cd ..

# 4. (Optional) Install the new VS Code extension
code --install-extension vscode-extension/vpc-sync-10.0.0.vsix --force

# 5. Verify
cd backend && npm test         # 8/8 should pass
curl http://localhost:8001/health
```

---

### 🔒 Backward-compatibility notes

| Change | Existing behavior preserved? |
|---|---|
| `vpc_integrations.visibility` column added | Default `'shared'` → all existing integrations visible to every admin as before. |
| `vpc_integrations.created_by` column added | Nullable, default NULL — no backfill needed. |
| `vpc_settings.enc_key_version` column added | Default 1 — existing blobs continue decrypting. |
| Encryption blob format: new blobs prefix `v{N}:` | `decrypt()` accepts both legacy and versioned formats — verified by smoke test `encryption: decrypt handles legacy (v-less) format`. |
| `pipelineService.forkToBeta()` default `copyData` | Was `false`, now `true` (per user request for exact forks). Frontend always passes explicit `{ copyData: true }`; direct API callers using the default now get the new behavior. |
| `POST /pipelines/:id/promote` response shape | ⚠ Changed — old response `{ schemaPRs, deployedSites, errors }` moved to `/pipelines/:id/promote-legacy`. New response `{ run_id, status, backup_id, schema_applied, deployed, deployErrors, stages }`. Only caller was the web UI, which is updated. |
| `integrationService.getAll(pool)` | Backward compatible — existing signature still works. Optional `{ forUserId }` param enables per-admin filtering. |
| Lazy-loaded apps | First open of each app shows loading spinner briefly; functional behavior unchanged. |

---

### 📂 New files

**Backend**
- `backend/migrations/041_vpc_device_codes.sql`
- `backend/migrations/042_vpc_backup_destinations.sql`
- `backend/migrations/043_vpc_pipeline_promotions.sql`
- `backend/migrations/044_vpc_system_logs.sql`
- `backend/routes/deviceAuth.js` — VS Code / CLI sign-in flow
- `backend/routes/realtime.js` — SSE event stream
- `backend/services/backupScheduler.js` — polls supabase destinations every 60s
- `backend/services/credentialResolver.js` — shared integration creds for any app
- `backend/services/integrationAutomations.js` — one-click automators
- `backend/services/pipelinePromoteService.js` — staged promote + rollback
- `backend/services/realtimeBus.js` — in-process pub/sub for SSE
- `backend/services/supabaseBackupService.js` — upload & restore via Supabase Storage
- `backend/scripts/rekey.js` — re-encrypt all secrets with new key
- `backend/utils/logger.js` — central logger writing to `vpc_system_logs`
- `backend/views/deviceApprove.html` — browser approval page for device flow
- `backend/tests/smoke.test.js` — 8 zero-dep smoke tests

**Frontend**
- `frontend/src/components/apps/BackupDestinations.jsx`
- `frontend/src/components/apps/Connections.jsx` (rewritten — 33 platforms, categories, automations)
- `frontend/src/components/apps/Dashboard.jsx`
- `frontend/src/components/desktop/CommandPalette.jsx`
- `frontend/src/components/desktop/ContextBreadcrumb.jsx`
- `frontend/src/components/desktop/JobQueue.jsx`
- `frontend/src/components/desktop/KeyboardShortcutsOverlay.jsx`
- `frontend/src/components/desktop/NotificationCenter.jsx`
- `frontend/src/components/desktop/StatusBar.jsx`
- `frontend/src/components/desktop/WorkspaceSwitcher.jsx`
- `frontend/src/components/integrations/*`
- `frontend/src/components/pipeline/PromoteDialog.jsx`
- `frontend/src/components/widgets/*` (incl. `SystemHealthWidget`)
- `frontend/src/hooks/useGlobalKeyboard.js`
- `frontend/src/lib/realtime.js`
- `frontend/src/lib/widgetRegistry.js`
- `frontend/src/stores/useCommandStore.js`
- `frontend/src/stores/useContextStore.js`
- `frontend/src/stores/useDashboardStore.js`
- `frontend/src/stores/useIntegrationsStore.js`
- `frontend/src/stores/useJobStore.js`
- `frontend/src/stores/useNotificationStore.js`
- `frontend/src/stores/useWorkspaceStore.js`

**VS Code Extension** (packaged as `vpc-sync-10.0.0.vsix`)
- `vscode-extension/src/auth/deviceFlow.ts` — AuthenticationProvider + device-flow poller
- `vscode-extension/src/vcs/merge.ts` — 3-way merge port

**CLI**
- `cli/src/commands/login.js` — `vpc-pull login` browser sign-in

---

### 🩺 New endpoints

```
# Device auth (public + JWT mix)
POST   /api/admin/auth/device/code
POST   /api/admin/auth/device/token
GET    /api/admin/auth/device/pending?code=XXXX
POST   /api/admin/auth/device/confirm  { user_code }
POST   /api/admin/auth/device/deny     { user_code }

# Backup destinations
GET    /api/admin/backup/destinations
POST   /api/admin/backup/destinations
PATCH  /api/admin/backup/destinations/:id
DELETE /api/admin/backup/destinations/:id
POST   /api/admin/backup/destinations/:id/test
POST   /api/admin/backup/destinations/:id/run
GET    /api/admin/backup/destinations/:id/runs

# Integration automations
GET    /api/admin/integrations/automations
POST   /api/admin/integrations/:id/automate  { automation, options }

# Perfect pipeline promote
GET    /api/admin/pipeline/pipelines/:id/promote/preflight
POST   /api/admin/pipeline/pipelines/:id/promote        { confirmations, skipBackup, dryRun }
POST   /api/admin/pipeline/pipelines/:id/promote-legacy (old behavior preserved)
GET    /api/admin/pipeline/pipelines/:id/promotions
POST   /api/admin/pipeline/pipelines/:id/promotions/:runId/rollback

# Logs
GET    /api/admin/logs/health
GET    /api/admin/logs/system?level=error&limit=100

# Static page
GET    /auth/device             (approval UI for device codes)
```

---

### ⚠ Rollback plan

If something goes wrong after deploy:

1. **Database**: new tables are independent. Drop them if needed — nothing else depends on them:
   ```sql
   DROP TABLE IF EXISTS vpc_pipeline_promotions CASCADE;
   DROP TABLE IF EXISTS vpc_system_logs;
   DROP TABLE IF EXISTS vpc_backup_destination_runs;
   DROP TABLE IF EXISTS vpc_backup_destinations;
   DROP TABLE IF EXISTS vpc_device_codes;
   ALTER TABLE vpc_integrations DROP COLUMN IF EXISTS visibility;
   ALTER TABLE vpc_integrations DROP COLUMN IF EXISTS created_by;
   ALTER TABLE vpc_settings DROP COLUMN IF EXISTS enc_key_version;
   ```
2. **Code**: `git revert HEAD` and redeploy. Because migrations are additive,
   reverting code without reverting the schema is also safe — the extra tables
   simply sit unused.
3. **Pipeline promotions in flight**: any running promotion records its
   pre-promote backup in `vpc_pipeline_promotions.backup_id`. Use
   `POST /promotions/:runId/rollback` or restore the backup directly
   via the Backup Manager.

---

### ✅ Verification

```
cd backend && npm test
✔ encryption: round-trip preserves plaintext
✔ encryption: decrypt handles legacy (v-less) format
✔ encryption: decrypt returns null for garbage
✔ integrations: all types have name + fields
✔ integrations: every type has a tester case
✔ automations: registry is consistent
✔ pipeline promote service: exports expected API
✔ logger: forSource returns level methods
ℹ 8 pass, 0 fail
```

Frontend build: `✓ built in 8.07s` — main chunk 498 KB (was 1,204 KB).
