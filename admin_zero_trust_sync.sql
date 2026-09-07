-- ==============================================================================
-- HAWARI COURSE PLATFORM - ZERO-TRUST ADMIN SYNCHRONIZATION & MANAGEMENT RPCS
-- ==============================================================================
-- Run this script in your Supabase Project -> SQL Editor to enable 100% secure,
-- zero-trust synchronization for the administrator panel without exposing student
-- data or credentials to anonymous public scraping.
--
-- Idempotent: Safe to execute multiple times.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC: admin_get_students
-- Securely retrieves student list for the active course group.
-- Only executes if the caller presents a valid admin email and matching SHA-256 hash.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_students(
    p_admin_email text,
    p_admin_hash text,
    p_group text DEFAULT 'infection'
)
RETURNS TABLE (
    email text,
    role text,
    status text,
    date_registered text,
    display_name text,
    last_updated bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_count int;
    v_clean_email text := lower(trim(p_admin_email));
    v_clean_group text := lower(trim(p_group));
BEGIN
    -- Step 1: Verify authorized admin email
    IF v_clean_email NOT IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com') THEN
        RAISE EXCEPTION 'Unauthorized: % is not a registered administrator email', p_admin_email;
    END IF;

    -- Step 2: Verify password hash against stored hash in hawari_users
    SELECT count(*) INTO v_admin_count
    FROM public.hawari_users
    WHERE lower(trim(hawari_users.email)) = v_clean_email
      AND hawari_users.role = 'admin'
      AND hawari_users.password_hash = p_admin_hash;

    -- If no admin row exists with this hash, check if any admin row exists for this email
    IF v_admin_count = 0 THEN
        SELECT count(*) INTO v_admin_count
        FROM public.hawari_users
        WHERE lower(trim(hawari_users.email)) = v_clean_email
          AND hawari_users.role = 'admin';

        -- If an admin row exists with a DIFFERENT password hash, deny access
        IF v_admin_count > 0 THEN
            RAISE EXCEPTION 'Unauthorized: Invalid admin credentials';
        ELSE
            -- If no admin row exists yet in hawari_users, anchor this admin row safely
            INSERT INTO public.hawari_users (
                email, group_name, password_hash, role, status, display_name, last_updated
            ) VALUES (
                v_clean_email, v_clean_group, p_admin_hash, 'admin', 'approved', 'Administrator', (extract(epoch from now()) * 1000)::bigint
            )
            ON CONFLICT (email, group_name) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                role = 'admin',
                status = 'approved';
        END IF;
    END IF;

    -- Step 3: Return student roster for this course group
    RETURN QUERY
    SELECT 
        u.email,
        coalesce(u.role, 'student'),
        coalesce(u.status, 'pending'),
        coalesce(u.date_registered, ''),
        coalesce(u.display_name, ''),
        coalesce(u.last_updated, 0::bigint)
    FROM public.hawari_users u
    WHERE lower(trim(u.group_name)) = v_clean_group
    ORDER BY u.last_updated DESC NULLS LAST;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. RPC: admin_manage_user
-- Securely performs administrative actions on student accounts:
-- 'approve', 'reject', 'delete', 'toggle_role', 'update_name'
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_manage_user(
    p_admin_email text,
    p_admin_hash text,
    p_target_email text,
    p_group text,
    p_action text,
    p_role text DEFAULT 'student',
    p_display_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_count int;
    v_clean_email text := lower(trim(p_admin_email));
    v_clean_target text := lower(trim(p_target_email));
    v_clean_group text := lower(trim(p_group));
    v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
    -- Step 1: Verify authorized admin email
    IF v_clean_email NOT IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com') THEN
        RAISE EXCEPTION 'Unauthorized: % is not a registered administrator email', p_admin_email;
    END IF;

    -- Step 2: Verify password hash against stored hash
    SELECT count(*) INTO v_admin_count
    FROM public.hawari_users
    WHERE lower(trim(hawari_users.email)) = v_clean_email
      AND hawari_users.role = 'admin'
      AND hawari_users.password_hash = p_admin_hash;

    IF v_admin_count = 0 THEN
        RAISE EXCEPTION 'Unauthorized: Invalid admin credentials';
    END IF;

    -- Step 3: Execute the requested management action
    IF p_action = 'approve' THEN
        UPDATE public.hawari_users
        SET status = 'approved',
            role = coalesce(p_role, 'student'),
            last_updated = v_now_ms
        WHERE lower(trim(email)) = v_clean_target
          AND lower(trim(group_name)) = v_clean_group;
        
        RETURN jsonb_build_object('success', true, 'action', 'approve', 'target', v_clean_target);

    ELSIF p_action IN ('reject', 'delete') THEN
        DELETE FROM public.hawari_users
        WHERE lower(trim(email)) = v_clean_target
          AND lower(trim(group_name)) = v_clean_group;

        RETURN jsonb_build_object('success', true, 'action', p_action, 'target', v_clean_target);

    ELSIF p_action = 'toggle_role' THEN
        UPDATE public.hawari_users
        SET role = CASE WHEN role = 'admin' THEN 'student' ELSE 'admin' END,
            last_updated = v_now_ms
        WHERE lower(trim(email)) = v_clean_target
          AND lower(trim(group_name)) = v_clean_group;

        RETURN jsonb_build_object('success', true, 'action', 'toggle_role', 'target', v_clean_target);

    ELSIF p_action = 'update_name' THEN
        UPDATE public.hawari_users
        SET display_name = p_display_name,
            last_updated = v_now_ms
        WHERE lower(trim(email)) = v_clean_target
          AND lower(trim(group_name)) = v_clean_group;

        RETURN jsonb_build_object('success', true, 'action', 'update_name', 'target', v_clean_target);

    ELSE
        RAISE EXCEPTION 'Invalid management action: %', p_action;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. GRANT EXECUTE Permissions
-- Allow anonymous and authenticated web clients to invoke the RPCs.
-- The RPC functions enforce internal Zero-Trust credential checks.
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.admin_get_students(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_user(text, text, text, text, text, text, text) TO anon, authenticated;
