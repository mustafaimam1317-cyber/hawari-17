/**
 * Test Suite: Verification of Championship League Fixes
 * 1. Student Tournament Discovery via Cloud Bridge
 * 2. Strict Schedule Gatekeeper (No Early Start)
 * 3. Autonomous Countdown Ticker (< 30s Freeze Fix)
 */

import assert from 'assert';
import {
    champState,
    loadActiveChampionship,
    enterChampionshipMatch,
    formatRemainingTime,
    startStudentMatchCountdownTicker,
    saveChampionshipToLocalCache,
    STORAGE_CHAMP_KEY
} from './championshipLeague.js';

console.log('--- STARTING CHAMPIONSHIP FIXES VERIFICATION ---');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✓ ${desc}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ ${desc}`);
        console.error(err);
        process.exitCode = 1;
    }
}

async function itAsync(desc, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✓ ${desc}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ ${desc}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// Global Mocks
const mockStorage = new Map();
globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear()
};

const domElements = new Map();
globalThis.document = {
    getElementById: (id) => domElements.get(id) || null,
    querySelector: () => null,
    addEventListener: () => {},
    dispatchEvent: () => {}
};
globalThis.window = globalThis;
globalThis.CustomEvent = class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } };
globalThis.dispatchEvent = () => {};
globalThis.addEventListener = () => {};

let lastToast = null;
globalThis.showToast = (title, message, type) => {
    lastToast = { title, message, type };
};

// ==========================================
// TEST SUITE 1: TOURNAMENT DISCOVERY
// ==========================================
console.log('\n[Suite 1] Tournament Discovery for Student Devices:');

await itAsync('loadActiveChampionship retrieves active tournament from cloud bridge when local cache is empty', async () => {
    localStorage.clear();
    champState.activeChampionship = null;
    champState.participants = [];
    champState.matches = [];

    const mockTournament = {
        id: 'champ_test_123',
        title: 'Hawari Grand Prix 2026',
        status: 'active',
        group_name: 'infection'
    };
    const mockMatches = [
        {
            id: 'm_1',
            match_order: 1,
            round_name: 'round_16',
            player1_id: 'p1',
            player2_id: 'p2',
            player1_info: { id: 'p1', email: 'ahmed@hawari.edu', student_name: 'أحمد' },
            player2_info: { id: 'p2', email: 'mohamed@hawari.edu', student_name: 'محمد' },
            scheduled_start: new Date(Date.now() + 3600000).toISOString(),
            status: 'scheduled'
        }
    ];
    const mockParticipants = [
        { id: 'p1', email: 'ahmed@hawari.edu', student_name: 'أحمد' },
        { id: 'p2', email: 'mohamed@hawari.edu', student_name: 'محمد' }
    ];

    const mockSupabaseRequest = async (path) => {
        if (path.includes('championships?')) {
            return []; // Native table empty
        }
        if (path.includes('hawari_course_quizzes?')) {
            return [{
                id: 'championship_active_infection',
                questions: {
                    championship: mockTournament,
                    participants: mockParticipants,
                    matches: mockMatches
                }
            }];
        }
        return [];
    };

    const loaded = await loadActiveChampionship(mockSupabaseRequest, { activeGroup: 'infection' });
    assert.strictEqual(loaded, true, 'loadActiveChampionship should return true when tournament is found in cloud');
    assert.strictEqual(champState.activeChampionship?.id, 'champ_test_123');
    assert.strictEqual(champState.activeChampionship?.status, 'active');
    assert.strictEqual(champState.matches.length, 1);
    assert.strictEqual(champState.participants.length, 2);

    // Verify it saved to localStorage for fast future loads
    const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_infection`);
    assert.ok(cached, 'Cache should be populated after cloud load');
    const parsed = JSON.parse(cached);
    assert.strictEqual(parsed.championship.title, 'Hawari Grand Prix 2026');
});

// ==========================================
// TEST SUITE 2: STRICT SCHEDULE GATEKEEPER
// ==========================================
console.log('\n[Suite 2] Strict Schedule Gatekeeper:');

it('Case A: Blocks match entry when scheduled start is 2 hours away (> 5 minutes)', () => {
    lastToast = null;
    const futureTime = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    champState.matches = [
        {
            id: 'match_future',
            match_order: 1,
            round_name: 'quarter',
            player1_id: 'p1',
            player2_id: 'p2',
            player1_info: { id: 'p1', email: 'student1@hawari.edu', student_name: 'طالب 1' },
            player2_info: { id: 'p2', email: 'student2@hawari.edu', student_name: 'طالب 2' },
            scheduled_start: futureTime,
            status: 'scheduled'
        }
    ];
    champState.participants = [
        { id: 'p1', email: 'student1@hawari.edu', student_name: 'طالب 1' },
        { id: 'p2', email: 'student2@hawari.edu', student_name: 'طالب 2' }
    ];

    globalThis.state = { currentUser: { email: 'student1@hawari.edu' } };
    globalThis.getActiveCurrentUser = () => ({ email: 'student1@hawari.edu' });

    champState.inMatch = false;
    enterChampionshipMatch('match_future', globalThis.showToast);

    assert.strictEqual(champState.inMatch, false, 'User must NOT enter match room when scheduled time is far away');
    assert.ok(lastToast, 'Toast must be triggered');
    assert.strictEqual(lastToast.title, 'الموعد الرسمي لم يحن بعد');
    assert.ok(lastToast.message.includes('تفتح غرفة الاستعداد قبل الموعد بـ 5 دقائق فقط'));
});

it('Case B: Permits entry to lobby when scheduled start is 3 minutes away (within 5-min prep window)', () => {
    lastToast = null;
    const prepTime = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    champState.matches = [
        {
            id: 'match_prep',
            match_order: 2,
            round_name: 'quarter',
            player1_id: 'p1',
            player2_id: 'p2',
            player1_info: { id: 'p1', email: 'student1@hawari.edu', student_name: 'طالب 1' },
            player2_info: { id: 'p2', email: 'student2@hawari.edu', student_name: 'طالب 2' },
            scheduled_start: prepTime,
            status: 'scheduled'
        }
    ];

    globalThis.state = { currentUser: { email: 'student1@hawari.edu' } };
    globalThis.getActiveCurrentUser = () => ({ email: 'student1@hawari.edu' });
    let arenaLaunched = false;
    globalThis.launchChampionshipArena = () => { arenaLaunched = true; };

    champState.inMatch = false;
    enterChampionshipMatch('match_prep', globalThis.showToast);

    assert.strictEqual(champState.inMatch, true, 'User should enter waiting room within 5-min prep window');
    assert.strictEqual(arenaLaunched, true, 'Waiting room arena should be launched');
});

it('Case C: startChampionshipMatchNow blocks starting questions if official time has not arrived', async () => {
    const { battleState, startChampionshipMatchNow } = await import('./battleRoom.js');
    lastToast = null;
    let broadcastSent = false;
    battleState.roomChannel = {
        presenceState: () => ({ 'key1': [{}], 'key2': [{}] }),
        send: async () => { broadcastSent = true; }
    };
    battleState.activeRoom = {
        championshipMatch: {
            id: 'm_future_block',
            scheduled_start: new Date(Date.now() + 600000).toISOString(), // 10 minutes in future
            player1_info: { email: 'student1@hawari.edu', student_name: 'طالب 1' },
            player2_info: { email: 'student2@hawari.edu', student_name: 'طالب 2' },
            match_meta: { p1_entered: true, p2_entered: true }
        }
    };

    globalThis.getActiveUser = () => ({ email: 'student1@hawari.edu' });
    globalThis.state = { currentUser: { email: 'student1@hawari.edu' } };

    startChampionshipMatchNow();

    assert.strictEqual(broadcastSent, false, 'START_COUNTDOWN broadcast must NOT be sent before official scheduled time');
    assert.ok(lastToast, 'Warning toast must be shown');
    assert.strictEqual(lastToast.title, 'الموعد الرسمي لم يحن بعد');
    assert.ok(lastToast.message.includes('لا يمكن بدء الأسئلة قبل حلول موعد المباراة الرسمي'));
});

it('Case D: startChampionshipMatchNow permits start once official scheduled time has arrived', async () => {
    const { battleState, startChampionshipMatchNow } = await import('./battleRoom.js');
    lastToast = null;
    let broadcastSent = false;
    let countdownHandled = false;
    battleState.roomChannel = {
        presenceState: () => ({ 'key1': [{}], 'key2': [{}] }),
        send: async () => { broadcastSent = true; }
    };
    battleState.activeRoom = {
        championshipMatch: {
            id: 'm_ready_start',
            scheduled_start: new Date(Date.now() - 5000).toISOString(), // 5 seconds in the past (time reached)
            player1_info: { email: 'student1@hawari.edu', student_name: 'طالب 1' },
            player2_info: { email: 'student2@hawari.edu', student_name: 'طالب 2' },
            match_meta: { p1_entered: true, p2_entered: true }
        }
    };
    battleState.questions = [{ id: 1, text: 'Q1' }];

    globalThis.getActiveUser = () => ({ email: 'student1@hawari.edu' });
    globalThis.state = { currentUser: { email: 'student1@hawari.edu' } };

    startChampionshipMatchNow();

    assert.strictEqual(broadcastSent, true, 'START_COUNTDOWN broadcast must be sent when official time is reached');
});

// ==========================================
// TEST SUITE 3: COUNTDOWN FORMATTING & TICKER
// ==========================================
console.log('\n[Suite 3] Countdown Timer & Freeze Resilience:');

it('formatRemainingTime formats durations accurately in HH:MM:SS / MM:SS format', () => {
    assert.strictEqual(formatRemainingTime(0), '00:00');
    assert.strictEqual(formatRemainingTime(-5000), '00:00');
    assert.strictEqual(formatRemainingTime(5000), '00:05');
    assert.strictEqual(formatRemainingTime(29000), '00:29');
    assert.strictEqual(formatRemainingTime(59000), '00:59');
    assert.strictEqual(formatRemainingTime(60000), '01:00');
    assert.strictEqual(formatRemainingTime(90000), '01:30');
    assert.strictEqual(formatRemainingTime(3600000), '01:00:00');
    assert.strictEqual(formatRemainingTime(3665000), '01:01:05');
});

await itAsync('startStudentMatchCountdownTicker ticks down smoothly past 30s to 00:00 without freezing', async () => {
    const textElem = { innerText: '', style: {} };
    const btnElem = { disabled: true, innerHTML: '', style: {} };
    domElements.set('champ-match-countdown-text', textElem);
    domElements.set('btn-enter-champ-match', btnElem);

    // Set match start 2 seconds from now to test ticking and zero transition
    const nearStart = new Date(Date.now() + 2000).toISOString();
    const match = { id: 'm_ticker_test', scheduled_start: nearStart };

    startStudentMatchCountdownTicker(match);

    // Immediate tick verification
    assert.ok(textElem.innerText.startsWith('تبدأ خلال: 00:02') || textElem.innerText.startsWith('تبدأ خلال: 00:01'), 'Initial tick should be ~00:02');
    assert.strictEqual(btnElem.disabled, false, 'Button should be enabled for prep within 5 mins');
    assert.ok(btnElem.innerHTML.includes('ادخل للاستعداد للمباراة ⏳'));

    // Wait 2.2 seconds for countdown to reach 0
    await new Promise(r => setTimeout(r, 2200));

    // Post-zero verification
    assert.strictEqual(textElem.innerText, '⚡ المباراة بدأت الآن!');
    assert.strictEqual(textElem.style.color, '#10b981');
    assert.strictEqual(btnElem.disabled, false);
    assert.ok(btnElem.innerHTML.includes('ادخل غرفة المباراة الآن ⚡'));
});

// ==========================================
// RESULTS SUMMARY
// ==========================================
console.log('\n========================================');
console.log(`Tests Passed: ${passedTests} / ${totalTests} (${Math.round((passedTests/totalTests)*100)}%)`);
console.log('========================================');
if (passedTests === totalTests) {
    console.log('✅ ALL CHAMPIONSHIP FIXES VERIFIED SUCCESSFULLY!');
} else {
    process.exit(1);
}
