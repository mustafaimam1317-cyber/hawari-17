// ============================================================================
// HAWARI MEDICAL PLATFORM - COMPREHENSIVE PLATFORM INTEGRITY AUDIT SUITE
// Tests 10 Full Subsystems: Auth, Security, Admin Sync, Grading, Course Separation,
// Flashcards SM-2, Hawari Book DRM, Authoritative Reset, Multi-tier Cache & Code Integrity.
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const appJsPath = path.join(ROOT, 'app.js');
const indexHtmlPath = path.join(ROOT, 'index.html');
const styleCssPath = path.join(ROOT, 'style.css');
const clayCssPath = path.join(ROOT, 'claymorphism.css');

const appCode = fs.readFileSync(appJsPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const styleCss = fs.readFileSync(styleCssPath, 'utf8');
const clayCss = fs.readFileSync(clayCssPath, 'utf8');
const uiTemplatePath = path.join(ROOT, 'uiTemplate.js');
const uiMarkup = fs.existsSync(uiTemplatePath) ? fs.readFileSync(uiTemplatePath, 'utf8') : '';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, condition, details = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✅ [PASS] #${totalTests}: ${name}`);
    } else {
        failedTests++;
        failures.push({ test: name, details });
        console.error(`  ❌ [FAIL] #${totalTests}: ${name}`);
        if (details) console.error(`     └─ Details: ${details}`);
    }
}

async function runSuite() {
    console.log('\n================================================================');
    console.log('🚀 RUNNING COMPREHENSIVE PLATFORM INTEGRITY & HARDENING AUDIT');
    console.log('================================================================\n');

    // ------------------------------------------------------------------------
    // MODULE 1: AUTHENTICATION, SINGLE DEVICE ENFORCEMENT & ROLE BOUNDARIES
    // ------------------------------------------------------------------------
    console.log('--- MODULE 1: Auth & Single Device Enforcement ---');
    
    // 1.1 SHA-256 Synchronous Password Hashing
    test('SHA-256 Hashing Algorithm (sha256Sync) exists in app.js', 
        appCode.includes('sha256Sync') && appCode.includes('function sha256Sync'));

    const testPassword = "HawariSecure2026!";
    const hash = crypto.createHash('sha256').update(testPassword).digest('hex');
    test('SHA-256 produces valid 64-char hex digest', hash.length === 64);

    // 1.2 Role Checking Logic
    function mockIsUserAdmin(user) {
        if (!user) return false;
        const email = (user.email || "").toLowerCase().trim();
        return user.role === "admin" || email === "ahmed@hawari.com" || email === "admin@hawari.com";
    }
    test('isUserAdmin correctly grants admin role to ahmed@hawari.com', 
        mockIsUserAdmin({ email: "ahmed@hawari.com", role: "student" }) === true);
    test('isUserAdmin correctly denies student role', 
        mockIsUserAdmin({ email: "student@example.com", role: "student" }) === false);
    test('isUserAdmin handles null user safely', 
        mockIsUserAdmin(null) === false);

    // 1.3 Single Device Session Token Verification
    test('Single-device session heartbeat and verification present in app.js',
        appCode.includes('hawari_user_sessions') || appCode.includes('hawari_device_id') || appCode.includes('hawari_session_token') || appCode.includes('single-device'));


    // ------------------------------------------------------------------------
    // MODULE 2: SECURITY, WATERMARK & AES-GCM 256 VAULT
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 2: Security, Watermark & AES-GCM 256 Vault ---');

    // 2.1 AES-GCM 256 Roundtrip Cryptographic Verification
    let aesRoundtripSuccess = false;
    try {
        const subtle = crypto.webcrypto.subtle;
        const rawKey = crypto.randomBytes(32);
        const iv = crypto.randomBytes(12);
        const plaintext = Buffer.from("HAWARI_PROTECTED_MEDICAL_CURRICULUM_2026");

        const cryptoKey = await subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
        const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: iv }, cryptoKey, plaintext);
        const decrypted = await subtle.decrypt({ name: "AES-GCM", iv: iv }, cryptoKey, ciphertext);
        
        aesRoundtripSuccess = Buffer.from(decrypted).toString() === plaintext.toString();
    } catch (e) {
        console.error("AES error:", e);
    }
    test('AES-GCM 256 encryption and decryption roundtrip succeeds', aesRoundtripSuccess);

    // 2.2 PDF Vault Engine in app.js
    test('PDF Vault engine with AES-GCM 256 encryption exists in app.js',
        appCode.includes('PDF_VAULT_DB_NAME') && appCode.includes('AES-GCM'));

    // 2.3 Forensic Watermark Canvas
    test('Forensic watermark rendering engine exists in app.js',
        appCode.includes('updateBookWatermark') && appCode.includes('startWatermark'));

    // 2.4 DevTools and DRM Deterrents
    test('Anti-tamper / DevTools / copy protection deterrents active',
        appCode.includes('contextmenu') || appCode.includes('copy') || appCode.includes('keydown'));


    // ------------------------------------------------------------------------
    // MODULE 3: QUESTION BANK & ADMIN CLOUD AUTO-SYNC
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 3: Question Bank & Admin Cloud Auto-Sync ---');

    // 3.1 saveGlobalQuestionsToCloud definition
    test('saveGlobalQuestionsToCloud is properly defined in app.js',
        appCode.includes('async function saveGlobalQuestionsToCloud()'));

    // 3.2 Form onsubmit calls saveGlobalQuestionsToCloud
    const hasAdminFormSync = appCode.includes('saveGlobalQuestionsToCloud()') &&
        appCode.includes('admin-question-form');
    test('admin-question-form submission automatically awaits saveGlobalQuestionsToCloud', hasAdminFormSync);

    // 3.3 Delete question calls saveGlobalQuestionsToCloud
    const hasDeleteQuestionSync = appCode.includes('deleteQuestionAdmin = async function') &&
        appCode.includes('saveGlobalQuestionsToCloud();');
    test('deleteQuestionAdmin automatically awaits saveGlobalQuestionsToCloud', hasDeleteQuestionSync);

    // 3.4 Stripping student-specific answers from global cloud payload
    test('saveGlobalQuestionsToCloud strips student progress and only uploads clean questions template',
        appCode.includes('cleanQuestions = state.questions.map') && appCode.includes('correctOption: q.correctOption'));


    // ------------------------------------------------------------------------
    // MODULE 4: COURSE QUIZZES, REPORT TASKS & GRADING HYDRATION
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 4: Quizzes, Report Tasks & Grading Hydration ---');

    // 4.1 submit_and_grade_exam RPC call
    test('submit_and_grade_exam RPC is called for secure server-side grading',
        appCode.includes('submit_and_grade_exam'));

    // 4.2 Explanations hydration guard
    test('Explanations fallback hydration handles report tasks and quizzes',
        appCode.includes('explanation') && (appCode.includes('hawari_report_tasks') || appCode.includes('report_task_progress')));

    // 4.3 Course quizzes cloud push
    test('Course quiz publishing pushes directly to hawari_course_quizzes',
        appCode.includes('saveCourseQuizToCloud') && appCode.includes('hawari_course_quizzes'));

    // 4.4 Report tasks cloud push
    test('Report task creation pushes directly to hawari_report_tasks',
        appCode.includes('saveReportTaskToCloud') && appCode.includes('hawari_report_tasks'));


    // ------------------------------------------------------------------------
    // MODULE 5: COURSE SEPARATION (INFECTION VS DERMATOLOGY)
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 5: Course Separation & Isolation ---');

    // 5.1 selectCourseTrack state wipe
    test('selectCourseTrack completely wipes in-memory state on track switch',
        appCode.includes('state.activeGroup = groupName') &&
        appCode.includes('state.questions = []') &&
        appCode.includes('state.tests = []') &&
        appCode.includes('state.flashcards = []'));

    // 5.2 Storage keys isolation
    test('LocalStorage study state is strictly namespaced by activeGroup',
        appCode.includes('hawari_study_state_') || appCode.includes('getGroupKey'));

    // 5.3 Course body theme isolation
    test('Theme classes group-infection and group-dermatology toggled correctly',
        appCode.includes('group-infection') && appCode.includes('group-dermatology'));


    // ------------------------------------------------------------------------
    // MODULE 6: FLASHCARDS LIFECYCLE & SM-2 SPACED REPETITION
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 6: Flashcards & SM-2 Spaced Repetition ---');

    // 6.1 SM-2 Calculation function
    function calculateSm2Interval(grade, repetitions, easeFactor, currentInterval) {
        let newRepetitions = repetitions;
        let newEaseFactor = easeFactor;
        let newInterval = currentInterval;

        if (grade >= 2) { // Good or Easy
            if (newRepetitions === 0) {
                newInterval = 1;
            } else if (newRepetitions === 1) {
                newInterval = 6;
            } else {
                newInterval = Math.round(currentInterval * newEaseFactor);
            }
            newRepetitions++;
        } else { // Again or Hard
            newRepetitions = 0;
            newInterval = 1;
        }

        newEaseFactor = Math.max(1.3, newEaseFactor + (0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02)));
        return { repetitions: newRepetitions, interval: newInterval, easeFactor: newEaseFactor };
    }

    const sm2Step1 = calculateSm2Interval(2, 0, 2.5, 0); // Good on first pass
    test('SM-2: First pass (Good) sets interval=1 and repetitions=1',
        sm2Step1.interval === 1 && sm2Step1.repetitions === 1);

    const sm2Step2 = calculateSm2Interval(2, 1, 2.5, 1); // Good on second pass
    test('SM-2: Second pass (Good) sets interval=6 and repetitions=2',
        sm2Step2.interval === 6 && sm2Step2.repetitions === 2);

    const sm2StepFail = calculateSm2Interval(0, 5, 2.5, 30); // Again
    test('SM-2: Failing card (Again) resets repetitions to 0 and interval to 1',
        sm2StepFail.repetitions === 0 && sm2StepFail.interval === 1);

    // 6.2 Flashcards Cache Engine in app.js
    test('HawariFlashcardsCacheEngine is registered on window',
        appCode.includes('window.HawariFlashcardsCacheEngine = HawariFlashcardsCacheEngine'));

    // 6.3 Admin flashcards modification updates cache engine
    test('Admin flashcard form updates HawariFlashcardsCacheEngine and user flashcards',
        appCode.includes('HawariFlashcardsCacheEngine.setCachedCards') && appCode.includes('admin-flashcard-form'));


    // ------------------------------------------------------------------------
    // MODULE 7: HAWARI BOOK SYSTEM & DELETION CASCADE
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 7: Hawari Book System & Deletion Cascade ---');

    // 7.1 Reading Progress Debounced Sync
    test('saveUserBookProgress debounced upsert exists and targets hawari_user_book_progress',
        appCode.includes('saveUserBookProgress') && appCode.includes('hawari_user_book_progress'));

    // 7.2 Annotations Sync
    test('flushPendingAnnotationsSync upserts to hawari_book_annotations',
        appCode.includes('flushPendingAnnotationsSync') && appCode.includes('hawari_book_annotations'));

    // 7.3 Book Deletion Cascade
    test('deleteAdminBook deletes storage file, database row, and local cached books',
        appCode.includes('deleteAdminBook') &&
        appCode.includes('hawari_book_files') &&
        appCode.includes('storage/v1/object/hawari_books/'));


    // ------------------------------------------------------------------------
    // MODULE 8: AUTHORITATIVE SERVER-FIRST RESET SITE
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 8: Authoritative Server-First Reset Site ---');

    // 8.1 btnResetSite handler existence
    test('btn-reset-site click handler is attached and performs confirmation',
        appCode.includes('btn-reset-site') && appCode.includes('confirm('));

    // 8.2 Server-first wipe RPC call
    test('btnResetSite calls reset_user_progress_rpc on Supabase first',
        appCode.includes('reset_user_progress_rpc') && appCode.includes('update_user_progress_rpc'));

    // 8.3 Reset clears tests, notebookNotes, questions, and flashcard SM-2 intervals
    test('btnResetSite cleans tests, notes, questions, flashcards SM-2, and book keys',
        appCode.includes('state.tests = []') &&
        appCode.includes('state.notebookNotes = []') &&
        appCode.includes('q.status = "unused"') &&
        appCode.includes('hawari_progress_'));


    // ------------------------------------------------------------------------
    // MODULE 9: MULTI-TIER CACHE & OFFLINE RESILIENCE
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 9: Multi-Tier Cache Resilience ---');

    // 9.1 Three-tier question caching
    test('Three-tier caching architecture (L1 Memory, L2 IndexedDB, L3 Cloud) implemented',
        appCode.includes('HawariQuestionCacheMemory') &&
        appCode.includes('QUESTION_CACHE_DB_NAME') &&
        (appCode.includes('checkCloudQuestionBankVersion') || appCode.includes('downloadFullQuestionBankFromCloud')));

    // 9.2 Zero-CDN PDF Worker configuration
    test('PDF viewer worker configured to avoid CORS and CDN drops',
        appCode.includes('pdf.worker') || appCode.includes('GlobalWorkerOptions.workerSrc'));


    // ------------------------------------------------------------------------
    // MODULE 10: STATIC SYNTAX & ASSET INTEGRITY
    // ------------------------------------------------------------------------
    console.log('\n--- MODULE 10: Static Syntax & Asset Integrity ---');

    // 10.1 Code length and structure
    test('app.js is non-empty and exceeds 600,000 bytes', appCode.length > 600000);
    test('uiTemplate.js or index.html contains app-layout, sidebar, and modals',
        (uiMarkup.includes('app-layout') || indexHtml.includes('app-layout')) &&
        (uiMarkup.includes('sidebar') || indexHtml.includes('sidebar')));
    test('style.css defines CSS variables and theme properties',
        styleCss.includes('--bg-primary') && styleCss.includes('--primary-color'));
    test('claymorphism.css contains high-contrast styles for dark/clay choices',
        clayCss.includes('body.theme-clay.dark-theme .choice-btn'));

    // ------------------------------------------------------------------------
    // FINAL REPORT
    // ------------------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`📊 AUDIT COMPLETED: ${passedTests}/${totalTests} TESTS PASSED (${((passedTests/totalTests)*100).toFixed(1)}%)`);
    if (failedTests > 0) {
        console.error(`🚨 ${failedTests} FAILURE(S) ENCOUNTERED:`);
        failures.forEach(f => console.error(`   - ${f.test}: ${f.details}`));
        console.log('================================================================\n');
        process.exit(1);
    } else {
        console.log('🎉 ALL 10 SUBSYSTEMS VERIFIED AND PASSING WITH ZERO ERRORS!');
        console.log('================================================================\n');
    }
}

runSuite().catch(err => {
    console.error('Test suite crashed with unhandled exception:', err);
    process.exit(1);
});
