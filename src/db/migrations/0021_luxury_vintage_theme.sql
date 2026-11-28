-- Luxury Vintage: a seventh greeting world (docs/design/signature-2/VINTAGE-PROPOSAL.md).
-- Data only, no schema change. greetings.theme_id references themes.id and the
-- app resolves a world by themes.key (src/lib/greetings/content.ts), so the
-- world needs its row. Idempotent: re-running, or a seed that already added
-- it, changes nothing.
INSERT INTO "themes" ("key", "name", "config", "active")
VALUES ('luxury-vintage', 'Luxury Vintage', '{"palette": "parchment-gold", "reveal": "envelope"}'::jsonb, true)
ON CONFLICT ("key") DO NOTHING;
