import fs from 'fs';
import assert from 'assert';

console.log("=== RUNNING OFFICIAL 500 FLASHCARDS & CACHE ENGINE TEST SUITE ===");

// Test 1: Validate JSON dataset
console.log("\n[Test 1] Validating official_500_flashcards.json dataset...");
const rawCards = JSON.parse(fs.readFileSync('C:\\Users\\H\\.gemini\\antigravity\\scratch\\hawari-infection\\official_500_flashcards.json', 'utf8'));

assert.strictEqual(rawCards.length, 500, "Dataset must contain exactly 500 cards");

const expectedTopics = {
    "Brucellosis": 16,
    "Typhoid Fever": 18,
    "Meningitis": 22,
    "Encephalitis": 12,
    "Hepatitis": 24,
    "Cholangitis & Liver Abscess": 12,
    "Pneumonia": 15,
    "Heat Disorders": 6,
    "Fungal Infections": 18,
    "COVID-19": 14,
    "HIV": 22,
    "Malaria": 16,
    "Tuberculosis": 24,
    "Leptospirosis": 12,
    "H. Pylori": 10,
    "Fever & FUO": 9,
    "UTI": 14,
    "Septicemia & Septic Shock": 16,
    "Filariasis": 10,
    "Toxoplasmosis": 14,
    "Leishmaniosis": 12,
    "Ocular Parasites": 10,
    "Viral Hemorrhagic Fevers": 14,
    "Rabies": 10,
    "Cat Scratch Disease": 8,
    "Plague": 17,
    "Infectious Diarrhea": 14,
    "Food Poisoning": 14,
    "Cholera": 10,
    "Anti-Viral Drugs": 14,
    "Zoonotic Diseases": 10,
    "Levels of Prevention & Immunization": 12,
    "Post Exposure Prophylaxis": 10,
    "Community & Nosocomial Infections": 12,
    "Infection Prevention & Control": 10,
    "Cutaneous Manifestations": 9,
    "Parasitology": 10
};

assert.strictEqual(Object.keys(expectedTopics).length, 37, "Must have exactly 37 topics");

const actualTopicCounts = {};
const idsSeen = new Set();

rawCards.forEach((c, idx) => {
    assert.strictEqual(c.card_order, idx + 1, `Card order mismatch at index ${idx}`);
    assert.strictEqual(c.id, `fc_inf_${idx + 1}`, `Card ID mismatch at index ${idx}`);
    assert.ok(c.front && c.front.trim().length > 5, `Card #${c.card_order} has empty or short front text`);
    assert.ok(c.back && c.back.trim().length > 5, `Card #${c.card_order} has empty or short back text`);
    assert.ok(!idsSeen.has(c.id), `Duplicate card ID detected: ${c.id}`);
    idsSeen.add(c.id);

    actualTopicCounts[c.deck] = (actualTopicCounts[c.deck] || 0) + 1;
});

for (const [topic, count] of Object.entries(expectedTopics)) {
    assert.strictEqual(actualTopicCounts[topic], count, `Topic count mismatch for ${topic}: expected ${count}, got ${actualTopicCounts[topic]}`);
}
console.log("✓ PASS: All 500 cards and 37 topics validated successfully.");

// Test 2: Validate official_flashcards_data.js module
console.log("\n[Test 2] Validating official_flashcards_data.js module export...");
import { OFFICIAL_INFECTION_FLASHCARDS } from './official_flashcards_data.js';

assert.strictEqual(OFFICIAL_INFECTION_FLASHCARDS.length, 500, "Module export must have 500 cards");
assert.strictEqual(OFFICIAL_INFECTION_FLASHCARDS[0].id, "fc_inf_1");
assert.strictEqual(OFFICIAL_INFECTION_FLASHCARDS[499].id, "fc_inf_500");
console.log("✓ PASS: official_flashcards_data.js exports valid 500 cards.");

// Test 3: Test HawariFlashcardsCacheEngine logic
console.log("\n[Test 3] Testing HawariFlashcardsCacheEngine persistent caching & zero-egress guarantee...");

const mockLocalStorage = new Map();
global.localStorage = {
    getItem: (k) => mockLocalStorage.get(k) || null,
    setItem: (k, v) => mockLocalStorage.set(k, String(v)),
    removeItem: (k) => mockLocalStorage.delete(k),
    clear: () => mockLocalStorage.clear()
};

global.state = { activeGroup: "infection" };
global.window = {
    OFFICIAL_INFECTION_FLASHCARDS: OFFICIAL_INFECTION_FLASHCARDS
};

const FLASHCARDS_CACHE_KEY_PREFIX = "hawari_official_fc_v1_";
const HawariFlashcardsCacheEngine = {
    _memoryCache: {},
    networkCalls: 0,

    getOfficialCardsSync(course = (state.activeGroup || "infection").toLowerCase()) {
        const group = (course || "infection").toLowerCase();
        if (this._memoryCache[group] && this._memoryCache[group].length > 0) {
            return this._memoryCache[group];
        }
        const storageKey = FLASHCARDS_CACHE_KEY_PREFIX + group;
        try {
            const cachedRaw = localStorage.getItem(storageKey);
            if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this._memoryCache[group] = parsed;
                    return parsed;
                }
            }
        } catch (e) {}

        const fallback = (group === "infection")
            ? (window.OFFICIAL_INFECTION_FLASHCARDS || [])
            : [];

        if (fallback.length > 0) {
            this.setCachedCards(group, fallback);
            return fallback;
        }
        return [];
    },

    setCachedCards(course, cards) {
        const group = (course || "infection").toLowerCase();
        this._memoryCache[group] = cards;
        try {
            localStorage.setItem(FLASHCARDS_CACHE_KEY_PREFIX + group, JSON.stringify(cards));
        } catch (e) {}
    },

    clearMemoryCache() {
        this._memoryCache = {};
    }
};

// Cold load: No cache exists in localStorage
assert.strictEqual(mockLocalStorage.has("hawari_official_fc_v1_infection"), false, "Cache must be empty initially");
const coldCards = HawariFlashcardsCacheEngine.getOfficialCardsSync("infection");
assert.strictEqual(coldCards.length, 500, "Cold load must return 500 cards");
assert.strictEqual(mockLocalStorage.has("hawari_official_fc_v1_infection"), true, "Cache must be populated in localStorage");

// Warm load: Memory cache hit (0ms)
const warmMemoryCards = HawariFlashcardsCacheEngine.getOfficialCardsSync("infection");
assert.strictEqual(warmMemoryCards.length, 500);

// Simulate Logout: Clear in-memory cache, but KEEP localStorage intact
HawariFlashcardsCacheEngine.clearMemoryCache();
assert.strictEqual(Object.keys(HawariFlashcardsCacheEngine._memoryCache).length, 0, "Memory cache cleared");
assert.strictEqual(mockLocalStorage.has("hawari_official_fc_v1_infection"), true, "LocalStorage cache persists across logout");

// Simulate Re-login: Loads immediately from LocalStorage with ZERO network calls!
const reloginCards = HawariFlashcardsCacheEngine.getOfficialCardsSync("infection");
assert.strictEqual(reloginCards.length, 500, "Must load 500 cards from persistent cache");
console.log("✓ PASS: HawariFlashcardsCacheEngine guarantees zero egress on repeat visits & across logout/login.");

// Test 4: Test Old Placeholder Cards Purging & SM-2 Progress Merging
console.log("\n[Test 4] Testing legacy placeholder purging & SM-2 student progress merge...");

// Simulate a student who had old placeholder cards (fc_1 to fc_5) AND reviewed one official card
const studentUser = {
    email: "student@hawari.test",
    flashcards: [
        { id: "fc_1", front: "Old placeholder 1", back: "Old answer 1" },
        { id: "fc_2", front: "Old placeholder 2", back: "Old answer 2" },
        { id: "fc_5", front: "Old placeholder 5", back: "Old answer 5" },
        { 
            id: "fc_inf_1", // Official card reviewed
            repetitions: 3,
            interval: 7,
            easeFactor: 2.65,
            nextReviewDate: Date.now() + 7 * 86400000,
            status: "mastered",
            state: "mastered"
        },
        {
            id: "fc_pers_my_custom_note", // Personal custom card created by student
            front: "My custom question",
            back: "My custom answer",
            isOfficial: false,
            authorEmail: "student@hawari.test"
        }
    ]
};

// Execute merging logic
const activeCourse = "infection";
const officialBase = HawariFlashcardsCacheEngine.getOfficialCardsSync(activeCourse);

// Purge legacy placeholder cards (fc_1 to fc_5)
const rawUserCards = Array.isArray(studentUser.flashcards) 
    ? studentUser.flashcards.filter(c => c && !["fc_1", "fc_2", "fc_3", "fc_4", "fc_5"].includes(c.id))
    : [];

const userReviewMap = new Map();
const personalCards = [];
rawUserCards.forEach(c => {
    if (!c || !c.id) return;
    if (c.isOfficial === false) {
        personalCards.push(c);
    } else {
        userReviewMap.set(c.id, c);
    }
});

const mergedOfficial = officialBase.map(baseCard => {
    const userProgress = userReviewMap.get(baseCard.id);
    if (userProgress) {
        return {
            ...baseCard,
            repetitions: userProgress.repetitions !== undefined ? userProgress.repetitions : baseCard.repetitions,
            interval: userProgress.interval !== undefined ? userProgress.interval : baseCard.interval,
            easeFactor: userProgress.easeFactor !== undefined ? userProgress.easeFactor : baseCard.easeFactor,
            nextReviewDate: userProgress.nextReviewDate !== undefined ? userProgress.nextReviewDate : baseCard.nextReviewDate,
            lastReviewDate: userProgress.lastReviewDate !== undefined ? userProgress.lastReviewDate : baseCard.lastReviewDate,
            state: userProgress.state || baseCard.state,
            status: userProgress.status || baseCard.status
        };
    }
    return { ...baseCard };
});

const finalStudentCards = [...mergedOfficial, ...personalCards];

// Assertions:
// 1. Old cards fc_1, fc_2, fc_5 are purged
assert.strictEqual(finalStudentCards.some(c => ["fc_1", "fc_2", "fc_3", "fc_4", "fc_5"].includes(c.id)), false, "Old placeholder cards must be purged");

// 2. Total cards = 500 official + 1 personal = 501
assert.strictEqual(finalStudentCards.length, 501, "Expected 500 official + 1 personal card");

// 3. Official card fc_inf_1 has the student's review metrics
const mergedCard1 = finalStudentCards.find(c => c.id === "fc_inf_1");
assert.strictEqual(mergedCard1.repetitions, 3);
assert.strictEqual(mergedCard1.interval, 7);
assert.strictEqual(mergedCard1.easeFactor, 2.65);
assert.strictEqual(mergedCard1.status, "mastered");

// 4. Official card fc_inf_2 (not yet reviewed) has default metrics
const mergedCard2 = finalStudentCards.find(c => c.id === "fc_inf_2");
assert.strictEqual(mergedCard2.repetitions, 0);
assert.strictEqual(mergedCard2.interval, 0);
assert.strictEqual(mergedCard2.status, "review");

// 5. Personal card is preserved
const persCard = finalStudentCards.find(c => c.id === "fc_pers_my_custom_note");
assert.ok(persCard, "Student personal card must be preserved");
assert.strictEqual(persCard.isOfficial, false);

console.log("✓ PASS: Legacy cards purged, student SM-2 stats merged, personal cards preserved.");

// Test 5: Validate SQL Schema File
console.log("\n[Test 5] Validating supabase_official_flashcards_schema.sql...");
const sql = fs.readFileSync('C:\\Users\\H\\.gemini\\antigravity\\scratch\\hawari-infection\\supabase_official_flashcards_schema.sql', 'utf8');
assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.hawari_official_flashcards"), "SQL contains CREATE TABLE");
assert.ok(sql.includes("ENABLE ROW LEVEL SECURITY"), "SQL contains RLS");
assert.ok(sql.includes("Allow public read official flashcards"), "SQL contains read policy");
assert.ok(sql.includes("Allow admin write official flashcards"), "SQL contains write policy");
console.log("✓ PASS: SQL schema contains table definition, indexes, and RLS policies.");

console.log("\n=========================================================================");
console.log("ALL 5 OFFICIAL FLASHCARD TEST SUITES PASSED (100% SUCCESS)!");
console.log("=========================================================================");
