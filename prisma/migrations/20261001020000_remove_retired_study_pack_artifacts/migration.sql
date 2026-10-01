-- Retired StudyPack publications carry these exact origin fields. Other artifacts remain independent.
DELETE FROM "Artifact"
WHERE "type" = 'review_outline'
  AND jsonb_typeof("metadata"->'studyPackId') = 'string'
  AND jsonb_typeof("metadata"->'goalId') = 'string';
