-- =========================================================================
-- HAWARI BULK UPSERT RPC FOR OFFICIAL FLASHCARDS
-- Run this in Supabase SQL Editor to allow safe batch population
-- =========================================================================

CREATE OR REPLACE FUNCTION public.bulk_upsert_official_flashcards(p_cards jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item jsonb;
    cnt integer := 0;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_cards)
    LOOP
        INSERT INTO public.hawari_official_flashcards (id, course, deck, front, back, card_order)
        VALUES (
            item->>'id',
            COALESCE(item->>'course', 'infection'),
            item->>'deck',
            item->>'front',
            item->>'back',
            (item->>'card_order')::integer
        )
        ON CONFLICT (id) DO UPDATE SET
            deck = EXCLUDED.deck,
            front = EXCLUDED.front,
            back = EXCLUDED.back,
            card_order = EXCLUDED.card_order;
        cnt := cnt + 1;
    END LOOP;
    RETURN cnt;
END;
$$;

-- Grant execution to anon and authenticated
GRANT EXECUTE ON FUNCTION public.bulk_upsert_official_flashcards(jsonb) TO anon, authenticated;
