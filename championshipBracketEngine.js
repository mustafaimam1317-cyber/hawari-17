/**
 * 🏆 HAWARI QUIZ CHAMPIONSHIP BRACKET ENGINE
 * High-performance, scalable tournament bracket generator & state manager.
 * Supports any number of participants (8, 16, 32, 50, 64, 128+) with Byes and Preliminary rounds.
 */

export const ROUND_NAMES = {
    PRELIMINARY: 'preliminary',
    ROUND_64: 'round_64',
    ROUND_32: 'round_32',
    ROUND_16: 'round_16',
    QUARTER: 'quarter',
    SEMI: 'semi',
    FINAL: 'final'
};

export const ROUND_LABELS = {
    [ROUND_NAMES.PRELIMINARY]: 'Preliminary Round',
    [ROUND_NAMES.ROUND_64]: 'Round of 64',
    [ROUND_NAMES.ROUND_32]: 'Round of 32',
    [ROUND_NAMES.ROUND_16]: 'Round of 16',
    [ROUND_NAMES.QUARTER]: 'Quarter-Finals',
    [ROUND_NAMES.SEMI]: 'Semi-Finals',
    [ROUND_NAMES.FINAL]: 'Grand Final 🏆'
};

/**
 * Calculates the exact sequence of active rounds required for any tournament size N (2 to 60).
 * Dynamically determines if a Preliminary Round is needed and all subsequent main bracket rounds.
 *
 * @param {number} N Number of participants
 * @returns {Array<string>} Array of round keys
 */
export function getRequiredRoundsForSize(N) {
    if (!N || N < 2) return [ROUND_NAMES.FINAL];
    let targetPower = 2;
    while (targetPower * 2 <= N) {
        targetPower *= 2;
    }
    const rounds = [];
    if (N > targetPower) {
        rounds.push(ROUND_NAMES.PRELIMINARY);
    }
    let slots = targetPower;
    while (slots >= 2) {
        if (slots === 64) rounds.push(ROUND_NAMES.ROUND_64);
        else if (slots === 32) rounds.push(ROUND_NAMES.ROUND_32);
        else if (slots === 16) rounds.push(ROUND_NAMES.ROUND_16);
        else if (slots === 8) rounds.push(ROUND_NAMES.QUARTER);
        else if (slots === 4) rounds.push(ROUND_NAMES.SEMI);
        else if (slots === 2) rounds.push(ROUND_NAMES.FINAL);
        slots /= 2;
    }
    return rounds;
}

/**
 * Generates an optimized Single-Elimination Tournament Bracket.
 * For 50 players: generates 18 preliminary matches (36 players) + 14 direct Byes to Round of 32.
 * Total matches: exactly 49 matches (N - 1 invariant).
 *
 * @param {Array} participants List of { id, email, student_name, seed_number }
 * @param {Object} config Championship configuration options
 * @returns {Object} { championship, matches, participants, roundsSummary }
 */
export function generateChampionshipBracket(participants = [], config = {}) {
    const champId = config.id || `champ_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const title = config.title || 'Hawari Medical Cup';
    const groupName = config.group_name || 'infection';
    const scheduledStart = config.scheduled_start || new Date().toISOString();
    const matchIntervalMins = config.match_interval_mins || 20;

    // 1. Normalize and seed participants
    const roster = participants.map((p, idx) => ({
        id: p.id || `part_${champId}_${idx + 1}`,
        championship_id: champId,
        email: (p.email || '').trim().toLowerCase(),
        student_name: p.student_name || p.email.split('@')[0] || `Student ${idx + 1}`,
        seed_number: p.seed_number !== undefined ? p.seed_number : (idx + 1),
        is_active: true,
        eliminated: false
    }));

    const N = roster.length;
    if (N < 2) {
        throw new Error('At least 2 participants are required to generate a championship bracket.');
    }

    // 2. Determine Bracket Sizing
    // Find next lower and higher power of 2
    let targetPower = 2;
    while (targetPower * 2 <= N) {
        targetPower *= 2;
    }
    const higherPower = targetPower * 2;

    const matches = [];
    let roundIndex = 1;

    // Check if we need a preliminary round (e.g. N = 50, targetPower = 32)
    const prelimCount = N > targetPower ? (N - targetPower) : 0; // for 50: 50 - 32 = 18 matches
    const prelimPlayersCount = prelimCount * 2; // for 50: 36 players
    const byeCount = N - prelimPlayersCount; // for 50: 50 - 36 = 14 players with Byes directly into targetPower (32)

    let currentRoundParticipants = [];
    const baseDate = new Date(scheduledStart);

    // =========================================================================
    // STAGE 1: PRELIMINARY ROUND (If N is not an exact power of 2)
    // =========================================================================
    const prelimMatches = [];
    if (prelimCount > 0) {
        // Seeds 1 to byeCount get Byes
        const byePlayers = roster.slice(0, byeCount);
        // Seeds (byeCount + 1) to N play in preliminary
        const prelimPlayers = roster.slice(byeCount);

        for (let i = 0; i < prelimCount; i++) {
            const matchId = `match_${champId}_r1_m${i + 1}`;
            const p1 = prelimPlayers[i];
            const p2 = prelimPlayers[prelimPlayers.length - 1 - i];

            const matchDate = (config.round_schedules && config.round_schedules[ROUND_NAMES.PRELIMINARY])
                ? new Date(config.round_schedules[ROUND_NAMES.PRELIMINARY])
                : new Date(baseDate.getTime() + (roundIndex - 1) * matchIntervalMins * 60000);

            prelimMatches.push({
                id: matchId,
                championship_id: champId,
                round_name: ROUND_NAMES.PRELIMINARY,
                round_number: roundIndex,
                match_order: i + 1,
                player1_id: p1 ? p1.id : null,
                player2_id: p2 ? p2.id : null,
                player1_info: p1,
                player2_info: p2,
                winner_id: null,
                next_match_id: null, // linked below
                next_match_slot: null,
                scheduled_start: matchDate.toISOString(),
                status: 'scheduled',
                p1_score: 0,
                p2_score: 0,
                p1_time_ms: 0,
                p2_time_ms: 0,
                match_meta: {}
            });
        }

        matches.push(...prelimMatches);
        roundIndex++;
    }

    // =========================================================================
    // STAGE 2: POWER-OF-2 MAIN BRACKET (32, 16, 8, 4, 2)
    // =========================================================================
    let slotsInRound = targetPower; // e.g. 32
    let previousRoundMatches = [];

    while (slotsInRound >= 2) {
        const matchesInThisRound = slotsInRound / 2;
        const currentRoundMatches = [];
        
        let rName = ROUND_NAMES.FINAL;
        if (slotsInRound === 64) rName = ROUND_NAMES.ROUND_64;
        else if (slotsInRound === 32) rName = ROUND_NAMES.ROUND_32;
        else if (slotsInRound === 16) rName = ROUND_NAMES.ROUND_16;
        else if (slotsInRound === 8) rName = ROUND_NAMES.QUARTER;
        else if (slotsInRound === 4) rName = ROUND_NAMES.SEMI;
        else if (slotsInRound === 2) rName = ROUND_NAMES.FINAL;

        const roundDate = (config.round_schedules && config.round_schedules[rName])
            ? new Date(config.round_schedules[rName])
            : new Date(baseDate.getTime() + (roundIndex - 1) * matchIntervalMins * 60000);

        for (let i = 0; i < matchesInThisRound; i++) {
            const matchId = `match_${champId}_r${roundIndex}_m${i + 1}`;

            let p1 = null;
            let p2 = null;

            // In the first round of the main bracket (e.g. Round of 32):
            if (slotsInRound === targetPower) {
                if (prelimCount === 0) {
                    // Direct seeded pairing (1 vs 32, 2 vs 31, etc.)
                    p1 = roster[i];
                    p2 = roster[roster.length - 1 - i];
                } else {
                    // Hybrid: Byes + Winners of preliminary
                    // For 50 players: 14 Byes and 18 Preliminary Winners
                    if (i < byeCount) {
                        p1 = roster[i]; // Seeded Bye player
                    }
                }
            }

            currentRoundMatches.push({
                id: matchId,
                championship_id: champId,
                round_name: rName,
                round_number: roundIndex,
                match_order: i + 1,
                player1_id: p1 ? p1.id : null,
                player2_id: p2 ? p2.id : null,
                player1_info: p1,
                player2_info: p2,
                winner_id: null,
                next_match_id: null,
                next_match_slot: null,
                scheduled_start: roundDate.toISOString(),
                status: 'scheduled',
                p1_score: 0,
                p2_score: 0,
                p1_time_ms: 0,
                p2_time_ms: 0,
                match_meta: {}
            });
        }

        // Link previous round's matches to this round's matches
        if (previousRoundMatches.length > 0) {
            previousRoundMatches.forEach((prevMatch, idx) => {
                const targetMatchIdx = Math.floor(idx / 2);
                const targetSlot = (idx % 2 === 0) ? 1 : 2;
                prevMatch.next_match_id = currentRoundMatches[targetMatchIdx].id;
                prevMatch.next_match_slot = targetSlot;
            });
        } else if (prelimMatches.length > 0 && slotsInRound === targetPower) {
            // Link preliminary matches to Round of 32 unfilled slots
            let pIdx = 0;
            currentRoundMatches.forEach(mainMatch => {
                if (!mainMatch.player1_id && pIdx < prelimMatches.length) {
                    prelimMatches[pIdx].next_match_id = mainMatch.id;
                    prelimMatches[pIdx].next_match_slot = 1;
                    pIdx++;
                }
                if (!mainMatch.player2_id && pIdx < prelimMatches.length) {
                    prelimMatches[pIdx].next_match_id = mainMatch.id;
                    prelimMatches[pIdx].next_match_slot = 2;
                    pIdx++;
                }
            });
        }

        matches.push(...currentRoundMatches);
        previousRoundMatches = currentRoundMatches;
        slotsInRound /= 2;
        roundIndex++;
    }

    const championship = {
        id: champId,
        group_name: groupName,
        title: title,
        status: config.status || 'draft',
        total_slots: N,
        bracket_type: config.bracket_type || 'auto',
        round_schedules: config.round_schedules || {},
        round_questions: config.round_questions || {},
        settings: {
            grace_period_sec: 60,
            seconds_per_question: 20,
            questions_per_match: 5,
            points_per_correct: 10,
            tie_breaker: 'speed_on_correct',
            ...(config.settings || {})
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    return {
        championship,
        participants: roster,
        matches,
        roundsCount: roundIndex - 1,
        totalMatches: matches.length
    };
}

/**
 * Server-authoritative match evaluation with Speed-on-Correct Tie-Breaking.
 *
 * @param {Object} match Current match state
 * @returns {Object} { winner_id, loser_id, reason, p1_score, p2_score, p1_time_ms, p2_time_ms }
 */
export function evaluateMatchResult(match) {
    if (!match.player1_id && !match.player2_id) {
        return { winner_id: null, loser_id: null, reason: 'empty_match' };
    }
    // Walkover / Forfeit cases
    if (match.player1_id && !match.player2_id) {
        return { winner_id: match.player1_id, loser_id: null, reason: 'walkover_bye' };
    }
    if (!match.player1_id && match.player2_id) {
        return { winner_id: match.player2_id, loser_id: null, reason: 'walkover_bye' };
    }

    if (match.status === 'forfeit') {
        const winner = match.match_meta && match.match_meta.forfeit_by === match.player1_id 
            ? match.player2_id 
            : match.player1_id;
        const loser = winner === match.player1_id ? match.player2_id : match.player1_id;
        return { winner_id: winner, loser_id: loser, reason: 'forfeit' };
    }

    // 1. Primary Criteria: Correct answer score
    if (match.p1_score > match.p2_score) {
        return { winner_id: match.player1_id, loser_id: match.player2_id, reason: 'score' };
    }
    if (match.p2_score > match.p1_score) {
        return { winner_id: match.player2_id, loser_id: match.player1_id, reason: 'score' };
    }

    // 2. Secondary Criteria (Tie-breaker): Response time on correct answers (Lower ms is faster)
    if (match.p1_time_ms < match.p2_time_ms) {
        return { winner_id: match.player1_id, loser_id: match.player2_id, reason: 'speed_tiebreaker' };
    }
    if (match.p2_time_ms < match.p1_time_ms) {
        return { winner_id: match.player2_id, loser_id: match.player1_id, reason: 'speed_tiebreaker' };
    }

    // 3. Fallback: Player 1 (Higher original seed)
    return { winner_id: match.player1_id, loser_id: match.player2_id, reason: 'seed_tiebreaker' };
}

/**
 * Propagates a completed match winner into their next round match slot.
 *
 * @param {Array} matches All matches in championship
 * @param {string} matchId ID of finished match
 * @param {string} winnerId ID of winning participant
 * @returns {Array} Updated matches array
 */
export function advanceWinnerToNextRound(matches, matchId, winnerId) {
    const finishedMatch = matches.find(m => m.id === matchId);
    if (!finishedMatch || !finishedMatch.next_match_id || !winnerId) {
        return matches;
    }

    const nextMatch = matches.find(m => m.id === finishedMatch.next_match_id);
    if (!nextMatch) return matches;

    const winnerInfo = finishedMatch.player1_id === winnerId 
        ? finishedMatch.player1_info 
        : (finishedMatch.player2_id === winnerId ? finishedMatch.player2_info : null);

    if (finishedMatch.next_match_slot === 1) {
        nextMatch.player1_id = winnerId;
        if (winnerInfo) nextMatch.player1_info = winnerInfo;
    } else {
        nextMatch.player2_id = winnerId;
        if (winnerInfo) nextMatch.player2_info = winnerInfo;
    }

    return [...matches];
}
