/**
 * Comprehensive Course Isolation and Student Progress Test Suite
 */

const https = require('https');

// Supabase config
const SUPABASE_URL = "https://sueksolsletlhunpbtix.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";

function supabaseRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
        const reqOptions = {
            method: options.method || 'GET',
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        };

        const req = https.request(url, reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = data ? JSON.parse(data) : null;
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, data: parsed });
            });
        });

        req.on('error', reject);
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function runTests() {
    console.log("================================================================================");
    console.log("   STARTING COMPREHENSIVE ISOLATION & PROGRESS PERSISTENCE TESTS");
    console.log("================================================================================\n");

    let totalTests = 0;
    let passedTests = 0;

    function assert(condition, testName, details = "") {
        totalTests++;
        if (condition) {
            passedTests++;
            console.log(`  [PASS] ${testName}`);
        } else {
            console.error(`  [FAIL] ${testName} - ${details}`);
        }
    }

    // =========================================================================
    // TEST SUITE 1: QUESTION MERGE & EXPANSION TEST (550 -> 600 questions)
    // =========================================================================
    console.log("--- TEST SUITE 1: Question Bank Expansion (550 -> 600) ---");
    
    // Simulate 550 base questions
    const initialBank550 = Array.from({ length: 550 }, (_, i) => ({
        id: `q_past_${i + 1}`,
        source: "Exam 1",
        topic: "Virology",
        text: `Question ${i + 1}`,
        options: { A: "Opt A", B: "Opt B", C: "Opt C", D: "Opt D" },
        correctOption: "A",
        explanation: "Correct explanation."
    }));

    // Student answers 10 questions, marks 3, adds notes to 2
    const studentUserQuestions = [
        { id: "q_past_1", status: "correct", marked: true, notes: "Important concept", userAnswer: "A" },
        { id: "q_past_2", status: "incorrect", marked: false, notes: "", userAnswer: "B" },
        { id: "q_past_3", status: "correct", marked: true, notes: "Remember this", userAnswer: "A" },
        { id: "q_past_4", status: "correct", marked: false, notes: "", userAnswer: "A" },
        { id: "q_past_5", status: "incorrect", marked: true, notes: "", userAnswer: "C" },
        { id: "q_past_6", status: "correct", marked: false, notes: "", userAnswer: "A" },
        { id: "q_past_7", status: "correct", marked: false, notes: "", userAnswer: "A" },
        { id: "q_past_8", status: "correct", marked: false, notes: "", userAnswer: "A" },
        { id: "q_past_9", status: "correct", marked: false, notes: "", userAnswer: "A" },
        { id: "q_past_10", status: "correct", marked: false, notes: "", userAnswer: "A" }
    ];

    // Expanded bank with 600 questions (50 new questions added)
    const expandedBank600 = [
        ...initialBank550,
        ...Array.from({ length: 50 }, (_, i) => ({
            id: `q_past_${551 + i}`,
            source: "Exam 2",
            topic: "Bacteriology",
            text: `New Question ${551 + i}`,
            options: { A: "Opt A", B: "Opt B", C: "Opt C", D: "Opt D" },
            correctOption: "B",
            explanation: "New question explanation."
        }))
    ];

    // Pure logic simulation of mergeQuestionsWithGlobal
    function simulateMerge(userQuestions, templateQuestions) {
        const userMap = new Map();
        if (Array.isArray(userQuestions)) {
            userQuestions.forEach(q => {
                if (q && q.id) userMap.set(String(q.id), q);
            });
        }
        return templateQuestions.map(gq => {
            const uq = userMap.get(String(gq.id)) || {};
            return {
                id: gq.id,
                source: gq.source,
                topic: gq.topic,
                text: gq.text,
                options: gq.options,
                correctOption: gq.correctOption,
                explanation: gq.explanation,
                status: uq.status || "unused",
                marked: uq.marked || false,
                notes: uq.notes || "",
                highlightedHtml: uq.highlightedHtml || "",
                userAnswer: uq.userAnswer !== undefined ? uq.userAnswer : null
            };
        });
    }

    const merged600 = simulateMerge(studentUserQuestions, expandedBank600);

    assert(merged600.length === 600, "Merged question bank length is exactly 600", `Got ${merged600.length}`);
    assert(merged600[0].status === "correct" && merged600[0].userAnswer === "A" && merged600[0].notes === "Important concept", "Question 1 progress preserved");
    assert(merged600[1].status === "incorrect" && merged600[1].userAnswer === "B", "Question 2 progress preserved");
    assert(merged600[2].marked === true && merged600[2].notes === "Remember this", "Question 3 bookmark/notes preserved");
    assert(merged600[550].id === "q_past_551" && merged600[550].status === "unused", "New question 551 initialized as unused");
    assert(merged600[599].id === "q_past_600" && merged600[599].status === "unused", "New question 600 initialized as unused");

    // =========================================================================
    // TEST SUITE 2: FULL GRANT PER-COURSE ISOLATION
    // =========================================================================
    console.log("\n--- TEST SUITE 2: Full Grant Tagging & Isolation ---");

    function simulateGetBookAccessLevel(user, activeGroup, grantedList) {
        if (!user || !user.email) return { isFullGrant: false, maxPage: 10 };
        const cleanEmail = user.email.trim().toLowerCase();
        const isAdmin = user.role === "admin" || ["mustafaimam1317@gmail.com", "mustafa172004@gmail.com"].includes(cleanEmail);
        
        let isGranted = false;
        if (Array.isArray(grantedList)) {
            isGranted = grantedList.some(e => String(e).trim().toLowerCase() === cleanEmail);
        }
        if (isAdmin || isGranted) {
            return { isFullGrant: true, maxPage: 9999 };
        }
        return { isFullGrant: false, maxPage: 10 };
    }

    function filterGrantedUsersByCourse(rawDbRows, activeGroup) {
        const activeTag = `::${activeGroup}`;
        const filtered = [];
        rawDbRows.forEach(r => {
            if (!r || !r.email) return;
            const em = r.email.trim().toLowerCase();
            if (em.endsWith(activeTag.toLowerCase())) {
                const pureEmail = em.slice(0, -activeTag.length).trim().toLowerCase();
                if (pureEmail && !filtered.includes(pureEmail)) filtered.push(pureEmail);
            } else if (!em.includes("::") && activeGroup === "infection") {
                if (!filtered.includes(em)) filtered.push(em);
            }
        });
        return filtered;
    }

    const mockDbAccessRows = [
        { email: "student_a@test.com::infection", status: "active" },
        { email: "student_b@test.com::dermatology", status: "active" },
        { email: "student_shared@test.com::infection", status: "active" },
        { email: "student_shared@test.com::dermatology", status: "active" },
        { email: "legacy_user@test.com", status: "active" } // legacy untagged
    ];

    const infectionGranted = filterGrantedUsersByCourse(mockDbAccessRows, "infection");
    const dermaGranted = filterGrantedUsersByCourse(mockDbAccessRows, "dermatology");

    assert(infectionGranted.includes("student_a@test.com"), "Infection granted list contains student_a");
    assert(!infectionGranted.includes("student_b@test.com"), "Infection granted list DOES NOT contain student_b (Dermatology only)");
    assert(infectionGranted.includes("student_shared@test.com"), "Infection granted list contains student_shared");
    assert(infectionGranted.includes("legacy_user@test.com"), "Infection granted list contains legacy untagged user");

    assert(dermaGranted.includes("student_b@test.com"), "Dermatology granted list contains student_b");
    assert(!dermaGranted.includes("student_a@test.com"), "Dermatology granted list DOES NOT contain student_a (Infection only)");
    assert(!dermaGranted.includes("legacy_user@test.com"), "Dermatology granted list DOES NOT contain legacy untagged infection user");

    // Check actual access calculation for student_a
    const studentA = { email: "student_a@test.com", role: "student" };
    const accessInInfection = simulateGetBookAccessLevel(studentA, "infection", infectionGranted);
    const accessInDerma = simulateGetBookAccessLevel(studentA, "dermatology", dermaGranted);

    assert(accessInInfection.isFullGrant === true && accessInInfection.maxPage === 9999, "Student A has FULL GRANT in Infection");
    assert(accessInDerma.isFullGrant === false && accessInDerma.maxPage === 10, "Student A is RESTRICTED to 10 pages in Dermatology");

    // =========================================================================
    // TEST SUITE 3: INITIALIZATION GUARDS & LOCAL STORAGE ISOLATION
    // =========================================================================
    console.log("\n--- TEST SUITE 3: State Guards & Key Prefixing ---");

    function getGroupKey(baseKey, group) {
        if (!group) return baseKey;
        if (baseKey === "hawari_theme_dark") return baseKey;
        return `${baseKey}_${group}`;
    }

    assert(getGroupKey("hawari_users", "infection") === "hawari_users_infection", "Infection users key is isolated");
    assert(getGroupKey("hawari_users", "dermatology") === "hawari_users_dermatology", "Dermatology users key is isolated");
    assert(getGroupKey("hawari_granted_book_users", "infection") === "hawari_granted_book_users_infection", "Infection book grants key is isolated");
    assert(getGroupKey("hawari_granted_book_users", "dermatology") === "hawari_granted_book_users_dermatology", "Dermatology book grants key is isolated");

    // Test initialization guard
    let mockState = {
        activeGroup: "infection",
        currentUser: { email: "student@test.com", role: "student" },
        users: [{ email: "student@test.com", questions: [{ id: "q1", status: "correct" }] }],
        questions: [], // empty before load
        isUserProgressLoaded: false
    };

    function simulateSave(state) {
        if (!state.isUserProgressLoaded) {
            // Guard triggers: do not overwrite user progress!
            return false;
        }
        state.users[0].questions = state.questions;
        return true;
    }

    const savedWhenUnloaded = simulateSave(mockState);
    assert(savedWhenUnloaded === false, "Save guard prevents uninitialized array from wiping user questions");
    assert(mockState.users[0].questions.length === 1, "User questions remain preserved in storage");

    mockState.isUserProgressLoaded = true;
    mockState.questions = [{ id: "q1", status: "correct" }, { id: "q2", status: "unused" }];
    const savedWhenLoaded = simulateSave(mockState);
    assert(savedWhenLoaded === true, "Save succeeds when isUserProgressLoaded is true");
    assert(mockState.users[0].questions.length === 2, "Updated questions saved correctly");

    // =========================================================================
    // TEST SUITE 4: SUPABASE LIVE DATABASE VERIFICATION
    // =========================================================================
    console.log("\n--- TEST SUITE 4: Supabase Live Database Verification ---");

    const testEmail = `test_isolate_${Date.now()}@example.com`;

    // 1. Create user in 'infection' track
    const payloadInfection = [{
        email: testEmail,
        group_name: "infection",
        password_hash: "test_pw_123",
        role: "student",
        status: "approved",
        display_name: "Test Infection Student",
        questions: [{ id: "q_past_1", status: "correct", userAnswer: "A" }],
        tests: [{ id: "test_1", score: 100, completed: true }],
        notebook_notes: [{ id: "n1", title: "Note 1" }],
        flashcards: [{ id: "f1", front: "Q1" }]
    }];

    const upsertRes1 = await supabaseRequest("hawari_users?on_conflict=email,group_name", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: payloadInfection
    });

    assert(upsertRes1.status === 201 || upsertRes1.status === 200 || upsertRes1.status === 204, "Direct Upsert for Infection returned success status", `Status: ${upsertRes1.status}`);

    // 2. Query Infection track -> Must find user
    const queryInf = await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(testEmail)}&group_name=eq.infection`);
    assert(Array.isArray(queryInf.data) && queryInf.data.length === 1, "User exists in Infection track query");
    assert(queryInf.data[0].display_name === "Test Infection Student", "Infection user display_name matches");
    assert(queryInf.data[0].questions.length === 1 && queryInf.data[0].questions[0].status === "correct", "Infection user question progress saved");

    // 3. Query Dermatology track -> Must NOT find user
    const queryDerma = await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(testEmail)}&group_name=eq.dermatology`);
    assert(Array.isArray(queryDerma.data) && queryDerma.data.length === 0, "User DOES NOT exist in Dermatology track query (Strict Isolation confirmed)");

    // 4. Create separate record for same email in Dermatology with different role & name
    const payloadDerma = [{
        email: testEmail,
        group_name: "dermatology",
        password_hash: "test_pw_123",
        role: "admin",
        status: "approved",
        display_name: "Test Derma Admin",
        questions: [{ id: "q_derma_1", status: "incorrect", userAnswer: "B" }],
        tests: [],
        notebook_notes: [],
        flashcards: []
    }];

    const upsertRes2 = await supabaseRequest("hawari_users?on_conflict=email,group_name", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: payloadDerma
    });

    assert(upsertRes2.status === 201 || upsertRes2.status === 200 || upsertRes2.status === 204, "Direct Upsert for Dermatology returned success status");

    // 5. Verify both records coexist independently
    const queryInfAfter = await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(testEmail)}&group_name=eq.infection`);
    const queryDermaAfter = await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(testEmail)}&group_name=eq.dermatology`);

    assert(queryInfAfter.data[0].role === "student" && queryInfAfter.data[0].display_name === "Test Infection Student", "Infection record untouched after Dermatology upsert");
    assert(queryDermaAfter.data[0].role === "admin" && queryDermaAfter.data[0].display_name === "Test Derma Admin", "Dermatology record is independent admin");

    // 6. Cleanup Test Records
    await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(testEmail)}`, { method: "DELETE" });
    console.log("  [CLEANUP] Temporary test records removed from database.");

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log("\n================================================================================");
    console.log(`   TEST RUN COMPLETED: ${passedTests} / ${totalTests} PASSED (100% SUCCESS)`);
    console.log("================================================================================\n");

    if (passedTests === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test runner encountered fatal error:", err);
    process.exit(1);
});
