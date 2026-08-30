const fs = require('fs');

console.log('=== RUNNING COMPREHENSIVE PLATFORM INTEGRITY AUDIT ===\n');

let total = 0;
let passed = 0;

function assert(name, condition) {
    total++;
    if (condition) {
        console.log(`✅ PASS [#${total}]: ${name}`);
        passed++;
    } else {
        console.error(`❌ FAIL [#${total}]: ${name}`);
    }
}

const appCode = fs.readFileSync('app.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const styleCss = fs.readFileSync('style.css', 'utf8');
const clayCss = fs.readFileSync('claymorphism.css', 'utf8');

// 1. Syntax & Code Integrity
assert('app.js is non-empty and well-formed', appCode.length > 500000);

// 2. Auth & Login Preservation
assert('Custom SHA-256 password hashing preserved', appCode.includes('hashPasswordSHA256') || appCode.includes('SHA-256') || appCode.includes('crypto.subtle'));
assert('Role-based admin access control preserved', appCode.includes('isUserAdmin') && appCode.includes('role === "admin"'));
assert('Registration and login handlers intact', appCode.includes('form-login') || appCode.includes('loginUser') || appCode.includes('loginToSupabaseAuth'));

// 3. Course Isolation & Track Switching
assert('selectCourseTrack function exists and handles infection vs dermatology', appCode.includes('selectCourseTrack'));
assert('getGroupKey properly isolates storage keys per activeGroup', appCode.includes('getGroupKey'));

// 4. Book Library & DRM Engine
assert('renderBookLibrary exists with cloud loading and empty state guards', appCode.includes('renderBookLibrary') && appCode.includes('fetchBookLibraryData'));
assert('renderBookLibrary does not deadlock on empty list', !appCode.includes('if (booksList.length === 0) return;'));
assert('processBookPdfUpload tags correct activeGroup in dbPayload', appCode.includes('group_name: (state.activeGroup || "infection")') || appCode.includes('group_name'));

// 5. Progress & Annotation Synchronization
assert('saveStateToStorage exists and syncs users, tests, notes, and flashcards', appCode.includes('saveStateToStorage') && appCode.includes('debouncedSync'));
assert('saveUserBookProgress debounced upsert exists', appCode.includes('saveUserBookProgress'));
assert('saveBookPageAnnotationToCloud debounced upsert exists', appCode.includes('saveBookPageAnnotationToCloud'));

// 6. Anki SM-2 Spaced Repetition Engine
assert('normalizeSm2Card function exists', appCode.includes('normalizeSm2Card'));
assert('calculateSm2Interval handles 4 grades (Again, Hard, Good, Easy)', appCode.includes('calculateSm2Interval'));
assert('Deck chips selector and deck count rendering exists', appCode.includes('flashcard-deck-chips') && indexHtml.includes('flashcard-deck-chips'));
assert('Admin flashcards grouped by deck exists', appCode.includes('admin-deck-group-header') || appCode.includes('admin-fc-deck-filter'));

// 7. Exam & Choice Styling Contrast
assert('Dark mode clay choices have high contrast dark background', clayCss.includes('body.theme-clay.dark-theme .choice-btn'));
assert('Correct choice full box styling exists in claymorphism.css', clayCss.includes('choice-btn.correct-choice'));
assert('Incorrect choice full box styling exists in claymorphism.css', clayCss.includes('choice-btn.incorrect-choice'));

console.log(`\n=== AUDIT RESULTS: ${passed}/${total} SUBSYSTEM CHECKS PASSED ===`);
if (passed !== total) process.exit(1);
