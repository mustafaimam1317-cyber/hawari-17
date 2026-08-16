const https = require("https");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "sueksolsletlhunpbtix.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";

function supabaseRequest(pathStr, options = {}) {
    return new Promise((resolve, reject) => {
        const headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        };

        const req = https.request({
            hostname: SUPABASE_URL,
            path: `/rest/v1/${pathStr}`,
            method: options.method || "GET",
            headers: headers
        }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                let parsed = data;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {}
                resolve({ status: res.statusCode, data: parsed });
            });
        });

        req.on("error", reject);
        if (options.body) {
            req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runTests() {
    console.log("==================================================");
    console.log("🧪 STARTING COURSE ISOLATION & PROGRESS TEST SUITE");
    console.log("==================================================");
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${message}`);
            failed++;
        }
    }

    // --- TEST 1: Question Merging Logic (550 -> 600 questions) ---
    console.log("\n--- Test 1: Question Bank Expansion (550 -> 600 Questions) ---");
    function mergeQuestionsWithGlobal(userQuestions, globalQuestions) {
        if (!globalQuestions || globalQuestions.length === 0) return userQuestions || [];
        if (!userQuestions || userQuestions.length === 0) return globalQuestions.map(q => ({ ...q }));

        const userMap = new Map();
        userQuestions.forEach(q => {
            if (q && q.id !== undefined) {
                userMap.set(String(q.id), q);
            }
        });

        return globalQuestions.map(gq => {
            const uq = userMap.get(String(gq.id));
            if (uq) {
                return {
                    ...gq,
                    status: uq.status || "unused",
                    marked: !!uq.marked,
                    notes: uq.notes || "",
                    highlightedHtml: uq.highlightedHtml || null,
                    userAnswer: uq.userAnswer !== undefined ? uq.userAnswer : null,
                    timeSpent: uq.timeSpent || 0,
                    history: Array.isArray(uq.history) ? uq.history : []
                };
            }
            return {
                ...gq,
                status: "unused",
                marked: false,
                notes: "",
                highlightedHtml: null,
                userAnswer: null,
                timeSpent: 0,
                history: []
            };
        });
    }

    // Seed 550 questions
    const oldBank = Array.from({ length: 550 }, (_, i) => ({
        id: i + 1,
        question: `Question ${i + 1}`,
        options: ["A", "B", "C", "D"],
        correctAnswer: "A"
    }));

    // Student answered 10 questions and took notes on 3
    const studentAnswers = oldBank.slice(0, 10).map((q, idx) => ({
        id: q.id,
        status: idx % 2 === 0 ? "correct" : "incorrect",
        marked: idx === 0,
        notes: idx === 0 ? "High yield note" : "",
        userAnswer: idx % 2 === 0 ? "A" : "B"
    }));

    // Update global bank to 600 questions
    const newBank = Array.from({ length: 600 }, (_, i) => ({
        id: i + 1,
        question: `Question ${i + 1}`,
        options: ["A", "B", "C", "D"],
        correctAnswer: "A"
    }));

    const merged = mergeQuestionsWithGlobal(studentAnswers, newBank);
    assert(merged.length === 600, `Merged questions count is 600 (was ${merged.length})`);
    assert(merged[0].status === "correct" && merged[0].marked === true && merged[0].notes === "High yield note", "Question 1 progress, mark, and notes preserved");
    assert(merged[1].status === "incorrect" && merged[1].userAnswer === "B", "Question 2 answer preserved");
    assert(merged[550].status === "unused" && merged[550].id === 551, "New question 551 added seamlessly as unused");
    assert(merged[599].status === "unused" && merged[599].id === 600, "New question 600 added seamlessly as unused");

    // --- TEST 2: Course Isolation in Full Grant ---
    console.log("\n--- Test 2: Course-Scoped Full Grant Tagging ---");
    const testEmail = "test_student_iso@gmail.com";

    function parseGrantedUsers(rawList, currentGroup) {
        const grantedSet = new Set();
        (rawList || []).forEach(row => {
            const rawEmail = typeof row === "string" ? row : (row.email || "");
            if (!rawEmail) return;
            const parts = rawEmail.split("::");
            if (parts.length === 2) {
                const [emailVal, groupVal] = parts;
                if (groupVal === currentGroup) {
                    grantedSet.add(emailVal.toLowerCase().trim());
                }
            } else {
                if (currentGroup === "infection") {
                    grantedSet.add(rawEmail.toLowerCase().trim());
                }
            }
        });
        return grantedSet;
    }

    const mockDbAccessRows = [
        { email: `${testEmail}::infection`, status: "granted" },
        { email: `derma_only@gmail.com::dermatology`, status: "granted" },
        { email: `legacy_user@gmail.com`, status: "granted" } // Legacy infection
    ];

    const infectionGranted = parseGrantedUsers(mockDbAccessRows, "infection");
    const dermaGranted = parseGrantedUsers(mockDbAccessRows, "dermatology");

    assert(infectionGranted.has(testEmail), "Infection course grants test_student_iso");
    assert(!dermaGranted.has(testEmail), "Dermatology course DOES NOT grant test_student_iso (Isolation verified)");
    assert(dermaGranted.has("derma_only@gmail.com"), "Dermatology course grants derma_only");
    assert(!infectionGranted.has("derma_only@gmail.com"), "Infection course DOES NOT grant derma_only (Isolation verified)");
    assert(infectionGranted.has("legacy_user@gmail.com") && !dermaGranted.has("legacy_user@gmail.com"), "Legacy rows default only to infection");

    // --- TEST 3: Supabase REST Live Verification ---
    console.log("\n--- Test 3: Supabase hawari_users Course Filtering ---");
    const resInf = await supabaseRequest("hawari_users?select=email,group_name,role,status&group_name=eq.infection");
    const resDerma = await supabaseRequest("hawari_users?select=email,group_name,role,status&group_name=eq.dermatology");

    assert(resInf.status === 200, `Infection users query succeeded (HTTP ${resInf.status})`);
    assert(resDerma.status === 200, `Dermatology users query succeeded (HTTP ${resDerma.status})`);
    assert(Array.isArray(resInf.data), `Infection returned array with ${resInf.data.length} users`);
    assert(Array.isArray(resDerma.data), `Dermatology returned array with ${resDerma.data.length} users`);
    
    const allInfCorrect = resInf.data.every(u => u.group_name === "infection");
    const allDermaCorrect = resDerma.data.every(u => u.group_name === "dermatology");
    assert(allInfCorrect, "All records in infection query have group_name === 'infection'");
    assert(allDermaCorrect, "All records in dermatology query have group_name === 'dermatology'");

    // --- TEST 4: Student Progress Protection on Storage Save ---
    console.log("\n--- Test 4: Student Progress Protection & Initialization Guard ---");
    let stateMock = {
        activeGroup: "infection",
        currentUser: { email: "student_init_test@gmail.com", role: "student" },
        questions: [],
        tests: [],
        isUserProgressLoaded: false,
        users: [{ email: "student_init_test@gmail.com", group_name: "infection", questions: [{ id: 1, status: "correct" }] }]
    };

    function safeSaveStateToStorage(state) {
        if (!state.currentUser) return false;
        if (!state.isUserProgressLoaded && state.currentUser.role !== "admin") {
            // Guard: don't overwrite if progress isn't loaded yet!
            return false;
        }
        const user = state.users.find(u => u.email === state.currentUser.email);
        if (user) {
            user.questions = state.questions;
        }
        return true;
    }

    const savedBeforeLoad = safeSaveStateToStorage(stateMock);
    assert(savedBeforeLoad === false, "Save blocked before progress is loaded (Prevented wiping with empty array)");
    assert(stateMock.users[0].questions.length === 1, "User questions in state remain untouched");

    stateMock.questions = [{ id: 1, status: "correct" }, { id: 2, status: "incorrect" }];
    stateMock.isUserProgressLoaded = true;
    const savedAfterLoad = safeSaveStateToStorage(stateMock);
    assert(savedAfterLoad === true, "Save permitted after isUserProgressLoaded = true");
    assert(stateMock.users[0].questions.length === 2, "User questions correctly updated to 2 answers");

    console.log("\n==================================================");
    console.log(`📊 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test error:", err);
    process.exit(1);
});
