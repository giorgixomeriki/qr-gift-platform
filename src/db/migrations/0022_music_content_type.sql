-- "Our Song" (docs/music/OUR-SONG.md): a greeting may carry one Spotify track
-- or playlist reference. Data only, no schema change: greeting_content.type
-- references content_types.key, and the reference is stored in the existing
-- greeting_content.text_value as a canonical `spotify:<track|playlist>:<id>`
-- (validated in src/lib/music/spotify.ts; nothing from Spotify is stored).
-- greeting_content's RLS is per greeting, not per type, so the existing
-- policies already cover the new rows. Idempotent.
INSERT INTO "content_types" ("key", "category", "active")
VALUES ('music', 'link', true)
ON CONFLICT ("key") DO NOTHING;
