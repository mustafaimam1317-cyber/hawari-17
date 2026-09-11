import fs from 'fs';

const SUPABASE_URL = "https://sueksolsletlhunpbtix.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";

const cards = JSON.parse(fs.readFileSync('C:\\Users\\H\\.gemini\\antigravity\\scratch\\hawari-infection\\official_500_flashcards.json', 'utf8'));

async function populate() {
    console.log(`Starting population of ${cards.length} official flashcards...`);
    const batchSize = 50;
    let totalInserted = 0;

    for (let i = 0; i < cards.length; i += batchSize) {
        const batch = cards.slice(i, i + batchSize).map(c => ({
            id: c.id,
            course: c.course || 'infection',
            deck: c.deck,
            front: c.front,
            back: c.back,
            card_order: c.card_order
        }));

        // Try RPC bulk_upsert_official_flashcards
        try {
            const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bulk_upsert_official_flashcards`, {
                method: "POST",
                headers: {
                    "apikey": ANON_KEY,
                    "Authorization": `Bearer ${ANON_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ p_cards: batch })
            });

            if (rpcRes.ok) {
                const cnt = await rpcRes.json();
                totalInserted += (typeof cnt === 'number' ? cnt : batch.length);
                console.log(`Batch ${i / batchSize + 1} (${batch.length} cards) upserted via RPC. Total: ${totalInserted}/${cards.length}`);
                continue;
            } else {
                const rpcErr = await rpcRes.text();
                // If RPC not found, try direct table insert
                if (i === 0) {
                    console.log("[Note] RPC bulk_upsert_official_flashcards not found. Trying direct REST...");
                }
            }
        } catch (e) {
            console.warn("RPC call error:", e.message);
        }

        // Direct table fallback
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/hawari_official_flashcards`, {
                method: "POST",
                headers: {
                    "apikey": ANON_KEY,
                    "Authorization": `Bearer ${ANON_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify(batch)
            });

            if (!res.ok) {
                const err = await res.text();
                console.error(`Batch ${i / batchSize + 1} failed (${res.status}):`, err);
                if (err.includes("row-level security")) {
                    console.log("\n[NOTE] RLS requires either executing 'supabase_bulk_upsert_rpc.sql' in Supabase SQL Editor");
                    console.log("or granting INSERT to anon: CREATE POLICY \"Allow insert anon\" ON public.hawari_official_flashcards FOR INSERT TO anon WITH CHECK (true);");
                    return;
                }
            } else {
                totalInserted += batch.length;
                console.log(`Batch ${i / batchSize + 1} (${batch.length} cards) uploaded successfully. Total: ${totalInserted}/${cards.length}`);
            }
        } catch (e) {
            console.error(`Batch ${i / batchSize + 1} error:`, e.message);
        }
    }

    console.log(`\nPopulation completed. Total cards processed: ${totalInserted}`);
}

populate().catch(console.error);
