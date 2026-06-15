-- Run only after a verified pg_dump backup.
-- User-owned records and legacy personal API keys are removed through cascades.
DELETE FROM "User";
DELETE FROM "ApiKey";
