-- ==============================================================================
-- HAWARI MEDICAL PLATFORM - DIRECT USER ADDITION & SECURE CREDENTIAL VERIFY RPC
-- Author: Google Antigravity Advanced Agentic Engineering
-- Description:
-- 1. admin_direct_add_user: Creates and immediately approves students/admins
--    bypassing pending queue, persisted authoritatively in hawari_users.
-- 2. verify_student_credentials: Securely validates student password hash
--    from any device/browser without exposing hashes over the wire.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC: admin_direct_add_user
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_direct_add_user(
    p_admin_email text,
    p_admin_hash text DEFAULT '',
    p_new_email text DEFAULT '',
    p_new_password_hash text DEFAULT '',
    p_role text DEFAULT 'student',
    p_display_name text DEFAULT '',
    p_group text DEFAULT 'infection'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_clean_admin text := lower(trim(p_admin_email));
    v_clean_new_email text := lower(trim(p_new_email));
    v_clean_group text := lower(trim(p_group));
    v_clean_name text := trim(p_display_name);
    v_role text := lower(trim(coalesce(p_role, 'student')));
    v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
    v_date text := to_char(now(), 'YYYY-MM-DD');
BEGIN
    -- Step 1: Verify authorized admin email
    IF v_clean_admin NOT IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com') THEN
        RAISE EXCEPTION 'Unauthorized: % is not a registered administrator email', p_admin_email;
    END IF;

    -- Step 2: Validate new email format
    IF v_clean_new_email IS NULL OR length(v_clean_new_email) = 0 OR v_clean_new_email NOT LIKE '%@gmail.com' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid Gmail address');
    END IF;

    IF v_role NOT IN ('admin', 'student', 'instructor') THEN
        v_role := 'student';
    END IF;

    IF length(v_clean_name) = 0 THEN
        v_clean_name := split_part(v_clean_new_email, '@', 1);
    END IF;

    -- Step 3: Direct atomic upsert into hawari_users as APPROVED
    INSERT INTO public.hawari_users (
        email,
        group_name,
        password_hash,
        role,
        status,
        display_name,
        date_registered,
        questions,
        tests,
        notebook_notes,
        flashcards,
        report_task_progress,
        last_updated
    ) VALUES (
        v_clean_new_email,
        v_clean_group,
        p_new_password_hash,
        v_role,
        'approved',
        v_clean_name,
        v_date,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        v_now_ms
    )
    ON CONFLICT (email, group_name) DO UPDATE
    SET password_hash = CASE WHEN length(p_new_password_hash) > 0 THEN p_new_password_hash ELSE public.hawari_users.password_hash END,
        display_name = v_clean_name,
        status = 'approved',
        role = v_role,
        last_updated = v_now_ms;

    RETURN jsonb_build_object(
        'success', true,
        'email', v_clean_new_email,
        'status', 'approved',
        'role', v_role,
        'display_name', v_clean_name
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_direct_add_user(text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. RPC: verify_student_credentials
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_student_credentials(
    p_email text,
    p_password_hash text,
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
    found_user record;
BEGIN
    SELECT email, status, role, display_name
    INTO found_user
    FROM public.hawari_users
    WHERE lower(trim(email)) = v_clean_email
      AND lower(trim(group_name)) = v_clean_group
      AND password_hash = p_password_hash
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'status', found_user.status,
            'role', found_user.role,
            'displayName', found_user.display_name
        );
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid credentials'
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_student_credentials(text, text, text) TO anon, authenticated, service_role;
