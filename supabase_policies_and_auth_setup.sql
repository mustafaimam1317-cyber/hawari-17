-- ==============================================================================
-- HAWARI MEDICAL COURSE - SUPABASE RLS & AUTH PRODUCTION MIGRATION
-- ==============================================================================

-- 1. Create or Replace Helper Function: is_admin()
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

-- ==============================================================================
-- 2. TABLE: hawari_book_files (Book Catalog & Storage Records)
-- ==============================================================================
ALTER TABLE public.hawari_book_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_files_select" ON public.hawari_book_files;
DROP POLICY IF EXISTS "hawari_book_files_select" ON public.hawari_book_files;
DROP POLICY IF EXISTS "hawari_book_files_public_select" ON public.hawari_book_files;
DROP POLICY IF EXISTS "book_files_admin_insert" ON public.hawari_book_files;
DROP POLICY IF EXISTS "book_files_admin_update" ON public.hawari_book_files;
DROP POLICY IF EXISTS "book_files_admin_delete" ON public.hawari_book_files;
DROP POLICY IF EXISTS "book_files_admin_write" ON public.hawari_book_files;
DROP POLICY IF EXISTS "hawari_book_files_admin_write" ON public.hawari_book_files;

-- Allow all authenticated users and anon users to read book catalog (covers, titles, page counts)
CREATE POLICY "hawari_book_files_read_all"
ON public.hawari_book_files
FOR SELECT
TO public
USING (true);

-- Allow admins to insert new books
CREATE POLICY "hawari_book_files_admin_insert"
ON public.hawari_book_files
FOR INSERT
TO public
WITH CHECK (is_admin() OR (auth.role() = 'authenticated' AND coalesce(auth.jwt() ->> 'email', '') IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com')));

-- Allow admins to update books
CREATE POLICY "hawari_book_files_admin_update"
ON public.hawari_book_files
FOR UPDATE
TO public
USING (is_admin() OR (auth.role() = 'authenticated' AND coalesce(auth.jwt() ->> 'email', '') IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com')))
WITH CHECK (is_admin() OR (auth.role() = 'authenticated' AND coalesce(auth.jwt() ->> 'email', '') IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com')));

-- Allow admins to delete books
CREATE POLICY "hawari_book_files_admin_delete"
ON public.hawari_book_files
FOR DELETE
TO public
USING (is_admin() OR (auth.role() = 'authenticated' AND coalesce(auth.jwt() ->> 'email', '') IN ('mustafaimam1317@gmail.com', 'mustafa172004@gmail.com')));

-- ==============================================================================
-- 3. TABLE: hawari_book_access (Full Grant Access List per Student)
-- ==============================================================================
ALTER TABLE public.hawari_book_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_access_select" ON public.hawari_book_access;
DROP POLICY IF EXISTS "hawari_book_access_select" ON public.hawari_book_access;
DROP POLICY IF EXISTS "book_access_admin_insert" ON public.hawari_book_access;
DROP POLICY IF EXISTS "book_access_admin_update" ON public.hawari_book_access;
DROP POLICY IF EXISTS "book_access_admin_delete" ON public.hawari_book_access;
DROP POLICY IF EXISTS "book_access_admin_write" ON public.hawari_book_access;
DROP POLICY IF EXISTS "hawari_book_access_admin_write" ON public.hawari_book_access;

-- Student can only read their own book access status; Admin can read all
CREATE POLICY "hawari_book_access_select"
ON public.hawari_book_access
FOR SELECT
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
);

-- Admin can manage access grants (insert, update, delete)
CREATE POLICY "hawari_book_access_admin_all"
ON public.hawari_book_access
FOR ALL
TO public
USING (is_admin())
WITH CHECK (is_admin());

-- ==============================================================================
-- 4. TABLE: hawari_book_annotations (Highlights, Notes & Bookmarks)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.hawari_book_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    email TEXT NOT NULL,
    notes TEXT,
    highlights JSONB DEFAULT '[]'::jsonb,
    drawings JSONB DEFAULT '[]'::jsonb,
    bookmarks BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(document_id, page_number, email)
);

ALTER TABLE public.hawari_book_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "annotations_delete" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "annotations_insert" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "annotations_isolation" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "annotations_owner" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "annotations_select" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "annotations_update" ON public.hawari_book_annotations;
DROP POLICY IF EXISTS "hawari_book_annotations_owner_all" ON public.hawari_book_annotations;

-- Strict Student Data Isolation: Each student only accesses their own annotations
CREATE POLICY "hawari_book_annotations_isolation"
ON public.hawari_book_annotations
FOR ALL
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
)
WITH CHECK (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
);

-- ==============================================================================
-- 5. TABLE: hawari_user_book_progress (Last Read Page Tracking)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.hawari_user_book_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    document_id TEXT NOT NULL,
    last_page INTEGER DEFAULT 1,
    total_pages INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(email, document_id)
);

ALTER TABLE public.hawari_user_book_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hawari_user_book_progress_isolation" ON public.hawari_user_book_progress;

CREATE POLICY "hawari_user_book_progress_isolation"
ON public.hawari_user_book_progress
FOR ALL
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
)
WITH CHECK (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
);

-- ==============================================================================
-- 6. TABLE: hawari_users (Account Information, Pending/Approved Status)
-- ==============================================================================
ALTER TABLE public.hawari_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hawari_users_select_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_insert_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_update_policy" ON public.hawari_users;
DROP POLICY IF EXISTS "hawari_users_delete_policy" ON public.hawari_users;

-- Public can insert during registration (new user sign up)
CREATE POLICY "hawari_users_insert_policy"
ON public.hawari_users
FOR INSERT
TO public
WITH CHECK (true);

-- Student can only read their own profile; Admin can read all users
CREATE POLICY "hawari_users_select_policy"
ON public.hawari_users
FOR SELECT
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
);

-- Student can update their own data; Admin can update all (approve pending accounts)
CREATE POLICY "hawari_users_update_policy"
ON public.hawari_users
FOR UPDATE
TO public
USING (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
)
WITH CHECK (
  (coalesce(auth.jwt() ->> 'email', '') = email) 
  OR is_admin()
);

-- Admin can delete accounts
CREATE POLICY "hawari_users_delete_policy"
ON public.hawari_users
FOR DELETE
TO public
USING (is_admin());

-- ==============================================================================
-- 7. SECURE RPC FUNCTIONS: ZERO-LEAKAGE EMAIL CHECK & SERVER-SIDE GRADING
-- ==============================================================================

-- A. Safe Email Existence & Status Check (No Password Hash Exposure)
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
            'status', found_user.status,
            'role', found_user.role,
            'displayName', found_user.display_name
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

-- B. Sanitized Questions Fetch (Strips correctOption and explanation)
CREATE OR REPLACE FUNCTION public.get_sanitized_questions(p_group text DEFAULT 'infection')
RETURNS jsonb AS $$
DECLARE
    q_record record;
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

-- C. Server-Side Exam Submission & Grading Engine
CREATE OR REPLACE FUNCTION public.submit_and_grade_exam(
    p_group text,
    p_exam_id text,
    p_answers jsonb,
    p_email text
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
BEGIN
    SELECT questions INTO raw_questions
    FROM public.hawari_global_questions
    WHERE group_name = lower(trim(p_group))
    LIMIT 1;

    IF raw_questions IS NULL THEN
        RAISE EXCEPTION 'Course questions not found';
    END IF;

    FOR elem IN SELECT * FROM jsonb_array_elements(raw_questions)
    LOOP
        q_id := elem->>'id';
        -- Check if this question was included in submitted answers or exam
        IF p_answers ? q_id THEN
            total_count := total_count + 1;
            user_ans := p_answers->>q_id;
            correct_opt := elem->>'correctOption';
            explanation_txt := elem->>'explanation';

            IF user_ans IS NOT NULL AND user_ans = correct_opt THEN
                correct_count := correct_count + 1;
            END IF;

            results_array := results_array || jsonb_build_object(
                'questionId', q_id,
                'userAns', user_ans,
                'correctOption', correct_opt,
                'explanation', explanation_txt,
                'isCorrect', (user_ans IS NOT NULL AND user_ans = correct_opt)
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
