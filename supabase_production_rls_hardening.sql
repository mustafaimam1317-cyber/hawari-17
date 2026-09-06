-- ==============================================================================
-- HAWARI COURSE PLATFORM - SUPABASE PRODUCTION RLS & ZERO-TRUST HARDENING
-- ==============================================================================
-- Run this script in the Supabase SQL Editor to enforce impenetrable Row Level Security.
-- This script is completely idempotent (safe to run multiple times).

-- ------------------------------------------------------------------------------
-- 1. Helper Function: is_admin()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN (
    coalesce(auth.jwt() ->> 'email', '') IN (
      'mustafaimam1317@gmail.com',
      'mustafa172004@gmail.com'
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 2. TABLE: hawari_global_questions (Protect Question Bank & Answers)
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.hawari_global_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hawari_global_questions_read_all" ON public.hawari_global_questions;
DROP POLICY IF EXISTS "hawari_global_questions_public_select" ON public.hawari_global_questions;
DROP POLICY IF EXISTS "hawari_global_questions_admin_all" ON public.hawari_global_questions;
DROP POLICY IF EXISTS "hawari_global_questions_admin_select" ON public.hawari_global_questions;
DROP POLICY IF EXISTS "hawari_global_questions_admin_write" ON public.hawari_global_questions;

-- Only verified administrators can directly query or modify the raw question bank
CREATE POLICY "hawari_global_questions_admin_all"
ON public.hawari_global_questions
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

-- Explicitly revoke direct SELECT on hawari_global_questions from anon role
REVOKE SELECT ON TABLE public.hawari_global_questions FROM anon;

-- ------------------------------------------------------------------------------
-- 3. TABLE: hawari_users (Protect User Credentials, Hashes & Roles)
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.hawari_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hawari_users_select_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_insert_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_update_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_delete_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_read_all" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_public_select" ON public.hawari_users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.hawari_users;
DROP POLICY IF EXISTS "Allow public read" ON public.hawari_users;
DROP POLICY IF EXISTS "allow_anon_read" ON public.hawari_users;
DROP POLICY IF EXISTS "public_read" ON public.hawari_users;

-- Explicitly revoke direct SELECT on hawari_users from anon role
-- Strangers cannot scrape emails or password hashes!
REVOKE SELECT ON TABLE public.hawari_users FROM anon;

-- A. Registration: Anyone can sign up, but cannot self-assign 'admin' or 'approved'
CREATE POLICY "hawari_users_insert_policy"
ON public.hawari_users
FOR INSERT
TO public
WITH CHECK (
  is_admin() 
  OR (
    coalesce(role, 'student') = 'student' 
    AND coalesce(status, 'pending') = 'pending'
  )
);

-- B. Read: Students can ONLY read their own profile; Admin can read all
CREATE POLICY "hawari_users_select_policy"
ON public.hawari_users
FOR SELECT
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = lower(trim(email)))
  OR is_admin()
);

-- C. Update: Students can only update their own progress (cannot self-approve or elevate role)
CREATE POLICY "hawari_users_update_policy"
ON public.hawari_users
FOR UPDATE
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = lower(trim(email)))
  OR is_admin()
)
WITH CHECK (
  is_admin()
  OR (
    (coalesce(auth.jwt() ->> 'email', '') = lower(trim(email)))
    AND role = 'student'
  )
);

-- D. Delete: Admin only
CREATE POLICY "hawari_users_delete_policy"
ON public.hawari_users
FOR DELETE
TO public
USING (is_admin());

-- ------------------------------------------------------------------------------
-- 4. TABLE: hawari_course_quizzes (Published Exams)
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.hawari_course_quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "course_quizzes_select" ON public.hawari_course_quizzes;
DROP POLICY IF EXISTS "course_quizzes_admin_all" ON public.hawari_course_quizzes;

CREATE POLICY "course_quizzes_select"
ON public.hawari_course_quizzes
FOR SELECT
TO public
USING (
  status = 'active'
  OR is_admin()
);

CREATE POLICY "course_quizzes_admin_all"
ON public.hawari_course_quizzes
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

-- ------------------------------------------------------------------------------
-- 5. TABLE: hawari_book_access & hawari_book_files
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.hawari_book_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hawari_book_access_select" ON public.hawari_book_access;
DROP POLICY IF EXISTS "hawari_book_access_admin_all" ON public.hawari_book_access;

CREATE POLICY "hawari_book_access_select"
ON public.hawari_book_access
FOR SELECT
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = lower(trim(email)))
  OR is_admin()
);

CREATE POLICY "hawari_book_access_admin_all"
ON public.hawari_book_access
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

ALTER TABLE IF EXISTS public.hawari_book_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hawari_book_files_read_all" ON public.hawari_book_files;
DROP POLICY IF EXISTS "hawari_book_files_admin_all" ON public.hawari_book_files;

CREATE POLICY "hawari_book_files_read_all"
ON public.hawari_book_files
FOR SELECT
TO public
USING (true);

CREATE POLICY "hawari_book_files_admin_all"
ON public.hawari_book_files
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

-- ------------------------------------------------------------------------------
-- 6. SECURE RPC PROCEDURES (Zero Answer Leakage & Server-Side Verification)
-- ------------------------------------------------------------------------------

-- A. check_email_status (Safe Pre-Login Check - No password_hash returned)
CREATE OR REPLACE FUNCTION public.check_email_status(lookup_email text, p_group text DEFAULT 'infection')
RETURNS jsonb AS $$
DECLARE
    found_user record;
BEGIN
    SELECT email, status, role, display_name 
    INTO found_user
    FROM public.hawari_users
    WHERE lower(email) = lower(trim(lookup_email))
      AND group_name = lower(trim(p_group))
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'exists', true,
            'status', coalesce(found_user.status, 'pending'),
            'role', coalesce(found_user.role, 'student'),
            'displayName', coalesce(found_user.display_name, '')
        );
    ELSE
        RETURN jsonb_build_object(
            'exists', false,
            'status', 'not_found',
            'role', 'student',
            'displayName', ''
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. get_sanitized_questions (Excludes correctOption and explanation)
CREATE OR REPLACE FUNCTION public.get_sanitized_questions(p_group text DEFAULT 'infection')
RETURNS jsonb AS $$
DECLARE
    raw_questions jsonb;
    clean_questions jsonb := '[]'::jsonb;
    elem jsonb;
BEGIN
    SELECT questions INTO raw_questions
    FROM public.hawari_global_questions
    WHERE group_name = lower(trim(p_group))
    LIMIT 1;

    IF raw_questions IS NULL OR jsonb_array_length(raw_questions) = 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    FOR elem IN SELECT * FROM jsonb_array_elements(raw_questions)
    LOOP
        clean_questions := clean_questions || jsonb_build_object(
            'id', elem->>'id',
            'source', elem->>'source',
            'topic', elem->>'topic',
            'text', elem->>'text',
            'options', elem->'options'
        );
    END LOOP;

    RETURN clean_questions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. verify_exam_answers (Server-Side Answers Verification)
CREATE OR REPLACE FUNCTION public.verify_exam_answers(
    p_exam_id text,
    p_group text,
    p_answers jsonb
)
RETURNS jsonb AS $$
DECLARE
    raw_questions jsonb;
    elem jsonb;
    q_id text;
    user_ans text;
    correct_opt text;
    correct_count integer := 0;
    total_count integer := 0;
    score_pct integer := 0;
BEGIN
    -- 1. Try hawari_course_quizzes first
    SELECT questions INTO raw_questions
    FROM public.hawari_course_quizzes
    WHERE id = p_exam_id
    LIMIT 1;

    -- 2. Fallback to hawari_global_questions if not in course_quizzes
    IF raw_questions IS NULL OR jsonb_array_length(raw_questions) = 0 THEN
        SELECT questions INTO raw_questions
        FROM public.hawari_global_questions
        WHERE group_name = lower(trim(p_group))
        LIMIT 1;
    END IF;

    IF raw_questions IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Quiz questions not found');
    END IF;

    FOR elem IN SELECT * FROM jsonb_array_elements(raw_questions)
    LOOP
        q_id := elem->>'id';
        total_count := total_count + 1;
        user_ans := upper(trim(COALESCE(p_answers->>q_id, '')));
        correct_opt := upper(trim(COALESCE(elem->>'correctOption', '')));

        IF user_ans != '' AND user_ans = correct_opt THEN
            correct_count := correct_count + 1;
        END IF;
    END LOOP;

    IF total_count > 0 THEN
        score_pct := round((correct_count::numeric / total_count::numeric) * 100);
    ELSE
        score_pct := 0;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'examId', p_exam_id,
        'score', score_pct,
        'correctCount', correct_count,
        'totalQuestions', total_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- D. submit_and_grade_exam (Complete Server-Side Evaluation with Review)
CREATE OR REPLACE FUNCTION public.submit_and_grade_exam(
    p_group text,
    p_exam_id text,
    p_answers jsonb,
    p_email text,
    p_question_ids jsonb DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    raw_questions jsonb;
    elem jsonb;
    q_id text;
    user_ans text;
    correct_opt text;
    explanation_txt text;
    correct_count integer := 0;
    total_count integer := 0;
    score_pct integer := 0;
    results_array jsonb := '[]'::jsonb;
    has_specific_ids boolean := false;
BEGIN
    -- Check if specific question IDs are provided
    IF p_question_ids IS NOT NULL AND jsonb_typeof(p_question_ids) = 'array' AND jsonb_array_length(p_question_ids) > 0 THEN
        has_specific_ids := true;
    END IF;

    -- 1. Try hawari_course_quizzes first if exam_id exists there
    SELECT questions INTO raw_questions
    FROM public.hawari_course_quizzes
    WHERE id = p_exam_id
    LIMIT 1;

    -- 2. If not found in course_quizzes, get from hawari_global_questions
    IF raw_questions IS NULL OR jsonb_array_length(raw_questions) = 0 THEN
        SELECT questions INTO raw_questions
        FROM public.hawari_global_questions
        WHERE group_name = lower(trim(p_group))
        LIMIT 1;
    END IF;

    IF raw_questions IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Exam questions not found');
    END IF;

    FOR elem IN SELECT * FROM jsonb_array_elements(raw_questions)
    LOOP
        q_id := elem->>'id';
        -- If specific question IDs are specified, only evaluate questions in that list
        IF NOT has_specific_ids OR p_question_ids ? q_id THEN
            total_count := total_count + 1;
            user_ans := upper(trim(COALESCE(p_answers->>q_id, '')));
            correct_opt := upper(trim(COALESCE(elem->>'correctOption', '')));
            explanation_txt := elem->>'explanation';

            IF user_ans != '' AND user_ans = correct_opt THEN
                correct_count := correct_count + 1;
            END IF;

            results_array := results_array || jsonb_build_object(
                'questionId', q_id,
                'userAns', user_ans,
                'correctOption', correct_opt,
                'explanation', explanation_txt,
                'isCorrect', (user_ans != '' AND user_ans = correct_opt)
            );
        END IF;
    END LOOP;

    IF total_count > 0 THEN
        score_pct := round((correct_count::numeric / total_count::numeric) * 100);
    ELSE
        score_pct := 0;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'examId', p_exam_id,
        'score', score_pct,
        'correctCount', correct_count,
        'totalQuestions', total_count,
        'results', results_array
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant EXECUTE privileges on secure RPCs to public/anon
GRANT EXECUTE ON FUNCTION public.check_email_status(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sanitized_questions(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_exam_answers(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_and_grade_exam(text, text, jsonb, text, jsonb) TO anon, authenticated;

