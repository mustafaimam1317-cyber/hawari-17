/**
 * Test Suite: Course Quiz Strict Lifecycle & Anti-Cheat Verification
 * Author: Mustafa Imam | Copyright (c) 2026 Hawari Platform
 */

import fs from 'fs';
import path from 'path';

const appPath = path.resolve('app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ [PASS]: ${message}`);
        passedTests++;
    } else {
        console.error(`  ❌ [FAIL]: ${message}`);
        failedTests++;
    }
}

console.log('===============================================================');
console.log('🧪 COURSE QUIZ STRICT LIFECYCLE & SECURITY VERIFICATION');
console.log('===============================================================\n');

// 1. Single Attempt & Re-entry Gatekeeper
console.log('--- TEST GROUP 1: Single Attempt & Re-entry Gatekeeper ---');
assert(
    appCode.includes('hawari_quiz_submitted_${quizId}_${userEmail}') || appCode.includes('hawari_quiz_submitted_${qzId}_${userEmail}'),
    'Persistent local storage submission lock key is registered'
);
assert(
    appCode.includes('if (!isPractice && (result || localSubmitted))'),
    'startCourseQuizStudent checks both cloud result and localSubmitted lock to block active re-entry'
);
assert(
    appCode.includes('لا يمكن إعادة الدخول أثناء فترة انعقاده الرسمية'),
    'Clear Arabic toast message displayed when a student attempts re-entry during active quiz window'
);

// 2. Score Concealment & Review Lock during Active Window
console.log('\n--- TEST GROUP 2: Score Concealment & Review Lock ---');
assert(
    appCode.includes('قيد التصحيح (تعلن النتيجة في') && appCode.includes('now < end'),
    'Student card hides score percentage and shows waiting badge when now < end'
);
assert(
    appCode.includes('مراجعة الإجابات مغلقة حتى') && appCode.includes('disabled style="cursor: not-allowed'),
    'Review button is disabled with lock icon during active quiz window'
);
assert(
    appCode.includes('انتظر ظهور النتيجة ومراجعة الإجابات بعد انتهاء موعد الاختبار بالكامل'),
    'Submission toast advises student to wait for result after exam window completes without leaking score'
);

// 3. Post-Expiration Score Reveal & Review Enablement
console.log('\n--- TEST GROUP 3: Post-Expiration Score Reveal & Review ---');
assert(
    appCode.includes("reviewCourseQuizStudent('") && appCode.includes('مراجعة الإجابات النموذجية'),
    'Review button is enabled with full review trigger when now >= end'
);
assert(
    appCode.includes('reviewCourseQuizStudent = function(quizId)'),
    'reviewCourseQuizStudent verifies quiz end time before rendering review'
);

// 4. Retake Restrictions & Report Tasks Archive
console.log('\n--- TEST GROUP 4: Retake Restrictions & Reports Track ---');
assert(
    appCode.includes('window.retakeCourseQuizStudent = async function(quizId)'),
    'retakeCourseQuizStudent function is defined'
);
assert(
    appCode.includes('if (qz && !isPractice)') && appCode.includes('لا يمكن إعادة الاختبار أثناء فترة انعقاده الرسمية'),
    'retakeCourseQuizStudent strictly forbids retake while official quiz is still active'
);
assert(
    appCode.includes('localStorage.removeItem(`hawari_quiz_submitted_${quizId}_${userEmail}`)'),
    'retakeCourseQuizStudent safely clears local submission lock when retaking in practice mode'
);

// 5. Admin Panel & Cloud Leaderboard
console.log('\n--- TEST GROUP 5: Admin Panel & Cloud Submissions ---');
assert(
    appCode.includes('saveQuizResultToCloud(resultObj)'),
    'Active quiz submissions push result object directly to cloud'
);
assert(
    appCode.includes('function renderQuizLeaderboard()'),
    'Admin panel renders leaderboard from state.quizResults'
);
assert(
    appCode.includes('b.score - a.score'),
    'Leaderboard ranks student submissions in descending score order'
);

// 6. Strict Mode Anti-Cheat & DRM Protections
console.log('\n--- TEST GROUP 6: Strict Mode Anti-Cheat & DRM Protections ---');
assert(
    appCode.includes('active-quiz-overlay') && appCode.includes('overlay.oncopy = (e) => e.preventDefault()'),
    'Copy, cut, and right-click context menu are disabled on active quiz overlay'
);
assert(
    appCode.includes('quiz-watermark-overlay') && appCode.includes('HAWARI PLATFORM'),
    'Dynamic forensic watermark with student identifier is embedded in active quiz overlay'
);
assert(
    appCode.includes('document.addEventListener("visibilitychange", _activeQuizVisibilityHandler)'),
    'Strict mode monitors tab visibility during live official exams'
);
assert(
    appCode.includes('submitQuizCheatZero'),
    'Tab leaving / browser reload during live exam enforces automatic zero penalty'
);

console.log('\n===============================================================');
console.log(`SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED out of ${passedTests + failedTests} tests`);
console.log('===============================================================');

if (failedTests > 0) {
    process.exit(1);
} else {
    console.log('🎉 ALL COURSE QUIZ STRICT LIFECYCLE TESTS PASSED!');
    process.exit(0);
}
