-- Run once in this Studio's Supabase project's SQL Editor.
-- Studio authentication is handled by the Worker, not Supabase Auth.
-- Every table has RLS with no browser policies. Only the server secret may call studio_api.
BEGIN;
CREATE TABLE IF NOT EXISTS public.studio_users (
  id text PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL,
  role text NOT NULL CHECK(role IN ('superadmin','admin','applicant')),
  status text NOT NULL CHECK(status IN ('pending','active','suspended','removed')),
  permissions text NOT NULL DEFAULT '[]', password_hash text NOT NULL, salt text NOT NULL,
  created_at text NOT NULL, approved_at text, approved_by text, revision integer NOT NULL DEFAULT 0, google_sub text UNIQUE,
  CHECK(role <> 'superadmin' OR status='active'),
  CHECK(role <> 'applicant' OR status IN ('pending','removed'))
);
CREATE TABLE IF NOT EXISTS public.studio_sessions (
  token_hash text PRIMARY KEY, expires_at bigint NOT NULL, user_id text NOT NULL REFERENCES public.studio_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS studio_sessions_expiry ON public.studio_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.studio_login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS public.studio_oauth_states (state_hash text PRIMARY KEY,binding_hash text NOT NULL,verifier text NOT NULL,nonce text NOT NULL,return_to text NOT NULL,expires_at bigint NOT NULL);
ALTER TABLE public.studio_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_oauth_states FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.studio_state (key text PRIMARY KEY, payload text NOT NULL, revision integer NOT NULL DEFAULT 0, updated_at text NOT NULL, updated_by text NOT NULL);
CREATE TABLE IF NOT EXISTS public.studio_versions (id text PRIMARY KEY, payload text NOT NULL, created_at text NOT NULL, created_by text NOT NULL);
CREATE TABLE IF NOT EXISTS public.studio_media (id text PRIMARY KEY, filename text NOT NULL, mime text NOT NULL, size integer NOT NULL, created_at text NOT NULL, created_by text NOT NULL);
CREATE TABLE IF NOT EXISTS public.studio_audit_logs (
  id text PRIMARY KEY, created_at text NOT NULL, actor_id text NOT NULL,
  actor_email text NOT NULL, actor_name text NOT NULL, actor_role text NOT NULL,
  action text NOT NULL, target text NOT NULL, details text NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_audit_logs_time ON public.studio_audit_logs(created_at DESC,id DESC);
ALTER TABLE public.studio_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_audit_logs FROM PUBLIC,anon,authenticated;
ALTER TABLE public.studio_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_users,public.studio_sessions,public.studio_login_attempts,public.studio_state,public.studio_versions,public.studio_media FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.studio_api(operation text, params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  value jsonb;
  affected integer;
  draft_payload text;
  audit jsonb := params->'audit';
BEGIN
  CASE operation
  WHEN 'auth_features' THEN value:=jsonb_build_object('membership',2,'google',true);
  WHEN 'auth_google_subject' THEN
    SELECT to_jsonb(u) INTO value FROM public.studio_users u WHERE google_sub=params->>'sub';
  WHEN 'auth_google_link' THEN
    UPDATE public.studio_users SET google_sub=params->>'sub',revision=revision+1 WHERE id=params->>'id' AND email=params->>'email' AND google_sub IS NULL;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  WHEN 'auth_oauth_start' THEN
    DELETE FROM public.studio_oauth_states WHERE expires_at<=(params->>'now')::bigint;
    INSERT INTO public.studio_oauth_states VALUES(params->>'stateHash',params->>'bindingHash',params->>'verifier',params->>'nonce',params->>'returnTo',(params->>'expires')::bigint);
    value:='true'::jsonb;
  WHEN 'auth_oauth_consume' THEN
    DELETE FROM public.studio_oauth_states WHERE state_hash=params->>'stateHash' AND binding_hash=params->>'bindingHash' AND expires_at>(params->>'now')::bigint
      RETURNING jsonb_build_object('verifier',verifier,'nonce',nonce,'return_to',return_to) INTO value;
  WHEN 'auth_request_access' THEN
    UPDATE public.studio_users SET role='applicant',status='pending',permissions='[]',approved_at=NULL,approved_by=NULL,revision=revision+1
      WHERE id=params->>'id' AND status='removed' AND role<>'superadmin' AND revision=(params->>'revision')::integer;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  WHEN 'audit_list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO value FROM (
      SELECT * FROM public.studio_audit_logs
      WHERE (coalesce(params->>'prefix','')='' OR action LIKE (params->>'prefix')||'%')
      AND (coalesce(params->>'search','')='' OR position(lower(params->>'search') in lower(actor_email||' '||actor_name))>0)
      AND (coalesce(params->>'beforeTime','')='' OR created_at<params->>'beforeTime' OR (created_at=params->>'beforeTime' AND id<params->>'beforeId'))
      ORDER BY created_at DESC,id DESC LIMIT LEAST(101,GREATEST(1,(params->>'limit')::integer))
    ) a;
  WHEN 'state' THEN
    SELECT to_jsonb(s) INTO value FROM public.studio_state s WHERE s.key=params->>'key';
  WHEN 'seed' THEN
    INSERT INTO public.studio_state(key,payload,revision,updated_at,updated_by)
    VALUES ('draft',params->>'payload',0,params->>'now',params->>'user'),('published',params->>'payload',0,params->>'now',params->>'user') ON CONFLICT DO NOTHING;
    value := 'true'::jsonb;
  WHEN 'draft_save' THEN
    UPDATE public.studio_state SET payload=params->>'payload',revision=revision+1,updated_at=params->>'now',updated_by=params->>'user'
    WHERE key='draft' AND revision=(params->>'revision')::integer;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  WHEN 'publish' THEN
    -- Lock the draft and publication together; copying and version creation share one transaction.
    PERFORM 1 FROM public.studio_state WHERE key IN ('draft','published') ORDER BY key FOR UPDATE;
    SELECT s.payload INTO draft_payload FROM public.studio_state s WHERE s.key='draft' AND s.revision=(params->>'revision')::integer;
    IF draft_payload IS NULL THEN RETURN jsonb_build_object('value',false); END IF;
    UPDATE public.studio_state SET payload=draft_payload,revision=revision+1,updated_at=params->>'now',updated_by=params->>'user'
    WHERE key='published' AND revision=(params->>'publishedRevision')::integer;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected=1 THEN INSERT INTO public.studio_versions VALUES(params->>'version',draft_payload,params->>'now',params->>'user'); END IF;
    value:=to_jsonb(affected=1);
  WHEN 'versions' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) INTO value FROM (SELECT id,created_at FROM public.studio_versions ORDER BY created_at DESC LIMIT 30) v;
  WHEN 'version' THEN
    SELECT jsonb_build_object('payload',v.payload) INTO value FROM public.studio_versions v WHERE id=params->>'id';
  WHEN 'media_get' THEN
    SELECT jsonb_build_object('mime',m.mime,'filename',m.filename) INTO value FROM public.studio_media m WHERE id=params->>'id';
  WHEN 'media_list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) INTO value FROM (SELECT id,filename,mime,size,created_at FROM public.studio_media ORDER BY created_at DESC LIMIT 150) m;
  WHEN 'media_insert' THEN
    INSERT INTO public.studio_media VALUES(params->>'id',params->>'filename',params->>'mime',(params->>'size')::integer,params->>'now',params->>'user');
    value:='true'::jsonb;
  WHEN 'auth_initialized' THEN
    SELECT to_jsonb(EXISTS(SELECT 1 FROM public.studio_users WHERE role='superadmin')) INTO value;
  WHEN 'auth_user_email' THEN
    SELECT to_jsonb(u) INTO value FROM public.studio_users u WHERE u.email=params->>'email';
  WHEN 'auth_session_user' THEN
    SELECT to_jsonb(u)-'password_hash'-'salt' INTO value FROM public.studio_sessions s JOIN public.studio_users u ON u.id=s.user_id
    WHERE s.token_hash=params->>'hash' AND s.expires_at>(params->>'now')::bigint;
  WHEN 'auth_throttle' THEN
    INSERT INTO public.studio_login_attempts AS a(key,attempts,reset_at) VALUES(params->>'key',1,(params->>'reset')::bigint)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN a.reset_at<=(params->>'now')::bigint THEN 1 ELSE a.attempts+1 END,
    reset_at=CASE WHEN a.reset_at<=(params->>'now')::bigint THEN excluded.reset_at ELSE a.reset_at END
    RETURNING jsonb_build_object('attempts',attempts,'reset_at',reset_at) INTO value;
  WHEN 'auth_session_start' THEN
    DELETE FROM public.studio_sessions WHERE expires_at<=(params->>'now')::bigint OR token_hash=params->>'previous';
    INSERT INTO public.studio_sessions VALUES(params->>'hash',(params->>'expires')::bigint,params->>'user');
    DELETE FROM public.studio_login_attempts WHERE reset_at<=(params->>'now')::bigint;
    value:='true'::jsonb;
  WHEN 'auth_session_delete' THEN
    DELETE FROM public.studio_sessions WHERE token_hash=params->>'hash'; value:='true'::jsonb;
  WHEN 'auth_create_superadmin' THEN
    -- A fixed primary key makes simultaneous bootstrap requests race safely.
    INSERT INTO public.studio_users(id,email,display_name,role,status,permissions,password_hash,salt,created_at,approved_at,approved_by)
    SELECT 'superadmin',params->>'email',params->>'name','superadmin','active','[]',params->>'hash',params->>'salt',params->>'now',params->>'now','superadmin'
    WHERE NOT EXISTS(SELECT 1 FROM public.studio_users WHERE role='superadmin') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  WHEN 'auth_register' THEN
    INSERT INTO public.studio_users(id,email,display_name,role,status,permissions,password_hash,salt,created_at,google_sub)
    VALUES(params->>'id',params->>'email',params->>'name','applicant','pending','[]',params->>'hash',params->>'salt',params->>'now',params->>'sub') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  WHEN 'users_list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(u)-'password_hash'-'salt'-'google_sub'),'[]'::jsonb) INTO value FROM (SELECT * FROM public.studio_users WHERE status<>'removed' ORDER BY created_at DESC,id) u;
  WHEN 'users_get' THEN
    SELECT to_jsonb(u)-'password_hash'-'salt' INTO value FROM public.studio_users u WHERE id=params->>'id';
  WHEN 'users_update' THEN
    IF NOT EXISTS(SELECT 1 FROM public.studio_users WHERE id=params->>'actor' AND role='superadmin' AND status='active') THEN
      RETURN jsonb_build_object('error','เฉพาะ superadmin เท่านั้นที่จัดการผู้ใช้ได้','status',403); END IF;
    UPDATE public.studio_users SET role=CASE WHEN params->>'action'='approve' THEN 'admin' ELSE role END,status=params->>'status',permissions=params->>'permissions',revision=revision+1,
    approved_at=CASE WHEN params->>'action'='approve' THEN params->>'now' ELSE approved_at END,
    approved_by=CASE WHEN params->>'action'='approve' THEN params->>'actor' ELSE approved_by END
    WHERE id=params->>'id' AND role IN ('admin','applicant') AND revision=(params->>'revision')::integer AND (params->>'action'<>'approve' OR status='pending');
    GET DIAGNOSTICS affected=ROW_COUNT;
    value:=to_jsonb(affected=1);
  WHEN 'users_delete' THEN
    IF NOT EXISTS(SELECT 1 FROM public.studio_users WHERE id=params->>'actor' AND role='superadmin' AND status='active') THEN
      RETURN jsonb_build_object('error','เฉพาะ superadmin เท่านั้นที่จัดการผู้ใช้ได้','status',403); END IF;
    UPDATE public.studio_users SET status='removed',permissions='[]',revision=revision+1 WHERE id=params->>'id' AND role IN ('admin','applicant') AND status<>'removed' AND revision=(params->>'revision')::integer;
    GET DIAGNOSTICS affected=ROW_COUNT; value:=to_jsonb(affected=1);
  ELSE RETURN jsonb_build_object('error','Unknown database operation','status',400);
  END CASE;
  -- The successful action and its log commit together; conflicts produce no success entry.
  IF audit IS NOT NULL AND value='true'::jsonb AND operation IN
    ('draft_save','publish','media_insert','auth_session_start','auth_session_delete',
     'auth_create_superadmin','auth_register','users_update','users_delete','auth_request_access','auth_google_link') THEN
    INSERT INTO public.studio_audit_logs(id,created_at,actor_id,actor_email,actor_name,actor_role,action,target,details)
    VALUES(audit->>'id',audit->>'created_at',audit->>'actor_id',audit->>'actor_email',audit->>'actor_name',audit->>'actor_role',audit->>'action',audit->>'target',audit->>'details');
  END IF;
  RETURN jsonb_build_object('value',value);
END;
$$;
REVOKE ALL ON FUNCTION public.studio_api(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_api(text,jsonb) TO service_role;
COMMIT;

-- Keep uploads private. Worker reads approved public media via its server secret.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('studio-media','studio-media',false,10485760,ARRAY['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
ON CONFLICT(id) DO NOTHING;
