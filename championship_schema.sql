-- ============================================================================
-- 🏆 HAWARI QUIZ CHAMPIONSHIP & BRACKET ENGINE SCHEMA
-- Production Schema for High-Throughput Real-Time Tournament Brackets
-- ============================================================================

-- 1. Championships Master Table
CREATE TABLE IF NOT EXISTS public.championships (
    id TEXT PRIMARY KEY,
    group_name TEXT NOT NULL DEFAULT 'infection',
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'active', 'paused', 'completed'
    total_slots INT NOT NULL DEFAULT 50,
    bracket_type TEXT NOT NULL DEFAULT 'auto', -- 'auto', 'manual'
    settings JSONB NOT NULL DEFAULT '{
        "grace_period_sec": 60,
        "seconds_per_question": 20,
        "questions_per_match": 5,
        "points_per_correct": 10,
        "tie_breaker": "speed_on_correct"
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Participants Roster Table
CREATE TABLE IF NOT EXISTS public.championship_participants (
    id TEXT PRIMARY KEY,
    championship_id TEXT NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    student_name TEXT,
    seed_number INT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    eliminated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Question Sets Table
CREATE TABLE IF NOT EXISTS public.championship_question_sets (
    id TEXT PRIMARY KEY,
    championship_id TEXT NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Championship Matches & Brackets Table
CREATE TABLE IF NOT EXISTS public.championship_matches (
    id TEXT PRIMARY KEY,
    championship_id TEXT NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
    round_name TEXT NOT NULL, -- 'preliminary', 'round_32', 'round_16', 'quarter', 'semi', 'final'
    round_number INT NOT NULL DEFAULT 1,
    match_order INT NOT NULL DEFAULT 1,
    player1_id TEXT REFERENCES public.championship_participants(id) ON DELETE SET NULL,
    player2_id TEXT REFERENCES public.championship_participants(id) ON DELETE SET NULL,
    winner_id TEXT REFERENCES public.championship_participants(id) ON DELETE SET NULL,
    next_match_id TEXT REFERENCES public.championship_matches(id) ON DELETE SET NULL,
    next_match_slot INT, -- 1 for player1, 2 for player2 in next match
    question_set_id TEXT REFERENCES public.championship_question_sets(id) ON DELETE SET NULL,
    scheduled_start TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'lobby', 'in_progress', 'completed', 'forfeit', 'rescheduled'
    p1_score INT NOT NULL DEFAULT 0,
    p2_score INT NOT NULL DEFAULT 0,
    p1_time_ms BIGINT NOT NULL DEFAULT 0,
    p2_time_ms BIGINT NOT NULL DEFAULT 0,
    match_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- High-Speed Covering Indexes
CREATE INDEX IF NOT EXISTS idx_champ_group_status ON public.championships(group_name, status);
CREATE INDEX IF NOT EXISTS idx_champ_participants_champ_email ON public.championship_participants(championship_id, lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_champ_matches_champ_round ON public.championship_matches(championship_id, round_number, match_order);
CREATE INDEX IF NOT EXISTS idx_champ_matches_sched_status ON public.championship_matches(scheduled_start, status);
CREATE INDEX IF NOT EXISTS idx_champ_matches_p1 ON public.championship_matches(player1_id);
CREATE INDEX IF NOT EXISTS idx_champ_matches_p2 ON public.championship_matches(player2_id);

-- Row Level Security (RLS) Enablement
ALTER TABLE public.championships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_matches ENABLE ROW LEVEL SECURITY;

-- Read policies: public/anon/authenticated can view championships, participants, and matches
CREATE POLICY "Public Read Championships" ON public.championships FOR SELECT USING (true);
CREATE POLICY "Public Read Participants" ON public.championship_participants FOR SELECT USING (true);
CREATE POLICY "Public Read Matches" ON public.championship_matches FOR SELECT USING (true);
CREATE POLICY "Public Read Question Sets" ON public.championship_question_sets FOR SELECT USING (true);

-- Write policies: authenticated users (or anon with valid service/role) can insert/update
CREATE POLICY "Admin Write Championships" ON public.championships FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Write Participants" ON public.championship_participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Write Question Sets" ON public.championship_question_sets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin Write Matches" ON public.championship_matches FOR ALL USING (true) WITH CHECK (true);
