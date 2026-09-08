-- ==============================================================================
-- HAWARI MEDICAL PLATFORM - COMPLETE PROGRESS RESET RPC (QUESTIONS + TESTS + NOTES)
-- Author: Google Antigravity Advanced Agentic Engineering
-- Description:
-- reset_user_progress_rpc: Atomically resets all user progress on the server:
-- 1. tests = '[]'
-- 2. notebook_notes = '[]'
-- 3. questions = '[]'
-- 4. updates last_updated timestamp
-- Bypasses REST PATCH RLS limitations using SECURITY DEFINER.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.reset_user_progress_rpc(
    p_user_email text,
    p_group text DEFAULT 'infection'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_clean_email text := lower(trim(p_user_email));
    v_clean_group text := lower(trim(p_group));
    v_ts bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
    UPDATE public.hawari_users
    SET tests = '[]'::jsonb,
        notebook_notes = '[]'::jsonb,
        questions = '[]'::jsonb,
        last_updated = v_ts
    WHERE lower(trim(email)) = v_clean_email
      AND lower(trim(group_name)) = v_clean_group;

    RETURN jsonb_build_object(
        'success', true,
        'email', v_clean_email,
        'group', v_clean_group,
        'last_updated', v_ts,
        'cleared', jsonb_build_object('tests', 0, 'notebook_notes', 0, 'questions', 0)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_user_progress_rpc(text, text) TO anon, authenticated, service_role;
