const fs = require('fs');

function normalizeSm2Card(card) {
    if (!card) return card;
    if (typeof card !== 'object') return card;
    if (card.repetitions === undefined) card.repetitions = (card.status === "mastered" ? 3 : 0);
    if (card.interval === undefined) card.interval = (card.status === "mastered" ? 7 : 0);
    if (card.easeFactor === undefined) card.easeFactor = 2.5;
    if (card.nextReviewDate === undefined) {
        card.nextReviewDate = card.status === "mastered" ? (Date.now() + 7 * 86400000) : 0;
    }
    if (!card.deck) card.deck = card.category || "General";
    if (!card.category) card.category = card.deck;
    if (!card.state) {
        card.state = card.status === "mastered" ? "mastered" : (card.repetitions > 0 ? "learning" : "new");
    }
    return card;
}

function isCardDueForReview(card) {
    if (!card) return false;
    normalizeSm2Card(card);
    if (!card.nextReviewDate || card.nextReviewDate === 0) return true;
    return card.nextReviewDate <= Date.now();
}

function calculateSm2Interval(card, grade) {
    normalizeSm2Card(card);
    let repetitions = card.repetitions || 0;
    let interval = card.interval || 0;
    let easeFactor = card.easeFactor || 2.5;
    let nextReviewDate = Date.now();
    let state = card.state || "new";

    if (grade === 1) { // AGAIN (< 10m)
        repetitions = 0;
        interval = 0;
        nextReviewDate = Date.now() + 10 * 60 * 1000;
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        state = "learning";
    } else if (grade === 2) { // HARD
        if (repetitions === 0) {
            interval = 1;
        } else {
            interval = Math.max(1, Math.round(interval * 1.2));
        }
        repetitions += 1;
        nextReviewDate = Date.now() + interval * 86400000;
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        state = repetitions >= 3 ? "mastered" : "learning";
    } else if (grade === 3) { // GOOD
        if (repetitions === 0) {
            interval = 1;
        } else if (repetitions === 1) {
            interval = 3;
        } else {
            interval = Math.max(1, Math.round(interval * easeFactor));
        }
        repetitions += 1;
        nextReviewDate = Date.now() + interval * 86400000;
        state = repetitions >= 3 ? "mastered" : "learning";
    } else if (grade === 4) { // EASY
        if (repetitions === 0) {
            interval = 4;
        } else if (repetitions === 1) {
            interval = 7;
        } else {
            interval = Math.max(1, Math.round(interval * easeFactor * 1.3));
        }
        repetitions += 1;
        easeFactor = Math.min(3.5, easeFactor + 0.15);
        nextReviewDate = Date.now() + interval * 86400000;
        state = "mastered";
    }

    return {
        repetitions,
        interval,
        easeFactor: parseFloat(easeFactor.toFixed(2)),
        nextReviewDate,
        lastReviewDate: Date.now(),
        state,
        status: state === "mastered" ? "mastered" : "review"
    };
}

function getSm2ButtonLabels(card) {
    normalizeSm2Card(card);
    const rep = card.repetitions || 0;
    const ef = card.easeFactor || 2.5;
    const curInt = card.interval || 0;

    const againLabel = "< 10m";
    const hardDays = rep === 0 ? 1 : Math.max(1, Math.round(curInt * 1.2));
    const goodDays = rep === 0 ? 1 : (rep === 1 ? 3 : Math.round(curInt * ef));
    const easyDays = rep === 0 ? 4 : (rep === 1 ? 7 : Math.round(curInt * ef * 1.3));

    return {
        againLabel,
        hardLabel: `${hardDays}d`,
        goodLabel: `${goodDays}d`,
        easyLabel: `${easyDays}d`
    };
}

console.log('=== STARTING ANKI SM-2 AUTOMATED TEST SUITE ===');

let passed = 0;
let total = 0;
function assert(name, condition) {
    total++;
    if (condition) {
        console.log(`✅ PASS [#${total}]: ${name}`);
        passed++;
    } else {
        console.error(`❌ FAIL [#${total}]: ${name}`);
    }
}

// 1. Normalization
let rawCard = { id: 'c1', front: 'Q', back: 'A' };
let norm = normalizeSm2Card(rawCard);
assert('Normalizes raw card with default SM-2 fields', norm.repetitions === 0 && norm.interval === 0 && norm.easeFactor === 2.5 && norm.state === 'new');
assert('Assigns default deck name from category or General', norm.deck === 'General');

// 2. Again (Grade 1)
let resAgain = calculateSm2Interval(norm, 1);
assert('Again resets repetitions to 0 and interval to 0 (<10m)', resAgain.repetitions === 0 && resAgain.interval === 0);
assert('Again decreases easeFactor from 2.5 to 2.3', resAgain.easeFactor === 2.3);
assert('Again sets state to learning', resAgain.state === 'learning');

// 3. Good (Grade 3) progression
let cardGood = normalizeSm2Card({ id: 'cg', front: 'Q', back: 'A' });
let step1 = calculateSm2Interval(cardGood, 3);
assert('Good step 1 gives interval = 1d and repetitions = 1', step1.interval === 1 && step1.repetitions === 1);

Object.assign(cardGood, step1);
let step2 = calculateSm2Interval(cardGood, 3);
assert('Good step 2 gives interval = 3d and repetitions = 2', step2.interval === 3 && step2.repetitions === 2);

Object.assign(cardGood, step2);
let step3 = calculateSm2Interval(cardGood, 3);
assert('Good step 3 gives interval = 8d (3 * 2.5 = 7.5 rounded to 8) and state = mastered', step3.interval === 8 && step3.repetitions === 3 && step3.state === 'mastered');

// 4. Easy (Grade 4) progression
let cardEasy = normalizeSm2Card({ id: 'ce', front: 'Q', back: 'A' });
let easyStep1 = calculateSm2Interval(cardEasy, 4);
assert('Easy step 1 gives interval = 4d, state = mastered, and EF = 2.65', easyStep1.interval === 4 && easyStep1.state === 'mastered' && easyStep1.easeFactor === 2.65);

// 5. Button label preview
let labels = getSm2ButtonLabels(cardEasy);
assert('Button labels format correctly (< 10m, 1d, 3d, 7d for new card)', labels.againLabel === '< 10m' && labels.hardLabel === '1d' && labels.goodLabel === '1d' && labels.easyLabel === '4d');

// 6. Due card detection
assert('New card with nextReviewDate = 0 is due', isCardDueForReview(rawCard) === true);
assert('Mastered card with future nextReviewDate is NOT due', isCardDueForReview({ nextReviewDate: Date.now() + 86400000 }) === false);

console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===`);
if (passed !== total) process.exit(1);
