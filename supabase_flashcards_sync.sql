-- ==============================================================================
-- HAWARI MEDICAL PLATFORM - FLASHCARDS CLOUD SYNCHRONIZATION RPC
-- ==============================================================================
-- Run this script in Supabase Dashboard -> SQL Editor
-- This updates update_user_progress_rpc to atomically sync student flashcards
-- (including personal decks, SM-2 repetitions, easeFactor, and intervals).
--
-- Safe & Idempotent: Can be executed multiple times without affecting existing data.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.update_user_progress_rpc(
    p_user_email text,
    p_group text DEFAULT 'infection',
    p_tests jsonb DEFAULT '[]'::jsonb,
    p_notebook_notes jsonb DEFAULT '[]'::jsonb,
    p_flashcards jsonb DEFAULT '[]'::jsonb,
    p_last_updated bigint DEFAULT 0
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
    v_ts bigint := p_last_updated;
BEGIN
    IF v_ts <= 0 THEN
        v_ts := (extract(epoch from now()) * 1000)::bigint;
    END IF;

    UPDATE public.hawari_users
    SET tests = coalesce(p_tests, '[]'::jsonb),
        notebook_notes = coalesce(p_notebook_notes, '[]'::jsonb),
        flashcards = coalesce(p_flashcards, '[]'::jsonb),
        last_updated = v_ts
    WHERE lower(trim(email)) = v_clean_email
      AND lower(trim(group_name)) = v_clean_group;

    RETURN jsonb_build_object(
        'success', true, 
        'email', v_clean_email, 
        'last_updated', v_ts
    );
END;
$$;
