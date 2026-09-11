-- =========================================================================
-- HAWARI OFFICIAL FLASHCARDS TABLE (SHARED CURRICULUM STORAGE)
-- Stores authoritative high-yield flashcard decks for courses.
-- Each student references these cards and stores only their SM-2 progress.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.hawari_official_flashcards (
    id TEXT PRIMARY KEY,
    course TEXT NOT NULL DEFAULT 'infection',
    deck TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    card_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optimize queries by course, deck, and card ordering
CREATE INDEX IF NOT EXISTS idx_hawari_official_fc_course ON public.hawari_official_flashcards (course);
CREATE INDEX IF NOT EXISTS idx_hawari_official_fc_deck ON public.hawari_official_flashcards (course, deck);
CREATE INDEX IF NOT EXISTS idx_hawari_official_fc_order ON public.hawari_official_flashcards (course, card_order);

-- Enable Row-Level Security
ALTER TABLE public.hawari_official_flashcards ENABLE ROW LEVEL SECURITY;

-- 1. Public Read Policy: All authenticated students and guest sessions can read official curriculum cards
DROP POLICY IF EXISTS "Allow public read official flashcards" ON public.hawari_official_flashcards;
CREATE POLICY "Allow public read official flashcards"
    ON public.hawari_official_flashcards
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- 2. Admin / Service Role Write Policy: Only service role or authorized admins can insert/update/delete
DROP POLICY IF EXISTS "Allow admin write official flashcards" ON public.hawari_official_flashcards;
CREATE POLICY "Allow admin write official flashcards"
    ON public.hawari_official_flashcards
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.hawari_users
            WHERE hawari_users.email = auth.jwt()->>'email'
            AND hawari_users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.hawari_users
            WHERE hawari_users.email = auth.jwt()->>'email'
            AND hawari_users.role = 'admin'
        )
    );
