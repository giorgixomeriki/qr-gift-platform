-- =============================================================================
-- QA-01 V1 privacy hardening: partner membership no longer grants any extra
-- visibility into greetings. The partner branch of greetings_select was unused
-- by the app (no partner-facing code reads greetings — partner dashboards work
-- from qr_codes/orders/ledger/analytics only); its only effect was letting a
-- partner context see its BLOCKED/DELETED greetings' metadata. Partners keep
-- nothing here beyond what anyone scanning a card already gets
-- (ACTIVE/DRAFT metadata, which the public dispatcher needs). Content stays
-- behind greeting_content's own policies, which never had a partner branch.
-- See docs/PRIVACY_MODEL.md.
-- =============================================================================
alter policy greetings_select on greetings
  using (
    status in ('ACTIVE', 'DRAFT')
    or app_is_admin()
    or id = nullif(current_setting('app.editable_greeting_id', true), '')::uuid
  );
