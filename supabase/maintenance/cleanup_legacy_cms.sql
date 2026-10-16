-- MATCHA ONLY. Run manually in the Matcha project's Supabase SQL Editor.
-- Use the updated public/admin apps first; older deployed apps may still read these tables.
-- Removes 12 unused legacy tables from public after copying their data privately.
-- Keeps all 8 current Studio tables, all storage buckets/files, and these old tables:
-- activity_logs, content_settings, pending_requests, roles, studio_members.
-- The copies preserve column data, not a full database dump of functions/triggers/constraints.
-- If a dependency prevents the DROP, the entire transaction rolls back. Do not add CASCADE.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE published jsonb;
BEGIN
  IF to_regclass('public.studio_state') IS NULL THEN
    RAISE EXCEPTION 'Matcha Studio state is missing. Stop: this may be the wrong project.';
  END IF;
  SELECT payload::jsonb INTO published FROM public.studio_state WHERE key='published';
  IF NOT coalesce(
    published->>'schema'='1'
    AND jsonb_typeof(published->'content')='object'
    AND (published->'content') ?& ARRAY['home','productSourcing','userGuide','about','catalog'], false
  ) OR NOT EXISTS(SELECT 1 FROM public.studio_state WHERE key='draft') THEN
    RAISE EXCEPTION 'Migrated Matcha draft/published content is missing. Import and verify it before cleanup.';
  END IF;
END;
$$;

-- Prevent changes to the source rows between their backup and removal.
LOCK TABLE
  public.about_content, public.brand_settings, public.catalog_content,
  public.catalog_specifications, public.contact_settings, public.dashboard_drafts,
  public.home_content, public.product_sourcing, public.product_tags,
  public.products, public.tags, public.user_guide_content
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.dashboard_drafts LIMIT 1) THEN
    RAISE EXCEPTION 'dashboard_drafts now contains data. Review the old drafts before removing this table.';
  END IF;
END;
$$;

-- Intentionally fails if this backup already exists; never overwrite an earlier copy.
CREATE SCHEMA legacy_matcha_backup_20261015;
REVOKE ALL ON SCHEMA legacy_matcha_backup_20261015 FROM PUBLIC,anon,authenticated;
COMMENT ON SCHEMA legacy_matcha_backup_20261015 IS 'Legacy Matcha CMS data copied before cleanup. Retain for recovery; not used by the website.';

DO $$
DECLARE legacy_table text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'about_content','brand_settings','catalog_content','catalog_specifications',
    'contact_settings','dashboard_drafts','home_content','product_sourcing',
    'product_tags','products','tags','user_guide_content'
  ] LOOP
    EXECUTE format('CREATE TABLE legacy_matcha_backup_20261015.%I AS TABLE public.%I',legacy_table,legacy_table);
    EXECUTE format('ALTER TABLE legacy_matcha_backup_20261015.%I ENABLE ROW LEVEL SECURITY',legacy_table);
  END LOOP;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA legacy_matcha_backup_20261015 FROM PUBLIC,anon,authenticated;

DROP TABLE
  public.product_tags,
  public.catalog_specifications,
  public.products,
  public.tags,
  public.about_content,
  public.brand_settings,
  public.catalog_content,
  public.contact_settings,
  public.dashboard_drafts,
  public.home_content,
  public.product_sourcing,
  public.user_guide_content
RESTRICT;

COMMIT;

-- The new app uses:
-- studio_users, studio_sessions, studio_login_attempts, studio_oauth_states,
-- studio_state, studio_versions, studio_media, studio_audit_logs.
-- Do not delete old storage buckets: imported logo/image/PDF URLs may still use them.
