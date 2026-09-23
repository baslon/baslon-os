# PostgreSQL Backup and Restore Runbook

**Scope:** live `baslon_os`. Resolves finding **P-13** (backups, restore tests and migration rollback/runbook).
**Principle:** a backup only counts once it has been restored somewhere and checked. An untested dump is not a restore point.

---

## 1. When to take a backup first

Take and verify a production backup **before**:

- a schema migration;
- a bulk data migration;
- a repair script;
- destructive maintenance (delete, archive purge, structural change);
- the first live use of a newly introduced production write path whose recovery is not yet proven.

Ordinary application writes do not need a fresh backup each time. The rule covers changes a person initiates that could damage or lose existing state.

If a backup cannot be taken or verified, **do not perform the change**.

## 2. Backup procedure

1. **Confirm the target.** `select current_database()` must return `baslon_os`. Never dump or restore against a database you have not named explicitly.
2. **Capture the pre-write state.** Record the migration count, the workflow state and version, the approved diagnosis identity and content hash, review decision counts, canonical counts and fingerprints, and the latest Snapshot's identity and fingerprint. Use the same read-only fingerprint queries as previous live verifications so before/after comparisons line up.
3. **Dump in custom format**, which `pg_restore` can read selectively and which is compressed:

   ```bash
   docker exec -i baslon-os-postgres-1 pg_dump -U baslon -d baslon_os --format=custom > "<backup-dir>/baslon_os_YYYYMMDD_HHMMSS.dump"
   ```

   Run the dump with a client whose major version is at least the server's. A non-zero exit means **no backup exists**: stop.
4. **Checksum it** and record the value with the file size and creation time:

   ```bash
   sha256sum "<backup-dir>/baslon_os_YYYYMMDD_HHMMSS.dump"
   ```

   Do not modify the file afterwards.
5. **Store it outside the repository**, in an operator-controlled location, readable only by its owner. On Windows, remove inheritance and grant the owner alone:

   ```powershell
   icacls "<backup-file>" /inheritance:r /grant:r "$env:USERNAME:F"
   ```

6. **Inspect the structure**: `pg_restore --list` must succeed and show the expected schemas, tables, indexes, constraints, foreign keys, functions, triggers, table data and the `__drizzle_migrations` metadata. This is a sanity check, not proof of recoverability.
7. **Record the backup identifier**: file name, size, SHA-256, timestamp, database, server version and the migration baseline it represents.

## 3. Restore verification procedure

Never restore over live as a test.

1. **Create a disposable database** with an obviously temporary name, for example `baslon_os_restore_verify_YYYYMMDD_HHMM`. It must not be `baslon_os` or `baslon_os_test`, must start empty, and no application may point at it.
2. **Restore into it:**

   ```bash
   docker exec -i baslon-os-postgres-1 pg_restore --dbname=<disposable> --username=baslon \
     --no-owner --no-privileges --exit-on-error < "<backup-file>"
   ```

   `--no-owner` and `--no-privileges` are acceptable because Baslon OS recovery does not depend on preserving role ownership or ACLs. `--exit-on-error` makes the restore fail loudly rather than skipping objects. Never edit a dump to make a restore succeed.
3. **Fingerprint the restored database** with the same read-only queries used before the backup, and compare. The restored copy must reproduce the production state: migration count, workflow, approved diagnosis and content hash, review decisions, diagnosis items and references, canonical counts and fingerprints, Snapshot identity and fingerprint, and the emptiness of tables that were empty.
4. **Drop the disposable database** once verification passes, after confirming no session is connected to it. Keep the backup.

## 4. Emergency recovery

A production restore is a deliberate, Product Owner-authorised operation. **Never restore automatically after an application failure.** First establish:

- whether production data is actually damaged, or the application is simply failing;
- the last verified backup and what it contains;
- which writes happened after that backup;
- exactly what would be lost by restoring.

Then decide, with the Product Owner, whether to restore, to repair forward, or to do nothing. Record the decision and its reasoning.

## 5. Security

- Backups contain production and client data. Treat a dump with the same care as the database.
- **Never commit a backup to Git**, never place one inside the repository, and never upload one to GitHub.
- Restrict filesystem access to the backup owner; use encrypted storage where the environment supports it.
- Never put credentials or connection strings in documentation, reports or commit messages.
- Do not print a connection string when running these commands.

## 6. Retention

Minimum policy at the current stage:

> Keep the latest verified pre-change production backup until the associated production change has been verified **and** at least one newer verified backup exists.

As production usage grows, keep a small rolling set of verified backups rather than a single one. Nothing more elaborate is needed yet: the purpose is recoverability, not bureaucracy.

## 7. Verified restore points

| Date | Backup | SHA-256 | Size | Migration baseline | Restore test |
|---|---|---|---|---|---|
| 22 September 2026 | `baslon_os_20260922_213941.dump` | `901c870c44ea7d10823d8d7ab1faa3acd3554832f80278e531dd47335036ff22` | 529,623 bytes | 9 (`0008_diagnosis_headlines`) | **PASSED** — restored into a disposable database, full fingerprint identical to production, disposable database dropped |

The backup file lives in an operator-controlled directory outside the repository; its path is not recorded here, and it is never committed.
