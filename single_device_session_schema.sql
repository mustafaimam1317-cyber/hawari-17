-- ==============================================================================
-- HAWARI MEDICAL PLATFORM - SINGLE ACTIVE DEVICE ENFORCEMENT & SESSION SECURITY
-- Author: Mustafa Imam
-- Copyright (c) 2026 Hawari Platform. All Rights Reserved.
--
-- Description:
-- 1. Adds session tracking columns to hawari_users (active_session_token, last_active_device, last_active_at).
-- 2. claim_active_device_session: Registers the calling device as the active session.
-- 3. verify_active_device_session: Verifies whether the calling session token is active.
-- 4. Automatically exempts administrators (mustafaimam1317@gmail.com, mustafa172004@gmail.com).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Add session tracking columns to hawari_users (if missing)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'hawari_users' 
          AND column_name = 'active_session_token'
    ) THEN
        ALTER TABLE public.hawari_users ADD COLUMN active_session_token text DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'hawari_users' 
          AND column_name = 'last_active_device'
    ) THEN
        ALTER TABLE public.hawari_users ADD COLUMN last_active_device text DEFAULT '';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'hawari_users' 
          AND column_name = 'last_active_at'
    ) THEN
        ALTER TABLE public.hawari_users ADD COLUMN last_active_at bigint DEFAULT 0;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. RPC: claim_active_device_session
-- Registers the caller's session token as the single authoritative active session
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_active_device_session(
    p_email text,
    p_session_token text,
    p_device_info text DEFAULT 'Unknown Device',
    p_group text DEFAULT 'infection'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_clean_email text := lower(trim(p_email));
    v_clean_group text := lower(trim(p_group));
    v_clean_token text := trim(p_session_token);
    v_clean_device text := trim(coalesce(p_device_info, 'Unknown Device'));
    v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
    v_user record;
    v_is_admin boolean := false;
BEGIN
    IF v_clean_email IS NULL OR length(v_clean_email) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Email is required');
    END IF;

    SELECT * INTO v_user 
    FROM public.hawari_users 
    WHERE lower(email) = v_clean_email 
      AND lower(group_name) = v_clean_group
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT * INTO v_user 
        FROM public.hawari_users 
        WHERE lower(email) = v_clean_email 
        LIMIT 1;
    END IF;

    IF v_user IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    IF v_clean_email IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com') 
       OR v_user.role IN ('admin', 'instructor') THEN
        v_is_admin := true;
    END IF;

    UPDATE public.hawari_users
    SET active_session_token = v_clean_token,
        last_active_device = v_clean_device,
        last_active_at = v_now_ms
    WHERE lower(email) = v_clean_email
      AND (lower(group_name) = v_clean_group OR v_clean_group = '');

    RETURN jsonb_build_object(
        'success', true,
        'email', v_clean_email,
        'session_token', v_clean_token,
        'is_admin', v_is_admin,
        'last_active_at', v_now_ms
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. RPC: verify_active_device_session
-- Checks whether a student's local session_token matches the single active session
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_active_device_session(
    p_email text,
    p_session_token text,
    p_group text DEFAULT 'infection'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_clean_email text := lower(trim(p_email));
    v_clean_group text := lower(trim(p_group));
    v_clean_token text := trim(coalesce(p_session_token, ''));
    v_user record;
    v_is_admin boolean := false;
    v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
    IF v_clean_email IS NULL OR length(v_clean_email) = 0 THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Email is required');
    END IF;

    SELECT * INTO v_user 
    FROM public.hawari_users 
    WHERE lower(email) = v_clean_email 
      AND lower(group_name) = v_clean_group
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT * INTO v_user 
        FROM public.hawari_users 
        WHERE lower(email) = v_clean_email 
        LIMIT 1;
    END IF;

    IF v_user IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'User not found');
    END IF;

    IF v_clean_email IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com') 
       OR v_user.role IN ('admin', 'instructor') THEN
        v_is_admin := true;
        RETURN jsonb_build_object(
            'valid', true,
            'is_admin', true,
            'revoked', false,
            'status', v_user.status
        );
    END IF;

    IF v_user.active_session_token IS NULL 
       OR length(v_user.active_session_token) = 0 
       OR v_user.active_session_token = v_clean_token THEN
        
        UPDATE public.hawari_users
        SET last_active_at = v_now_ms
        WHERE lower(email) = v_clean_email
          AND (lower(group_name) = v_clean_group OR v_clean_group = '');

        RETURN jsonb_build_object(
            'valid', true,
            'is_admin', false,
            'revoked', false,
            'status', v_user.status
        );
    ELSE
        RETURN jsonb_build_object(
            'valid', false,
            'is_admin', false,
            'revoked', true,
            'active_device', coalesce(v_user.last_active_device, 'Another Device'),
            'status', v_user.status
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_active_device_session(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_active_device_session(text, text, text) TO anon, authenticated, service_role;
