-- =============================================================================
-- A greeting remembers the exact template version it was made with.
--
-- greetings.theme_id names a template (themes.key); templates are versioned
-- in code (src/lib/templates/catalog.ts — every published or retired version
-- is kept). theme_version records which version the sender chose; it is
-- written whenever the theme is set (and at creation, for the default) and
-- freezes when the greeting activates (greetings are editable only while
-- DRAFT). The recipient renders exactly that version, so a later redesign of
-- a template ships as a new version and never alters a greeting already sent.
--
-- Every existing greeting was made with version 1 (the only version that has
-- ever existed), hence the default.
-- =============================================================================
alter table greetings add column theme_version integer not null default 1;
--> statement-breakpoint
alter table greetings add constraint greetings_theme_version_positive check (theme_version >= 1);
