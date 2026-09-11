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
                if (err.includes("PGRST205") || err.includes("does not exist") || err.includes("schema cache")) {
                    console.log("\n[NOTE] Table public.hawari_official_flashcards does not exist yet.");
                    console.log("Please run 'supabase_official_flashcards_schema.sql' in Supabase SQL Editor first.");
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
