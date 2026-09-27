/**
 * ============================================================================
 * 🏆 HAWARI CHAMPIONSHIP LEAGUES & TOURNAMENT BRACKET CONTROLLER
 * High-Throughput Real-Time Tournament Client Module (100% English UI)
 * Author: Mustafa Imam | Hawari Platform 2026
 * ============================================================================
 */

import { 
    generateChampionshipBracket, 
    evaluateMatchResult, 
    advanceWinnerToNextRound, 
    getRequiredRoundsForSize,
    ROUND_LABELS, 
    ROUND_NAMES 
} from './championshipBracketEngine.js';

// Central In-Memory State
export const champState = {
    activeChampionship: null,
    participants: [],
    matches: [],
    currentStudentMatch: null,
    activeSubTab: 'fixtures', // 'fixtures', 'bracket' (for students)
    adminActiveSubTab: 'roster', // 'roster', 'schedules', 'questions', 'bracket' (for admin)
    inMatch: false,
    activeMatchRoom: null,
    rosterSearchQuery: '',
    lastContainerId: null
};

// Storage Key Constants
export const STORAGE_CHAMP_KEY = 'hawari_championship_active';

export function getActiveGroupName() {
    if (typeof window !== 'undefined' && window.state && window.state.activeGroup) {
        return window.state.activeGroup.toLowerCase();
    }
    return 'infection';
}

export function getActiveCurrentUser() {
    if (typeof window !== 'undefined' && window.state && window.state.currentUser) {
        return window.state.currentUser;
    }
    return null;
}


export const ALL_ROUNDS = [
    { key: ROUND_NAMES.PRELIMINARY, label: 'Preliminary Round' },
    { key: ROUND_NAMES.ROUND_32, label: 'Round of 32' },
    { key: ROUND_NAMES.ROUND_16, label: 'Round of 16' },
    { key: ROUND_NAMES.QUARTER, label: 'Quarter-Finals' },
    { key: ROUND_NAMES.SEMI, label: 'Semi-Finals' },
    { key: ROUND_NAMES.FINAL, label: 'Grand Final 🏆' }
];

/**
 * Initialize Championship Leagues Subsystem
 */
let _champLeagueInitialized = false;

export async function initChampionshipLeague(supabaseRequest, state, showToast) {
    if (_champLeagueInitialized) return;
    _champLeagueInitialized = true;
    console.log('[Championship] Initializing Championship League Subsystem...');
    await loadActiveChampionship(supabaseRequest, state);

    // Setup periodic refresh of today's fixtures countdown (every 1s)
    setInterval(() => {
        if (champState.activeChampionship && !champState.inMatch) {
            updateStudentMatchCountdown();
        }
    }, 1000);
}

/**
 * Delete active championship from Supabase cloud bridge
 */
export async function deleteChampionshipFromCloud(group = 'infection') {
    const req = typeof window !== 'undefined' ? window.supabaseRequest : null;
    if (!req) return false;
    try {
        await req(`hawari_course_quizzes?id=eq.championship_active_${group}`, {
            method: 'DELETE'
        });
        console.log('[Championship] Deleted tournament record from cloud bridge successfully');
        return true;
    } catch (e) {
        console.warn('[Championship] Cloud bridge delete error:', e);
        return false;
    }
}

let _activeLoadChampionshipPromise = null;

/**
 * Load Active Championship with Resilient Cloud Bridge & Concurrency Deduplication
 */
export async function loadActiveChampionship(supabaseRequest, state) {
    const group = (state && state.activeGroup) ? state.activeGroup.toLowerCase() : (getActiveGroupName ? getActiveGroupName() : 'infection');
    const req = supabaseRequest || (typeof window !== 'undefined' ? window.supabaseRequest : null);
    
    // Deduplication: return running promise if a fetch is already in flight
    if (_activeLoadChampionshipPromise) {
        return _activeLoadChampionshipPromise;
    }

    _activeLoadChampionshipPromise = (async () => {
        if (req) {
            // Resilient Cloud Bridge: Load directly from hawari_course_quizzes
            // (Eliminates 404 table errors and ensures 100% cloud sync across all devices)
            try {
                const bridgeRecords = await req(`hawari_course_quizzes?id=eq.championship_active_${group}`);
                if (bridgeRecords && Array.isArray(bridgeRecords) && bridgeRecords.length > 0 && bridgeRecords[0].questions) {
                    const data = bridgeRecords[0].questions;
                    if (data.championship && (data.championship.status === 'active' || data.championship.status === 'draft')) {
                        champState.activeChampionship = data.championship;
                        champState.participants = data.participants || [];
                        champState.matches = data.matches || [];
                        console.log('[Championship] Loaded tournament from cloud bridge successfully');
                        // Cache locally WITHOUT broadcasting or cloud syncing to prevent infinite loops
                        saveChampionshipToLocalCache(group, false, false);
                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('championship_updated'));
                        }
                        return true;
                    }
                }
            } catch (e) {
                console.warn('[Championship] Cloud bridge fetch error:', e);
            }
        }

        // Fallback: Check local persistent storage
        try {
            const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed.championship) {
                    champState.activeChampionship = parsed.championship || null;
                    champState.participants = parsed.participants || [];
                    champState.matches = parsed.matches || [];
                    console.log('[Championship] Loaded tournament from cache');
                    return true;
                }
            }
        } catch (e) {}

        return false;
    })().finally(() => {
        _activeLoadChampionshipPromise = null;
    });

    return _activeLoadChampionshipPromise;
}

/**
 * Sync championship state to Supabase cloud (Resilient cloud bridge)
 */
export async function syncChampionshipToCloud(group = 'infection') {
    if (typeof window === 'undefined') return;
    const req = window.supabaseRequest;
    if (!req) return;
    const champ = champState.activeChampionship;

    // If tournament was cleared or reset, physically delete it from the cloud bridge
    if (!champ) {
        await deleteChampionshipFromCloud(group);
        return;
    }

    const payloadData = {
        championship: champ,
        participants: champState.participants || [],
        matches: champState.matches || [],
        updated_at: new Date().toISOString()
    };

    // Resilient Cloud Bridge: Save to hawari_course_quizzes so all student devices get it instantly
    try {
        await req('hawari_course_quizzes', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
                id: `championship_active_${group}`,
                group_name: group,
                title: champ.title,
                questions: payloadData,
                time_limit: 20,
                start_time: new Date().toISOString(),
                end_time: new Date(Date.now() + 14 * 86400000).toISOString(),
                status: champ.status
            })
        });
        console.log('[Championship] Synced tournament state to cloud bridge');
    } catch (e) {
        console.warn('[Championship] Cloud bridge sync error:', e);
    }
}

/**
 * Save current state to local cache with optional background cloud sync & broadcast control
 */
export function saveChampionshipToLocalCache(group = 'infection', triggerCloud = true, triggerBroadcast = true) {
    try {
        localStorage.setItem(`${STORAGE_CHAMP_KEY}_${group}`, JSON.stringify({
            championship: champState.activeChampionship,
            participants: champState.participants,
            matches: champState.matches
        }));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('championship_updated'));
            if (triggerBroadcast && typeof window._broadcastChampionshipUpdate === 'function') {
                window._broadcastChampionshipUpdate('UPDATE');
            }
        }
    } catch (e) {}

    if (triggerCloud) {
        syncChampionshipToCloud(group).catch(() => {});
    }
}

/**
 * Load matches for active championship
 */
export async function loadChampionshipMatches(supabaseRequest, champId) {
    try {
        const matches = await supabaseRequest(`championship_matches?championship_id=eq.${champId}&order=round_number.asc,match_order.asc`);
        if (matches && Array.isArray(matches)) {
            champState.matches = matches;
        }
    } catch (e) {
        console.warn('[Championship] Failed to fetch matches:', e.message);
    }
}

/**
 * Automatically check and resolve unplayed matches that have passed their deadline
 * Neither entered after 4 minutes -> Double Forfeit (both eliminated)
 * One entered, one absent after 4 minutes -> Walkover for entered player (absent eliminated)
 */
export function checkExpiredUnplayedMatches() {
    if (!champState.matches || champState.matches.length === 0) return false;
    const champ = champState.activeChampionship;
    if (!champ || champ.status !== 'active') return false;

    let changed = false;
    const now = Date.now();
    const GRACE_PERIOD_MS = 4 * 60 * 1000; // 4 minutes

    champState.matches.forEach(m => {
        if (m.status === 'completed' || m.status === 'double_forfeit') return;
        if (!m.scheduled_start) return;

        const schedTime = new Date(m.scheduled_start).getTime();
        if (now > (schedTime + GRACE_PERIOD_MS)) {
            const p1Entered = !!m.match_meta?.p1_entered;
            const p2Entered = !!m.match_meta?.p2_entered;

            if (!p1Entered && !p2Entered) {
                // NEITHER PLAYER ENTERED: DOUBLE FORFEIT
                m.status = 'double_forfeit';
                m.score_text = 'استبعاد الطرفين للغياب';
                m.completed_at = new Date().toISOString();

                // Eliminate both participants
                if (m.player1_id) {
                    const p1 = (champState.participants || []).find(p => p.id === m.player1_id);
                    if (p1) { p1.eliminated = true; p1.elimination_reason = 'غياب عن المباراة الرسمية'; }
                }
                if (m.player2_id) {
                    const p2 = (champState.participants || []).find(p => p.id === m.player2_id);
                    if (p2) { p2.eliminated = true; p2.elimination_reason = 'غياب عن المباراة الرسمية'; }
                }

                // Update next match slot: mark placeholder as eliminated
                if (m.next_match_id) {
                    const nextM = champState.matches.find(nm => nm.id === m.next_match_id);
                    if (nextM) {
                        if (m.next_match_slot === 1) {
                            nextM.player1_id = null;
                            nextM.player1_info = { student_name: 'مستبعد للغياب', email: '', isPlaceholder: true, eliminated: true };
                        } else {
                            nextM.player2_id = null;
                            nextM.player2_info = { student_name: 'مستبعد للغياب', email: '', isPlaceholder: true, eliminated: true };
                        }
                    }
                }
                changed = true;
            } else if (p1Entered && !p2Entered) {
                // P1 entered, P2 never arrived: P1 Walkover Win
                m.status = 'completed';
                m.winner_id = m.player1_id;
                m.winner_info = m.player1_info;
                m.p1_score = 1;
                m.p2_score = 0;
                m.score_text = 'فوز بالانسحاب (عدم حضور الخصم)';
                m.completed_at = new Date().toISOString();

                if (m.player2_id) {
                    const p2 = (champState.participants || []).find(p => p.id === m.player2_id);
                    if (p2) { p2.eliminated = true; p2.elimination_reason = 'انسحاب لعدم الحضور'; }
                }

                if (m.next_match_id && m.winner_id) {
                    advanceWinnerToNextRound(champState.matches, m.id, m.winner_id);
                }
                changed = true;
            } else if (!p1Entered && p2Entered) {
                // P2 entered, P1 never arrived: P2 Walkover Win
                m.status = 'completed';
                m.winner_id = m.player2_id;
                m.winner_info = m.player2_info;
                m.p1_score = 0;
                m.p2_score = 1;
                m.score_text = 'فوز بالانسحاب (عدم حضور الخصم)';
                m.completed_at = new Date().toISOString();

                if (m.player1_id) {
                    const p1 = (champState.participants || []).find(p => p.id === m.player1_id);
                    if (p1) { p1.eliminated = true; p1.elimination_reason = 'انسحاب لعدم الحضور'; }
                }

                if (m.next_match_id && m.winner_id) {
                    advanceWinnerToNextRound(champState.matches, m.id, m.winner_id);
                }
                changed = true;
            }
        }
    });

    // Check downstream matches where one competitor gets a bye because opponent slot was double_forfeited
    champState.matches.forEach(m => {
        if (m.status === 'completed' || m.status === 'double_forfeit') return;
        const p1Void = (!m.player1_id && m.player1_info?.eliminated);
        const p2Void = (!m.player2_id && m.player2_info?.eliminated);

        if (p1Void && p2Void) {
            m.status = 'double_forfeit';
            m.score_text = 'استبعاد لعدم وجود متأهلين';
            m.completed_at = new Date().toISOString();
            if (m.next_match_id) {
                const nextM = champState.matches.find(nm => nm.id === m.next_match_id);
                if (nextM) {
                    if (m.next_match_slot === 1) {
                        nextM.player1_id = null;
                        nextM.player1_info = { student_name: 'مستبعد للغياب', email: '', isPlaceholder: true, eliminated: true };
                    } else {
                        nextM.player2_id = null;
                        nextM.player2_info = { student_name: 'مستبعد للغياب', email: '', isPlaceholder: true, eliminated: true };
                    }
                }
            }
            changed = true;
        } else if (!p1Void && m.player1_id && p2Void) {
            m.status = 'completed';
            m.winner_id = m.player1_id;
            m.winner_info = m.player1_info;
            m.p1_score = 1;
            m.p2_score = 0;
            m.score_text = 'تأهل مباشر (غياب المنافس)';
            m.completed_at = new Date().toISOString();
            if (m.next_match_id) {
                advanceWinnerToNextRound(champState.matches, m.id, m.winner_id);
            }
            changed = true;
        } else if (p1Void && !p2Void && m.player2_id) {
            m.status = 'completed';
            m.winner_id = m.player2_id;
            m.winner_info = m.player2_info;
            m.p1_score = 0;
            m.p2_score = 1;
            m.score_text = 'تأهل مباشر (غياب المنافس)';
            m.completed_at = new Date().toISOString();
            if (m.next_match_id) {
                advanceWinnerToNextRound(champState.matches, m.id, m.winner_id);
            }
            changed = true;
        }
    });

    if (changed) {
        const group = getActiveGroupName();
        saveChampionshipToLocalCache(group);
    }
    return changed;
}

/**
 * Master Render Router
 */
export function renderChampionshipHub(containerId = 'battle-championship-container', currentUser = null) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById(containerId);
    if (!container) return;

    champState.lastContainerId = containerId;
    const user = currentUser || getActiveCurrentUser();
    const userEmail = (user && user.email) ? user.email.toLowerCase().trim() : '';
    const group = getActiveGroupName();

    // ALWAYS synchronize cache from localStorage to ensure published tournaments and score updates are instantly visible
    try {
        const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            champState.activeChampionship = parsed.championship || null;
            champState.participants = parsed.participants || [];
            champState.matches = parsed.matches || [];
        } else {
            champState.activeChampionship = null;
            champState.participants = [];
            champState.matches = [];
        }
    } catch (e) {}

    // Proactive background cloud fetch if activeChampionship is not yet in cache (e.g. fresh student device)
    if (!champState.activeChampionship && !champState._loadingCloud && !champState._cloudChecked) {
        champState._loadingCloud = true;
        champState._cloudChecked = true;
        loadActiveChampionship().then((loaded) => {
            champState._loadingCloud = false;
            if (loaded && champState.activeChampionship) {
                renderChampionshipHub(containerId, currentUser);
            }
        }).catch(() => {
            champState._loadingCloud = false;
        });
    }

    // Check and resolve any expired unplayed matches (double forfeit & walkovers)
    checkExpiredUnplayedMatches();

    // BRANCH 1: ADMIN PANEL CHAMPIONSHIP MANAGER
    if (containerId === 'admin-championship-tab-container') {
        renderAdminChampionshipManager(container);
        return;
    }

    // BRANCH 2: BATTLE ROOM STUDENT VIEW
    renderBattleRoomStudentHub(container, userEmail);
}

/**
 * Render Student Hub in Battle Room
 * Contains ONLY: Today's Matches and Tournament Bracket (NO Admin Controls)
 * Shows Trophy Empty State if tournament is not published/active
 */
function renderBattleRoomStudentHub(container, userEmail) {
    const champ = champState.activeChampionship;
    const isLive = champ && champ.status === 'active';

    if (!isLive) {
        if (champState._loadingCloud) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 70px 20px; text-align: center;">
                    <div style="font-size: 2.8rem; color: #f59e0b; margin-bottom: 18px;">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                    </div>
                    <h3 style="color: var(--text-primary); font-size: 1.3rem; font-weight: 800; margin-bottom: 8px;">جاري فحص وتحديث بطولات الدوري العام...</h3>
                    <p style="color: var(--text-muted); font-size: 0.9rem; max-width: 460px; margin: 0 auto; line-height: 1.6;">يتم الآن الاتصال بالسيرفر السحابي للتحقق من المواعيد الرسمية وجدول المواجهات.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="empty-state" style="padding: 70px 20px; text-align: center;">
                <div style="width: 86px; height: 86px; border-radius: 50%; background: rgba(245, 158, 11, 0.12); color: #f59e0b; display: inline-flex; align-items: center; justify-content: center; font-size: 3.2rem; margin-bottom: 22px; box-shadow: 0 4px 20px rgba(245, 158, 11, 0.15);">
                    <i class="fa-solid fa-trophy"></i>
                </div>
                <h3 style="color: var(--text-primary); font-size: 1.5rem; font-weight: 800; margin-bottom: 10px;">لا توجد بطولة نشطة حالياً</h3>
                <p style="color: var(--text-muted); font-size: 0.95rem; max-width: 480px; margin: 0 auto 24px auto; line-height: 1.6;">سيتم إعلان مواعيد وجدول مباريات بطولة Hawari Championship League هنا فور نشرها من قبل إدارة المنصة.</p>
                <button class="btn btn-primary" onclick="window.switchBattleArenaMode('quick')">
                    <i class="fa-solid fa-bolt"></i> خوض مواجهة سريعة 1v1
                </button>
            </div>
        `;
        return;
    }

    // Identify student's upcoming match
    champState.currentStudentMatch = findUserNextMatch(userEmail);

    let html = `
        <div class="championship-hub-wrapper" style="display: flex; flex-direction: column; gap: 24px;">
            <!-- 1. TOURNAMENT TITLE & METRICS BAR -->
            <div class="card stat-card" style="padding: 20px 24px; border-radius: 16px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(59, 130, 246, 0.08)); border: 1px solid rgba(245, 158, 11, 0.25);">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 52px; height: 52px; border-radius: 14px; background: linear-gradient(135deg, #f59e0b, #d97706); display: flex; align-items: center; justify-content: center; font-size: 1.6rem; color: #ffffff; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35);">
                        <i class="fa-solid fa-trophy"></i>
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <h2 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-primary);">${champ.title}</h2>
                            <span class="badge" style="background: #10b981; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">LIVE LEAGUE</span>
                        </div>
                        <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-secondary);">
                            Single-Elimination Tournament &bull; ${champState.participants.length} Competitors &bull; Speed & Accuracy Scoring
                        </p>
                    </div>
                </div>

                <div style="display: flex; gap: 16px; align-items: center;">
                    <div style="text-align: right;">
                        <span style="font-size: 0.78rem; color: var(--text-muted); display: block;">Total Matches</span>
                        <strong style="font-size: 1.1rem; color: var(--text-primary);">${champState.matches.length} Matches</strong>
                    </div>
                </div>
            </div>

            <!-- 2. STUDENT MATCH LIVE COUNTDOWN & ENTRY BANNER (If competitor) -->
            ${renderStudentMatchBanner(userEmail)}

            <!-- 3. SUB-NAVIGATION TABS (ONLY 2 TABS FOR STUDENTS: NO ADMIN CONTROLS) -->
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; flex-wrap: wrap;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn ${champState.activeSubTab === 'fixtures' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchChampSubTab('fixtures')">
                        <i class="fa-solid fa-calendar-day"></i> Today's Matches
                    </button>
                    <button class="btn ${champState.activeSubTab === 'bracket' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchChampSubTab('bracket')">
                        <i class="fa-solid fa-diagram-project"></i> Tournament Bracket
                    </button>
                </div>

                <div style="font-size: 0.85rem; color: var(--text-muted);">
                    <i class="fa-solid fa-bolt" style="color: #f59e0b;"></i> Tie-Breaker: Fastest Correct Answers (ms)
                </div>
            </div>

            <!-- 4. TAB CONTENTS -->
            <div class="championship-content-area">
                ${champState.activeSubTab === 'fixtures' ? renderTodayFixturesHtml(userEmail) : ''}
                ${champState.activeSubTab === 'bracket' ? renderVisualBracketTreeHtml(userEmail) : ''}
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Start autonomous countdown ticker for student's next match immediately upon DOM mount
    if (champState.currentStudentMatch) {
        startStudentMatchCountdownTicker(champState.currentStudentMatch);
    }
}

/**
 * Render Full Admin Championship Manager Suite
 * Located inside Admin Panel -> Championship Manager
 */
function renderAdminChampionshipManager(container) {
    const champ = champState.activeChampionship;
    const participants = champState.participants || [];
    const matches = champState.matches || [];
    const activeTab = champState.adminActiveSubTab || 'roster';

    let html = `
        <div class="admin-championship-manager-wrapper" style="display: flex; flex-direction: column; gap: 24px;">
            <!-- ADMIN HEADER -->
            <div class="card" style="padding: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(245, 158, 11, 0.08)); border: 1.5px solid #8b5cf6;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                            <h2 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: var(--text-primary);">
                                <i class="fa-solid fa-trophy" style="color: #8b5cf6;"></i> Championship Manager
                            </h2>
                            <span class="badge" style="background: ${champ?.status === 'active' ? '#10b981' : '#f59e0b'}; color: white; padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">
                                ${champ?.status === 'active' ? '🟢 Published / Active' : (champ ? '🟡 Draft / Hidden' : '⚪ Not Created')}
                            </span>
                        </div>
                        <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">
                            Manage tournament roster (up to 60 competitors), set unified round exam timings, upload synchronized question sets, and conduct the tournament draw.
                        </p>
                    </div>

                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${!champ ? `
                            <button class="btn btn-primary" onclick="window.createTournamentPrompt()" style="background: #8b5cf6; border-color: #8b5cf6;">
                                <i class="fa-solid fa-plus-circle"></i> Create Tournament
                            </button>
                        ` : `
                            <button class="btn ${champ.status === 'active' ? 'btn-secondary' : 'btn-primary'}" onclick="window.toggleTournamentPublishStatus()" style="${champ.status !== 'active' ? 'background: #10b981; border-color: #10b981;' : ''}">
                                <i class="fa-solid ${champ.status === 'active' ? 'fa-pause' : 'fa-paper-plane'}"></i> ${champ.status === 'active' ? 'Hide from Students (Draft)' : 'Publish to Students (Live)'}
                            </button>
                            <button class="btn btn-secondary" onclick="window.generateBracketFromAdmin()" style="border-color: #8b5cf6; color: #8b5cf6;">
                                <i class="fa-solid fa-shuffle"></i> Generate Bracket Draw
                            </button>
                            <button class="btn btn-secondary" onclick="window.resetTournamentPrompt()" style="color: #ef4444;" title="Reset / Delete tournament">
                                <i class="fa-solid fa-trash"></i> Reset
                            </button>
                        `}
                    </div>
                </div>
            </div>

            <!-- ADMIN SUB-NAVIGATION TABS -->
            <div style="display: flex; gap: 8px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px; flex-wrap: wrap;">
                <button class="btn ${activeTab === 'roster' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchAdminChampTab('roster')">
                    <i class="fa-solid fa-users"></i> 1. Competitors Roster (${participants.length}/60)
                </button>
                <button class="btn ${activeTab === 'schedules' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchAdminChampTab('schedules')">
                    <i class="fa-regular fa-clock"></i> 2. Unified Round Schedules
                </button>
                <button class="btn ${activeTab === 'questions' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchAdminChampTab('questions')">
                    <i class="fa-solid fa-file-circle-question"></i> 3. Unified Question Sets
                </button>
                <button class="btn ${activeTab === 'bracket' ? 'btn-primary' : 'btn-secondary'}" onclick="window.switchAdminChampTab('bracket')">
                    <i class="fa-solid fa-diagram-project"></i> 4. Bracket Tree & Operations (${matches.length} Matches)
                </button>
            </div>

            <!-- SUB-TAB CONTENT PANES -->
            <div>
                ${activeTab === 'roster' ? renderAdminRosterTabHtml() : ''}
                ${activeTab === 'schedules' ? renderAdminSchedulesTabHtml() : ''}
                ${activeTab === 'questions' ? renderAdminQuestionsTabHtml() : ''}
                ${activeTab === 'bracket' ? renderAdminBracketTabHtml() : ''}
            </div>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * ADMIN SUB-TAB 1: Competitors Roster (Up to 60 Players)
 */
function renderAdminRosterTabHtml() {
    const champ = champState.activeChampionship;
    const participants = champState.participants || [];
    const query = (champState.rosterSearchQuery || '').toLowerCase().trim();
    const filteredRoster = query 
        ? participants.filter(p => p.email.toLowerCase().includes(query) || (p.student_name || '').toLowerCase().includes(query))
        : participants;

    return `
        <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- TOURNAMENT TITLE & METRICS -->
            <div class="card" style="padding: 20px; border-radius: 14px; background: var(--bg-secondary);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <h4 style="margin: 0 0 4px 0; color: var(--text-primary); font-size: 1.05rem;">
                            Tournament Title: <strong>${champ?.title || 'Not Created Yet'}</strong>
                        </h4>
                        <span style="font-size: 0.85rem; color: var(--text-muted);">
                            Course Track: <strong>${((champ?.group_name) || getActiveGroupName() || 'Infection').toUpperCase()}</strong> | Maximum Capacity: <strong>60 Competitors</strong>
                        </span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" onclick="window.editTournamentTitlePrompt()">
                            <i class="fa-solid fa-pen"></i> Edit Title
                        </button>
                    </div>
                </div>
            </div>

            <!-- ADD COMPETITOR FORMS (SINGLE & BULK) -->
            <div class="card" style="padding: 22px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
                <h4 style="margin: 0 0 14px 0; font-size: 1.05rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-user-plus" style="color: var(--primary-color);"></i> Add Competitor (Single or Bulk)
                </h4>

                <!-- Single Add Form -->
                <form onsubmit="window.addParticipantFormSubmit(event)" style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px;">
                    <div style="flex: 1; min-width: 200px;">
                        <label style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 4px;">Student Name (اسم الطالب)</label>
                        <input type="text" id="champ-input-student-name" class="form-control" placeholder="e.g. Dr. Ahmed Ali" required style="width: 100%; border-radius: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); height: 40px; padding: 0 12px;">
                    </div>
                    <div style="flex: 1.2; min-width: 220px;">
                        <label style="font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); display: block; margin-bottom: 4px;">Gmail Address (البريد الإلكتروني)</label>
                        <input type="email" id="champ-input-student-email" class="form-control" placeholder="student@gmail.com" required style="width: 100%; border-radius: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); height: 40px; padding: 0 12px;">
                    </div>
                    <button type="submit" class="btn btn-primary" style="height: 40px; padding: 0 18px;" ${participants.length >= 60 ? 'disabled' : ''}>
                        <i class="fa-solid fa-plus"></i> Add
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="window.openBulkImportModal()" style="height: 40px; padding: 0 18px;" ${participants.length >= 60 ? 'disabled' : ''}>
                        <i class="fa-solid fa-paste"></i> Bulk Paste List
                    </button>
                </form>

                <div style="font-size: 0.85rem; color: var(--text-muted);">
                    <i class="fa-solid fa-info-circle"></i> Names are stored independently and will not be overwritten by emails. Max allowed: 60 students.
                </div>
            </div>

            <!-- ROSTER TABLE CARD -->
            <div class="card" style="padding: 22px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
                    <div style="position: relative; flex-grow: 1; max-width: 380px;">
                        <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 14px; top: 12px; color: var(--text-muted);"></i>
                        <input type="text" class="form-control" placeholder="Search candidate by name or email..." 
                               value="${champState.rosterSearchQuery || ''}" 
                               oninput="window.filterRosterSearch(this.value)"
                               style="padding-left: 38px; width: 100%; border-radius: 10px; background: var(--bg-primary); border: 1px solid var(--border-color); color: var(--text-primary); height: 40px;">
                    </div>

                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; font-size: 0.88rem; padding: 6px 12px; border-radius: 8px; font-weight: 700;">
                            ${participants.length} / 60 Competitors
                        </span>
                        ${participants.length > 0 ? `
                            <button class="btn btn-danger btn-sm" onclick="window.clearAllParticipantsPrompt()" style="padding: 6px 12px;">
                                <i class="fa-solid fa-trash"></i> Clear Roster
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- TABLE -->
                <div style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: 12px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: var(--bg-primary); border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">
                                <th style="padding: 12px 16px; width: 50px;">#</th>
                                <th style="padding: 12px 16px; width: 70px;">Seed #</th>
                                <th style="padding: 12px 16px;">Student Name</th>
                                <th style="padding: 12px 16px;">Email Address</th>
                                <th style="padding: 12px 16px; width: 120px;">Status</th>
                                <th style="padding: 12px 16px; width: 180px; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredRoster.length === 0 ? `
                                <tr>
                                    <td colspan="6" style="padding: 40px 16px; text-align: center; color: var(--text-muted);">
                                        <i class="fa-solid fa-user-group" style="font-size: 2rem; margin-bottom: 10px; display: block; opacity: 0.5;"></i>
                                        No competitors registered yet. Add students above (up to 60) and then generate the draw!
                                    </td>
                                </tr>
                            ` : filteredRoster.map((p, idx) => `
                                <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.15s;">
                                    <td style="padding: 12px 16px; font-weight: 700; color: var(--text-muted);">${idx + 1}</td>
                                    <td style="padding: 12px 16px; font-weight: 700; color: var(--primary-color);">Seed ${p.seed_number || (idx + 1)}</td>
                                    <td style="padding: 12px 16px; font-weight: 600; color: var(--text-primary);">${p.student_name}</td>
                                    <td style="padding: 12px 16px; color: var(--text-secondary); font-family: monospace;">${p.email}</td>
                                    <td style="padding: 12px 16px;">
                                        <span class="badge" style="background: ${p.eliminated ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${p.eliminated ? '#ef4444' : '#10b981'}; font-weight: 700; padding: 4px 8px; border-radius: 6px;">
                                            ${p.eliminated ? 'Eliminated' : 'Active'}
                                        </span>
                                    </td>
                                    <td style="padding: 12px 16px; text-align: right;">
                                        <div style="display: flex; gap: 6px; justify-content: flex-end;">
                                            <button class="btn btn-secondary" onclick="window.editParticipantPrompt('${p.id}')" style="padding: 4px 10px; font-size: 0.8rem; border-radius: 6px;" title="Edit Name and Email independently">
                                                <i class="fa-solid fa-pen"></i> Edit
                                            </button>
                                            <button class="btn btn-secondary" onclick="window.removeParticipant('${p.id}')" style="padding: 4px 10px; font-size: 0.8rem; border-radius: 6px; color: #ef4444;" title="Remove competitor">
                                                <i class="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * ADMIN SUB-TAB 2: Unified Round Exam Schedules
 * Sets the exact exam time for each round
 */
function renderAdminSchedulesTabHtml() {
    const champ = champState.activeChampionship;
    const schedules = champ?.round_schedules || {};
    const rosterCount = champState.participants?.length || 0;
    const activeRequiredRounds = rosterCount >= 2 ? getRequiredRoundsForSize(rosterCount) : ALL_ROUNDS.map(r => r.key);

    return `
        <div class="card" style="padding: 24px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 6px 0; font-size: 1.15rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-regular fa-clock" style="color: #f59e0b;"></i> Unified Round Exam Schedules (مواعيد الجولات الموحدة)
                </h4>
                <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary);">
                    Set a unified start date & time for each round. All matches in that round will begin simultaneously at the specified schedule.
                    ${rosterCount >= 2 ? `<span style="display: block; margin-top: 4px; color: #10b981; font-weight: 700;">🎯 Active Roster: ${rosterCount} Competitors (${activeRequiredRounds.length} Rounds Required for Bracket)</span>` : ''}
                </p>
            </div>

            <form onsubmit="window.saveRoundSchedulesForm(event)" style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
                    ${ALL_ROUNDS.map(r => {
                        const isRequired = activeRequiredRounds.includes(r.key);
                        const val = schedules[r.key] ? schedules[r.key].substring(0, 16) : '';
                        return `
                            <div style="background: var(--bg-primary); padding: 14px 16px; border-radius: 12px; border: 1.5px solid ${isRequired ? '#f59e0b' : 'var(--border-color)'};">
                                <label style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; font-size: 0.9rem;">
                                    <span>${r.label}</span>
                                    <span class="badge" style="background: ${isRequired ? 'rgba(245, 158, 11, 0.15)' : 'rgba(156, 163, 175, 0.15)'}; color: ${isRequired ? '#f59e0b' : '#9ca3af'}; font-size: 0.75rem;">
                                        ${isRequired ? 'Required for Bracket' : 'Not in Current Roster'}
                                    </span>
                                </label>
                                <input type="datetime-local" id="sched-input-${r.key}" class="form-control" value="${val}" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px;">
                            </div>
                        `;
                    }).join('')}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px;">
                    <button type="submit" class="btn btn-primary" style="padding: 10px 24px;">
                        <i class="fa-solid fa-save"></i> Save & Apply Schedules to Bracket
                    </button>
                </div>
            </form>
        </div>
    `;
}

/**
 * ADMIN SUB-TAB 3: Unified Question Sets per Round
 * Upload or assign questions for each round
 */
function renderAdminQuestionsTabHtml() {
    const champ = champState.activeChampionship;
    const roundQuestions = champ?.round_questions || {};
    const rosterCount = champState.participants?.length || 0;
    const activeRequiredRounds = rosterCount >= 2 ? getRequiredRoundsForSize(rosterCount) : ALL_ROUNDS.map(r => r.key);

    return `
        <div class="card" style="padding: 24px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 6px 0; font-size: 1.15rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-file-circle-question" style="color: #10b981;"></i> Unified Round Question Sets (أسئلة الجولات الموحدة)
                </h4>
                <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary);">
                    Upload or pick synchronized questions for each round. All students competing in that round will answer the exact same question set!
                    ${rosterCount >= 2 ? `<span style="display: block; margin-top: 4px; color: #10b981; font-weight: 700;">🎯 Active Roster: ${rosterCount} Competitors (${activeRequiredRounds.length} Active Rounds)</span>` : ''}
                </p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 16px;">
                ${ALL_ROUNDS.map(r => {
                    const isRequired = activeRequiredRounds.includes(r.key);
                    const qList = roundQuestions[r.key] || [];
                    const qCount = qList.length;

                    return `
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; padding: 16px 20px; background: var(--bg-primary); border-radius: 12px; border: 1.5px solid ${isRequired ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)'};">
                            <div>
                                <h5 style="margin: 0 0 4px 0; font-size: 1rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                                    ${r.label}
                                    <span class="badge" style="background: ${qCount > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${qCount > 0 ? '#10b981' : '#ef4444'}; font-size: 0.75rem; padding: 3px 8px; border-radius: 6px;">
                                        ${qCount > 0 ? `${qCount} Questions Loaded` : 'Empty (Course Default)'}
                                    </span>
                                    <span class="badge" style="background: ${isRequired ? 'rgba(59, 130, 246, 0.15)' : 'rgba(156, 163, 175, 0.15)'}; color: ${isRequired ? '#3b82f6' : '#9ca3af'}; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px;">
                                        ${isRequired ? 'Active in Tournament' : 'Inactive'}
                                    </span>
                                </h5>
                                <span style="font-size: 0.82rem; color: var(--text-muted);">
                                    ${qCount > 0 ? 'All matches in this round will strictly present these uploaded questions.' : 'When empty, matches fall back to random topics from the question bank.'}
                                </span>
                            </div>

                            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                <button class="btn btn-secondary btn-sm" onclick="window.openUploadQuestionsModal('${r.key}')">
                                    <i class="fa-solid fa-upload"></i> Upload MCQs (JSON/CSV)
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="window.promptPickRoundQuestions('${r.key}')">
                                    <i class="fa-solid fa-shuffle"></i> Pick from Bank
                                </button>
                                ${qCount > 0 ? `
                                    <button class="btn btn-secondary btn-sm" onclick="window.viewRoundQuestionsModal('${r.key}')">
                                        <i class="fa-solid fa-pen-to-square"></i> Preview & Edit (${qCount})
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.clearRoundQuestions('${r.key}')" style="color: #ef4444;">
                                        <i class="fa-solid fa-trash"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * ADMIN SUB-TAB 4: Bracket Tree & Emergency Match Operations
 */
function renderAdminBracketTabHtml() {
    const matches = champState.matches || [];

    if (matches.length === 0) {
        return `
            <div class="card" style="padding: 60px 20px; text-align: center; border-radius: 14px; background: var(--bg-secondary);">
                <i class="fa-solid fa-diagram-project" style="font-size: 3rem; color: var(--text-muted); opacity: 0.5; margin-bottom: 16px;"></i>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">No Bracket Generated Yet</h3>
                <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 20px auto;">
                    Register your competitors in Tab 1, configure round schedules in Tab 2, and then click "Generate Bracket Draw" to build the tournament tree.
                </p>
                <button class="btn btn-primary" onclick="window.generateBracketFromAdmin()" style="background: #8b5cf6; border-color: #8b5cf6;">
                    <i class="fa-solid fa-shuffle"></i> Generate Bracket Draw
                </button>
            </div>
        `;
    }

    const totalM = matches.length;
    const completedM = matches.filter(m => m.status === 'completed').length;
    const forfeitM = matches.filter(m => m.status === 'forfeit' || m.status === 'double_forfeit' || (m.score_text && m.score_text.includes('انسحاب'))).length;
    const liveM = matches.filter(m => m.status === 'in_progress' || (m.match_meta?.p1_entered && m.match_meta?.p2_entered && m.status !== 'completed')).length;
    const waitingM = matches.filter(m => (m.match_meta?.p1_entered || m.match_meta?.p2_entered) && m.status !== 'completed' && !(m.match_meta?.p1_entered && m.match_meta?.p2_entered)).length;

    return `
        <div style="display: flex; flex-direction: column; gap: 24px;">
            <!-- LIVE ROUND OPERATIONS SUMMARY RIBBON -->
            <div class="card" style="padding: 16px 20px; border-radius: 14px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(139, 92, 246, 0.08)); border: 1.5px solid rgba(59, 130, 246, 0.25); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 42px; height: 42px; border-radius: 10px; background: #3b82f6; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
                        <i class="fa-solid fa-tower-broadcast"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--text-primary);">
                            غرفة المراقبة والتحكم المباشر في مباريات البطولة
                        </h4>
                        <p style="margin: 2px 0 0 0; font-size: 0.82rem; color: var(--text-secondary);">
                            متابعة حية لحالة كافة مباريات الجولة المتزامنة وتحديث النتائج لحظياً
                        </p>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="background: var(--bg-primary); padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: #3b82f6;">${totalM}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">إجمالي المباريات</div>
                    </div>
                    <div style="background: var(--bg-primary); padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: #10b981;">${completedM}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">مكتملة ومحسومة</div>
                    </div>
                    <div style="background: var(--bg-primary); padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: #f59e0b;">${liveM}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">جارية الآن</div>
                    </div>
                    <div style="background: var(--bg-primary); padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: #8b5cf6;">${waitingM}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">بانتظار المنافس</div>
                    </div>
                    <div style="background: var(--bg-primary); padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <div style="font-size: 1.15rem; font-weight: 900; color: #ef4444;">${forfeitM}</div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">انسحاب / غياب</div>
                    </div>
                </div>
            </div>

            <!-- BRACKET VISUAL TREE -->
            <div class="card" style="padding: 24px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
                <h4 style="margin: 0 0 16px 0; font-size: 1.15rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-diagram-project" style="color: #8b5cf6;"></i> Tournament Visual Bracket Tree
                </h4>
                ${renderVisualBracketTreeHtml(null)}
            </div>

            <!-- EMERGENCY MATCH OPERATIONS TABLE -->
            <div class="card" style="padding: 24px; border-radius: 14px; background: var(--bg-secondary); border: 1px solid var(--border-color);">
                <h4 style="margin: 0 0 14px 0; font-size: 1.15rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-clock-rotate-left" style="color: #f59e0b;"></i> Match Operations & Replay Utility
                </h4>
                <p style="margin: 0 0 16px 0; font-size: 0.88rem; color: var(--text-secondary);">
                    In case of a student technical disconnect or schedule change, you can replay or reschedule any match individually:
                </p>

                <div style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: 12px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
                        <thead>
                            <tr style="background: var(--bg-primary); border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">
                                <th style="padding: 10px 14px;">Round</th>
                                <th style="padding: 10px 14px;">Match</th>
                                <th style="padding: 10px 14px;">Player 1</th>
                                <th style="padding: 10px 14px;">Player 2</th>
                                <th style="padding: 10px 14px;">Scheduled Time</th>
                                <th style="padding: 10px 14px;">Status</th>
                                <th style="padding: 10px 14px; text-align: right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${matches.map(m => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-weight: 700; color: var(--text-primary);">${ROUND_LABELS[m.round_name] || m.round_name}</td>
                                    <td style="padding: 10px 14px; color: var(--text-muted);">#${m.match_order}</td>
                                    <td style="padding: 10px 14px; font-weight: 600;">${m.player1_info ? m.player1_info.student_name : 'TBD'}</td>
                                    <td style="padding: 10px 14px; font-weight: 600;">${m.player2_info ? m.player2_info.student_name : 'TBD'}</td>
                                    <td style="padding: 10px 14px; color: var(--text-secondary);">${new Date(m.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td style="padding: 10px 14px;">
                                        <span class="badge" style="background: ${m.status === 'completed' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${m.status === 'completed' ? '#10b981' : '#f59e0b'}; font-weight: 700; padding: 2px 6px; border-radius: 4px;">
                                            ${m.status}
                                        </span>
                                    </td>
                                    <td style="padding: 10px 14px; text-align: right;">
                                        <div style="display: flex; gap: 4px; justify-content: flex-end;">
                                            <button class="btn btn-secondary btn-sm" onclick="window.replayMatchPrompt('${m.id}')" title="Reset and replay match">
                                                <i class="fa-solid fa-rotate-left"></i> Replay
                                            </button>
                                            <button class="btn btn-secondary btn-sm" onclick="window.rescheduleSingleMatchPrompt('${m.id}')" title="Reschedule single match">
                                                <i class="fa-regular fa-clock"></i> Time
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render Student Match Banner (Count-down and Direct Launch)
 */
function renderStudentMatchBanner(userEmail) {
    const userParticipant = (champState.participants || []).find(p => p.email.toLowerCase().trim() === userEmail);

    // CASE 1: Non-Participant (Spectator Mode)
    if (!userParticipant) {
        return `
            <div class="card" style="padding: 20px 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(16, 185, 129, 0.08)); border: 1.5px solid #3b82f6;">
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(59, 130, 246, 0.15); color: #3b82f6; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
                        <i class="fa-solid fa-eye"></i>
                    </div>
                    <div style="flex-grow: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--text-primary);">وضع المشاهدة الحية (Live Spectator Mode)</h3>
                            <span class="badge" style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">مشاهد فقط</span>
                        </div>
                        <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5;">
                            أنت غير مسجل كمتسابق في هذه البطولة. يمكنك متابعة جدول المباريات اليومية، النتائج المباشرة للمتنافسين، وشجرة التصفيات المحدثة لحظياً.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    // CASE 2: Eliminated Participant
    if (userParticipant.eliminated) {
        return `
            <div class="card" style="padding: 20px 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.08)); border: 1.5px solid #ef4444;">
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
                        <i class="fa-solid fa-flag-checkered"></i>
                    </div>
                    <div style="flex-grow: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #ef4444;">تم توديع البطولة (Eliminated)</h3>
                            <span class="badge" style="background: #ef4444; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">خروج المغلوب</span>
                        </div>
                        <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5;">
                            ${userParticipant.elimination_reason ? `<strong style="color: #ef4444;">سبب الاستبعاد: ${userParticipant.elimination_reason}</strong> &bull; ` : ''}لقد انتهت مشاركتك في البطولة بشرف. يمكنك الاستمتاع بمتابعة باقي الأدوار والتصفيات كمشاهد 👁️.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    // CASE 3: Has won the tournament final?
    const finalMatch = (champState.matches || []).find(m => m.round_name === 'final');
    if (finalMatch && finalMatch.status === 'completed' && finalMatch.winner_id === userParticipant.id) {
        return `
            <div class="card" style="padding: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(16, 185, 129, 0.15)); border: 2px solid #f59e0b; box-shadow: 0 8px 30px rgba(245, 158, 11, 0.25);">
                <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
                    <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; display: flex; align-items: center; justify-content: center; font-size: 2.2rem; flex-shrink: 0; box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);">
                        👑
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span class="badge" style="background: #f59e0b; color: white; font-weight: 800; padding: 3px 10px; border-radius: 6px;">بطل الدوري الطبي الرسمي 🏆</span>
                        </div>
                        <h3 style="margin: 0; font-size: 1.35rem; font-weight: 900; color: var(--text-primary);">
                            ألف مبروك د. ${userParticipant.student_name}!
                        </h3>
                        <p style="margin: 4px 0 0 0; font-size: 0.92rem; color: var(--text-secondary); line-height: 1.5;">
                            لقد انتصرت في المباراة النهائية وتوجت رسمياً بلقب بطولة دوري الهاواري للطب الباطني والأمراض المعدية!
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    // CASE 4: Active Competitor
    const match = champState.currentStudentMatch;
    if (!match) {
        const myMatches = (champState.matches || []).filter(m => 
            (m.player1_id === userParticipant.id || m.player2_id === userParticipant.id)
        );
        const hasCompletedAll = myMatches.length > 0 && myMatches.every(m => m.status === 'completed' && m.winner_id === userParticipant.id);

        return `
            <div class="card" style="padding: 20px 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(245, 158, 11, 0.08)); border: 1.5px solid #10b981;">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(16, 185, 129, 0.15); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
                        <i class="fa-solid fa-hourglass-half"></i>
                    </div>
                    <div>
                        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #10b981;">
                            ${hasCompletedAll ? '🌟 فوز وتأهل للدور القادم!' : '🌟 مرحباً د. ' + userParticipant.student_name}
                        </h3>
                        <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-secondary);">
                            ${hasCompletedAll ? 'لقد فزت بمباراتك وتأهلت بنجاح! بانتظار اكتمال بقية مباريات هذا الدور لتحديد منافسك وموعد مباراتك القادمة.' : 'أنت متأهل مباشرة (Bye) أو بانتظار اكتمال نتائج مباريات الدور السابق لتحديد منافسك القادم.'}
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    const isP1 = (match.player1_id === userParticipant.id);
    const opponent = isP1 ? match.player2_info : match.player1_info;
    const opponentSeed = opponent ? (opponent.seed_number ? `#${opponent.seed_number}` : '') : '';

    // Check if opponent is determined or pending
    let opponentName = '';
    let opponentSubText = '';
    if (opponent && opponent.student_name && !opponent.isPlaceholder && !opponent.eliminated) {
        opponentName = `د. ${opponent.student_name}`;
        opponentSubText = opponentSeed ? `(المصنف ${opponentSeed})` : '';
    } else {
        const feederSlot = isP1 ? 2 : 1;
        const feederMatch = (champState.matches || []).find(m => m.next_match_id === match.id && m.next_match_slot === feederSlot);
        if (feederMatch) {
            const fP1 = feederMatch.player1_info?.student_name || 'متسابق 1';
            const fP2 = feederMatch.player2_info?.student_name || 'متسابق 2';
            opponentName = `بانتظار الفائز من مباراة #${feederMatch.match_order}`;
            opponentSubText = `(بين د. ${fP1} و د. ${fP2})`;
        } else {
            opponentName = 'بانتظار تحديد المنافس من الأدوار السابقة';
        }
    }

    const scheduledDate = new Date(match.scheduled_start);
    const now = new Date();
    const diffMs = scheduledDate.getTime() - now.getTime();
    const PREP_WINDOW_MS = 5 * 60 * 1000;
    const isPrepOpen = diffMs <= PREP_WINDOW_MS;
    const isPastStart = diffMs <= 0;
    const isLive = isPastStart && match.status !== 'completed' && match.status !== 'double_forfeit';

    // Detailed Date & Time formatting (Arabic + English)
    const optionsDateAr = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    let dateFormattedAr = '';
    let timeFormattedAr = '';
    try {
        dateFormattedAr = scheduledDate.toLocaleDateString('ar-EG', optionsDateAr);
        timeFormattedAr = scheduledDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch(e) {
        dateFormattedAr = scheduledDate.toDateString();
        timeFormattedAr = scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const fullTimeEn = scheduledDate.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

    let bannerBtnHtml = '';
    if (isLive) {
        bannerBtnHtml = `
            <button id="btn-enter-champ-match" class="btn btn-primary btn-lg" onclick="window.enterChampionshipMatch('${match.id}')" style="animation: pulseGlow 1.5s infinite; background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 800;">
                <i class="fa-solid fa-bolt"></i> ادخل غرفة المباراة الآن ⚡
            </button>
        `;
    } else if (isPrepOpen) {
        bannerBtnHtml = `
            <button id="btn-enter-champ-match" class="btn btn-primary btn-lg" onclick="window.enterChampionshipMatch('${match.id}')" style="background: linear-gradient(135deg, #f59e0b, #d97706); border: none; font-weight: 800;">
                <i class="fa-solid fa-clock"></i> ادخل للاستعداد للمباراة ⏳
            </button>
        `;
    } else {
        bannerBtnHtml = `
            <button id="btn-enter-champ-match" class="btn btn-secondary btn-lg" disabled style="opacity: 0.65; cursor: not-allowed; background: #475569; border: none; font-weight: 700;">
                <i class="fa-solid fa-lock"></i> تفتح قبل الموعد بـ 5 دقائق
            </button>
        `;
    }

    return `
        <div class="card" style="padding: 24px; border-radius: 16px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.08)); border: 1.5px solid #ef4444; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span class="badge" style="background: #ef4444; color: white; font-weight: 700; padding: 3px 10px; border-radius: 6px;">مباراتك القادمة الرسمية</span>
                        <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 3px 10px; border-radius: 6px;">${ROUND_LABELS[match.round_name] || match.round_name}</span>
                    </div>
                    <h3 style="margin: 0 0 6px 0; font-size: 1.3rem; font-weight: 800; color: var(--text-primary);">
                        المنافس: <span style="color: ${opponent ? '#ef4444' : '#f59e0b'};">${opponentName}</span> ${opponentSubText ? `<small style="font-size: 0.85rem; color: var(--text-muted); font-weight: normal; margin-right: 6px;">${opponentSubText}</small>` : ''}
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 3px; font-size: 0.9rem; color: var(--text-secondary);">
                        <div>
                            <i class="fa-regular fa-calendar-check" style="color: var(--primary-color);"></i>
                            <strong>موعد المباراة:</strong> ${dateFormattedAr} &bull; الساعة <strong>${timeFormattedAr}</strong>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); font-family: monospace;">
                            (${fullTimeEn}) &bull; مباراة رقم #${match.match_order}
                        </div>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <div style="text-align: right;">
                        <span style="font-size: 0.8rem; color: var(--text-muted); display: block;">حالة العداد التنازلي</span>
                        <strong id="champ-match-countdown-text" style="font-size: 1.15rem; color: ${isLive ? '#10b981' : (isPrepOpen ? '#f59e0b' : '#ef4444')}; font-weight: 800;">
                            ${isLive ? '⚡ المباراة بدأت الآن!' : `تبدأ خلال: ${formatRemainingTime(diffMs)}`}
                        </strong>
                    </div>

                    ${bannerBtnHtml}
                </div>
            </div>
        </div>
    `;
}

/**
 * Render Today's Fixtures List (Student View)
 */
function renderTodayFixturesHtml(userEmail) {
    const matches = champState.matches || [];
    if (matches.length === 0) {
        return `
            <div class="empty-state" style="padding: 40px; text-align: center;">
                <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; color: var(--text-muted); margin-bottom: 12px;"></i>
                <h4 style="color: var(--text-primary);">No Matches Scheduled</h4>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Check back soon for upcoming tournament pairings.</p>
            </div>
        `;
    }

    // Group matches by round
    const grouped = {};
    matches.forEach(m => {
        if (!grouped[m.round_name]) grouped[m.round_name] = [];
        grouped[m.round_name].push(m);
    });

    return `
        <div style="display: flex; flex-direction: column; gap: 24px;">
            ${Object.keys(grouped).map(roundKey => `
                <div class="round-fixtures-group">
                    <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-layer-group" style="color: var(--primary-color);"></i>
                        ${ROUND_LABELS[roundKey] || roundKey}
                    </h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px;">
                        ${grouped[roundKey].map(m => renderSingleMatchCardHtml(m, userEmail)).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Render Single Match Card HTML
 */
function renderSingleMatchCardHtml(m, userEmail) {
    const isUserMatch = (
        (m.player1_info && m.player1_info.email && m.player1_info.email.toLowerCase() === userEmail) ||
        (m.player2_info && m.player2_info.email && m.player2_info.email.toLowerCase() === userEmail)
    );

    const isLive = m.status === 'in_progress';
    const isCompleted = m.status === 'completed';
    const isDoubleForfeit = m.status === 'double_forfeit';

    const schedTime = m.scheduled_start ? new Date(m.scheduled_start).getTime() : 0;
    const now = Date.now();
    const diffToSched = schedTime - now;
    const PREP_WINDOW_MS = 5 * 60 * 1000;
    const isPrepOpen = diffToSched <= PREP_WINDOW_MS;
    const isPastStart = diffToSched <= 0;

    const userParticipant = (champState.participants || []).find(p => p.email.toLowerCase().trim() === userEmail);
    const userIsEliminated = !!userParticipant?.eliminated;
    const canEnter = isUserMatch && !isCompleted && !isDoubleForfeit && !userIsEliminated;

    return `
        <div class="card match-card" style="padding: 16px 20px; border-radius: 14px; background: var(--bg-secondary); border: ${isUserMatch ? '2px solid var(--primary-color)' : (isDoubleForfeit ? '1px dashed #ef4444' : '1px solid var(--border-color)')}; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Match #${m.match_order}</span>
                <span class="badge" style="background: ${isCompleted ? 'rgba(16, 185, 129, 0.15)' : (isDoubleForfeit ? 'rgba(239, 68, 68, 0.15)' : (isLive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'))}; color: ${isCompleted ? '#10b981' : (isDoubleForfeit ? '#ef4444' : (isLive ? '#ef4444' : '#f59e0b'))}; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 6px;">
                    ${isCompleted ? 'COMPLETED' : (isDoubleForfeit ? 'استبعاد للغياب' : (isLive ? 'LIVE' : new Date(m.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })))}
                </span>
            </div>

            <!-- PLAYER 1 -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--border-color);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 26px; height: 26px; border-radius: 50%; background: var(--primary-color-soft); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700;">
                        ${m.player1_info ? m.player1_info.student_name.slice(0, 1).toUpperCase() : '?'}
                    </div>
                    <span style="font-weight: ${m.winner_id === m.player1_id ? '800' : '600'}; color: ${isDoubleForfeit ? '#ef4444' : 'var(--text-primary)'}; font-size: 0.9rem;">
                        ${m.player1_info ? m.player1_info.student_name : 'TBD'}
                    </span>
                </div>
                <strong style="font-size: 1rem; color: ${m.winner_id === m.player1_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-muted)')};">${isDoubleForfeit ? '—' : (m.p1_score || 0)}</strong>
            </div>

            <!-- PLAYER 2 -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; margin-top: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 26px; height: 26px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); color: #f59e0b; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700;">
                        ${m.player2_info ? m.player2_info.student_name.slice(0, 1).toUpperCase() : '?'}
                    </div>
                    <span style="font-weight: ${m.winner_id === m.player2_id ? '800' : '600'}; color: ${isDoubleForfeit ? '#ef4444' : 'var(--text-primary)'}; font-size: 0.9rem;">
                        ${m.player2_info ? m.player2_info.student_name : 'TBD'}
                    </span>
                </div>
                <strong style="font-size: 1rem; color: ${m.winner_id === m.player2_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-muted)')};">${isDoubleForfeit ? '—' : (m.p2_score || 0)}</strong>
            </div>

            ${m.score_text ? `
                <div style="margin-top: 8px; text-align: center; font-size: 0.76rem; color: ${isDoubleForfeit ? '#ef4444' : '#10b981'}; font-weight: 700;">
                    ${m.score_text}
                </div>
            ` : ''}

            ${canEnter ? `
                <div style="margin-top: 12px; text-align: center;">
                    ${!isPrepOpen ? `
                        <button class="btn btn-secondary btn-sm btn-block" disabled style="font-size: 0.8rem; padding: 6px 12px; opacity: 0.65; cursor: not-allowed; background: #475569; border: none;">
                            <i class="fa-solid fa-lock"></i> تفتح قبل الموعد بـ 5 دقائق
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-sm btn-block" onclick="window.enterChampionshipMatch('${m.id}')" style="font-size: 0.8rem; padding: 6px 12px; ${isPastStart ? 'background: linear-gradient(135deg, #10b981, #059669);' : 'background: linear-gradient(135deg, #f59e0b, #d97706);'}; border: none;">
                            <i class="fa-solid ${isPastStart ? 'fa-bolt' : 'fa-clock'}"></i> ${isPastStart ? 'ادخل مباراتك الآن ⚡' : 'ادخل للاستعداد ⏳'}
                        </button>
                    `}
                </div>
            ` : (isUserMatch && userIsEliminated ? `
                <div style="margin-top: 8px; text-align: center; font-size: 0.78rem; color: #ef4444; font-weight: 700;">
                    <i class="fa-solid fa-ban"></i> تم الإقصاء (Eliminated)
                </div>
            ` : '')}
        </div>
    `;
}

/**
 * Render Interactive Visual Bracket Tree
 */
function renderVisualBracketTreeHtml(userEmail) {
    const matches = champState.matches || [];
    if (matches.length === 0) {
        return `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No bracket matches loaded.</div>`;
    }

    const roundKeys = [
        ROUND_NAMES.PRELIMINARY,
        ROUND_NAMES.ROUND_64,
        ROUND_NAMES.ROUND_32,
        ROUND_NAMES.ROUND_16,
        ROUND_NAMES.QUARTER,
        ROUND_NAMES.SEMI,
        ROUND_NAMES.FINAL
    ];

    const activeRounds = roundKeys.filter(rKey => matches.some(m => m.round_name === rKey));

    return `
        <div class="bracket-tree-scroll-container" style="overflow-x: auto; padding: 20px 0;">
            <div style="display: flex; gap: 32px; min-width: ${activeRounds.length * 260}px; align-items: flex-start;">
                ${activeRounds.map(rKey => {
                    const roundMatches = matches.filter(m => m.round_name === rKey);
                    return `
                        <div class="bracket-column" style="flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 16px;">
                            <div style="text-align: center; padding: 8px 12px; background: var(--bg-primary); border-radius: 10px; border: 1px solid var(--border-color); font-weight: 700; font-size: 0.88rem; color: var(--text-primary);">
                                ${ROUND_LABELS[rKey] || rKey}
                                <span style="font-size: 0.75rem; color: var(--text-muted); display: block; font-weight: 400;">(${roundMatches.length} Matches)</span>
                            </div>
                            <div style="display: flex; flex-direction: column; justify-content: space-around; gap: 20px; flex-grow: 1;">
                                ${roundMatches.map(m => renderBracketNodeHtml(m, userEmail)).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

/**
 * Render Individual Bracket Node
 */
function renderBracketNodeHtml(m, userEmail) {
    const isUser = (
        (m.player1_info && m.player1_info.email && m.player1_info.email.toLowerCase() === userEmail) ||
        (m.player2_info && m.player2_info.email && m.player2_info.email.toLowerCase() === userEmail)
    );
    const isDoubleForfeit = m.status === 'double_forfeit';

    return `
        <div class="bracket-node" style="background: var(--bg-primary); border: ${isUser ? '2px solid var(--primary-color)' : (isDoubleForfeit ? '1px dashed #ef4444' : '1px solid var(--border-color)')}; border-radius: 10px; padding: 8px 12px; font-size: 0.82rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; margin-bottom: 4px;">
                <span style="font-weight: 600; color: ${m.winner_id === m.player1_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-primary)')}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                    ${m.player1_info ? m.player1_info.student_name : 'TBD'}
                </span>
                <span style="font-weight: 700; color: ${m.winner_id === m.player1_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-muted)')};">${isDoubleForfeit ? '—' : (m.p1_score || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: ${m.winner_id === m.player2_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-primary)')}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                    ${m.player2_info ? m.player2_info.student_name : 'TBD'}
                </span>
                <span style="font-weight: 700; color: ${m.winner_id === m.player2_id ? '#10b981' : (isDoubleForfeit ? '#ef4444' : 'var(--text-muted)')};">${isDoubleForfeit ? '—' : (m.p2_score || 0)}</span>
            </div>
            ${isDoubleForfeit ? `
                <div style="text-align: center; font-size: 0.7rem; color: #ef4444; font-weight: 700; margin-top: 4px; border-top: 1px dashed rgba(239,68,68,0.3); padding-top: 2px;">
                    استبعاد الطرفين للغياب
                </div>
            ` : (m.status === 'completed' && m.score_text?.includes('انسحاب') ? `
                <div style="text-align: center; font-size: 0.7rem; color: #10b981; font-weight: 700; margin-top: 4px; border-top: 1px dashed rgba(16,185,129,0.3); padding-top: 2px;">
                    فوز بالانسحاب 🏆
                </div>
            ` : '')}
        </div>
    `;
}

export function findUserNextMatch(userEmail) {
    if (!userEmail) return null;
    const cleanEmail = userEmail.toLowerCase().trim();
    const matches = champState.matches || [];

    const ROUND_ORDER_WEIGHT = {
        'preliminary': 1,
        'round_64': 2,
        'round_32': 3,
        'round_16': 4,
        'quarter': 5,
        'semi': 6,
        'final': 7
    };

    const sortedMatches = [...matches].sort((a, b) => {
        const wA = ROUND_ORDER_WEIGHT[a.round_name] || 99;
        const wB = ROUND_ORDER_WEIGHT[b.round_name] || 99;
        if (wA !== wB) return wA - wB;
        return (a.match_order || 0) - (b.match_order || 0);
    });

    return sortedMatches.find(m => {
        const isP1 = (m.player1_info && m.player1_info.email && m.player1_info.email.toLowerCase().trim() === cleanEmail);
        const isP2 = (m.player2_info && m.player2_info.email && m.player2_info.email.toLowerCase().trim() === cleanEmail);
        return (isP1 || isP2) && m.status !== 'completed' && m.status !== 'double_forfeit';
    }) || null;
}

/**
 * Initialize Default Demo Championship (for Testing/Preview)
 */
export function initDefaultDemoChampionship(group = 'infection') {
    const defaultRoster = Array.from({ length: 50 }, (_, i) => ({
        id: `part_inf_${i + 1}`,
        email: `student${i + 1}@hawari.edu`,
        student_name: `Candidate ${i + 1}`,
        seed_number: i + 1
    }));

    const today = new Date();
    today.setHours(20, 0, 0, 0);

    const generated = generateChampionshipBracket(defaultRoster, {
        title: 'Hawari Championship League (Grand Prix)',
        group_name: group,
        scheduled_start: today.toISOString(),
        match_interval_mins: 25,
        status: 'active'
    });

    champState.activeChampionship = generated.championship;
    champState.participants = generated.participants;
    champState.matches = generated.matches;

    saveChampionshipToLocalCache(group);
    return generated;
}

/**
 * Format Milliseconds to Remaining String (HH:MM:SS or MM:SS)
 */
export function formatRemainingTime(ms) {
    if (ms <= 0) return '00:00';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let _champMatchTickerInterval = null;

/**
 * Autonomous Dedicated 1-Second Student Match Countdown Ticker
 * Resolves countdown freeze under 30s and enforces 5-min prep + live gatekeeper
 */
export function startStudentMatchCountdownTicker(match) {
    if (typeof window === 'undefined') return;
    if (_champMatchTickerInterval) {
        clearInterval(_champMatchTickerInterval);
        _champMatchTickerInterval = null;
    }

    if (!match || !match.scheduled_start) return;

    const schedMs = new Date(match.scheduled_start).getTime();
    if (isNaN(schedMs)) return;

    const updateTick = () => {
        const textEl = document.getElementById('champ-match-countdown-text');
        const btnEl = document.getElementById('btn-enter-champ-match');
        if (!textEl) {
            // Container or banner element unmounted
            if (_champMatchTickerInterval) {
                clearInterval(_champMatchTickerInterval);
                _champMatchTickerInterval = null;
            }
            return;
        }

        const now = Date.now();
        const diffMs = schedMs - now;
        const PREP_WINDOW_MS = 5 * 60 * 1000;

        if (diffMs > 0) {
            textEl.innerText = `تبدأ خلال: ${formatRemainingTime(diffMs)}`;
            textEl.style.color = (diffMs <= PREP_WINDOW_MS) ? '#f59e0b' : '#ef4444';

            if (btnEl) {
                if (diffMs <= PREP_WINDOW_MS) {
                    btnEl.disabled = false;
                    btnEl.style.opacity = '1';
                    btnEl.style.cursor = 'pointer';
                    btnEl.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                    btnEl.style.border = 'none';
                    btnEl.style.fontWeight = '800';
                    btnEl.innerHTML = `<i class="fa-solid fa-clock"></i> ادخل للاستعداد للمباراة ⏳`;
                } else {
                    btnEl.disabled = true;
                    btnEl.style.opacity = '0.65';
                    btnEl.style.cursor = 'not-allowed';
                    btnEl.style.background = '#475569';
                    btnEl.style.border = 'none';
                    btnEl.style.fontWeight = '700';
                    btnEl.innerHTML = `<i class="fa-solid fa-lock"></i> تفتح قبل الموعد بـ 5 دقائق`;
                }
            }
        } else {
            // Official live match time arrived!
            if (_champMatchTickerInterval) {
                clearInterval(_champMatchTickerInterval);
                _champMatchTickerInterval = null;
            }
            textEl.innerText = '⚡ المباراة بدأت الآن!';
            textEl.style.color = '#10b981';

            if (btnEl) {
                btnEl.disabled = false;
                btnEl.style.opacity = '1';
                btnEl.style.cursor = 'pointer';
                btnEl.style.animation = 'pulseGlow 1.5s infinite';
                btnEl.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                btnEl.style.border = 'none';
                btnEl.style.fontWeight = '800';
                btnEl.innerHTML = `<i class="fa-solid fa-bolt"></i> ادخل غرفة المباراة الآن ⚡`;
            }

            // Also update any matching fixture card in the today fixtures list
            const fixCardBtn = document.querySelector(`button[onclick*="enterChampionshipMatch('${match.id}')"]`);
            if (fixCardBtn && fixCardBtn.id !== 'btn-enter-champ-match') {
                fixCardBtn.disabled = false;
                fixCardBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                fixCardBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> ادخل مباراتك الآن ⚡`;
            }
        }
    };

    updateTick();
    _champMatchTickerInterval = setInterval(updateTick, 1000);
}

/**
 * Update Student Match Countdown in Real Time (Legacy compatibility)
 */
function updateStudentMatchCountdown() {
    if (champState.currentStudentMatch) {
        startStudentMatchCountdownTicker(champState.currentStudentMatch);
    }
}

// ============================================================================
// ADMIN ACTIONS & MODAL LOGIC
// ============================================================================

/**
 * Create New Tournament
 */
export function createTournamentPrompt() {
    const title = prompt('Enter Tournament Title (e.g. Hawari Medical Championship 2026):', 'Hawari Championship League');
    if (!title || !title.trim()) return;

    const group = getActiveGroupName();

    champState.activeChampionship = {
        id: `champ_${Date.now()}`,
        group_name: group,
        title: title.trim(),
        status: 'draft',
        total_slots: 60,
        round_schedules: {},
        round_questions: {},
        created_at: new Date().toISOString()
    };
    champState.participants = [];
    champState.matches = [];

    saveChampionshipToLocalCache(group);
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Tournament Created', 'Tournament initialized in Draft mode. Add competitors and configure schedules.', 'success');
}

/**
 * Toggle Tournament Publish Status
 */
export function toggleTournamentPublishStatus() {
    const champ = champState.activeChampionship;
    if (!champ) return;

    const group = getActiveGroupName();

    if (champ.status === 'active') {
        champ.status = 'draft';
        saveChampionshipToLocalCache(group);
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
        window.showToast?.('Tournament Hidden', 'Tournament status changed to Draft. Students will see no active tournament.', 'info');
    } else {
        if (!champState.matches || champState.matches.length === 0) {
            window.showToast?.('Bracket Required', 'Please generate the bracket draw before publishing the tournament!', 'warning');
            return;
        }
        champ.status = 'active';
        saveChampionshipToLocalCache(group);
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
        window.showToast?.('Tournament Live! 🚀', 'Championship is now published and visible to students in Battle Room!', 'success');
    }
}

/**
 * Reset Entire Tournament (Physical Cloud & Local Deletion)
 */
export async function resetTournamentPrompt() {
    if (!confirm('Are you sure you want to completely reset and delete the active championship? This will clear all matches and participants.')) return;

    const group = getActiveGroupName();
    champState.activeChampionship = null;
    champState.participants = [];
    champState.matches = [];
    champState.currentStudentMatch = null;
    champState._cloudChecked = true;

    try {
        localStorage.removeItem(`${STORAGE_CHAMP_KEY}_${group}`);
    } catch (e) {}

    await deleteChampionshipFromCloud(group);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('championship_updated'));
        if (typeof window._broadcastChampionshipUpdate === 'function') {
            window._broadcastChampionshipUpdate('RESET');
        }
    }

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Tournament Reset', 'Tournament data has been completely cleared from cloud and local storage.', 'info');
}

/**
 * Add Competitor Form Submit
 */
export function addParticipantFormSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const nameInput = document.getElementById('champ-input-student-name');
    const emailInput = document.getElementById('champ-input-student-email');
    if (!nameInput || !emailInput) return;

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();

    if (!name || !email) {
        window.showToast?.('Missing Fields', 'Please enter both student name and email address.', 'warning');
        return;
    }

    if (champState.participants.length >= 60) {
        window.showToast?.('Capacity Limit', 'Maximum limit of 60 competitors reached!', 'warning');
        return;
    }

    const group = getActiveGroupName();
    const newPart = {
        id: `part_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        championship_id: champState.activeChampionship?.id || 'champ_1',
        email: email,
        student_name: name,
        seed_number: champState.participants.length + 1,
        is_active: true,
        eliminated: false
    };

    champState.participants.push(newPart);
    saveChampionshipToLocalCache(group);

    nameInput.value = '';
    emailInput.value = '';
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Competitor Added', `Added ${name} (${email}) to tournament roster.`, 'success');
}

/**
 * Edit Participant (Name and Email Independently)
 */
export function editParticipantPrompt(partId) {
    const participant = (champState.participants || []).find(p => p.id === partId);
    if (!participant) return;

    const newName = prompt('Enter Student Name (الاسم بالكامل):', participant.student_name);
    if (newName === null) return;

    const newEmail = prompt('Enter Gmail Address (البريد الإلكتروني):', participant.email);
    if (newEmail === null) return;

    if (!newName.trim() || !newEmail.trim()) {
        window.showToast?.('Invalid Input', 'Name and Email cannot be empty.', 'warning');
        return;
    }

    participant.student_name = newName.trim();
    participant.email = newEmail.trim().toLowerCase();

    // Update in any matches where this player is participating
    (champState.matches || []).forEach(m => {
        if (m.player1_id === partId && m.player1_info) {
            m.player1_info.student_name = participant.student_name;
            m.player1_info.email = participant.email;
        }
        if (m.player2_id === partId && m.player2_info) {
            m.player2_info.student_name = participant.student_name;
            m.player2_info.email = participant.email;
        }
    });

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Updated', `Successfully updated: ${participant.student_name} (${participant.email})`, 'success');
}

/**
 * Remove Participant
 */
export function removeParticipant(partId) {
    if (!confirm('Are you sure you want to remove this participant?')) return;
    champState.participants = (champState.participants || []).filter(p => p.id !== partId);

    // Re-index seed numbers
    champState.participants.forEach((p, idx) => p.seed_number = idx + 1);

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Removed', 'Competitor was removed from the roster.', 'info');
}

/**
 * Clear All Participants
 */
export function clearAllParticipantsPrompt() {
    if (!confirm('Are you sure you want to clear all competitors from the roster?')) return;
    champState.participants = [];

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Roster Cleared', 'All competitors cleared from roster.', 'info');
}

/**
 * Bulk Import Modal Logic
 */
export function openBulkImportModal() {
    let overlay = document.getElementById('champ-bulk-import-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'champ-bulk-import-modal';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px;';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border-color); width: 100%; max-width: 550px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
            <h3 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-paste" style="color: var(--primary-color);"></i> Bulk Import Competitors
            </h3>
            <p style="margin: 0 0 16px 0; font-size: 0.88rem; color: var(--text-secondary);">
                Paste your students list (one per line). Format: <code>Student Name, email@gmail.com</code> (or tab/dash separated).
            </p>
            <textarea id="bulk-import-textarea" rows="10" placeholder="Dr. Ahmed Ali, ahmed@gmail.com&#10;Dr. Mona Hassan, mona@gmail.com&#10;Mohamed Tarek, tarek@gmail.com" style="width: 100%; border-radius: 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 12px; font-family: monospace; font-size: 0.88rem; box-sizing: border-box;"></textarea>
            
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
                <button class="btn btn-secondary" onclick="window.closeBulkImportModal()">Cancel</button>
                <button class="btn btn-primary" onclick="window.submitBulkImport()">Import Competitors</button>
            </div>
        </div>
    `;
    overlay.style.display = 'flex';
}

export function closeBulkImportModal() {
    const overlay = document.getElementById('champ-bulk-import-modal');
    if (overlay) overlay.style.display = 'none';
}

export function submitBulkImport() {
    const txtArea = document.getElementById('bulk-import-textarea');
    if (!txtArea || !txtArea.value.trim()) return;

    const lines = txtArea.value.split('\n');
    let addedCount = 0;
    const group = getActiveGroupName();

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (champState.participants.length >= 60) break;

        let name = '';
        let email = '';

        if (line.includes(',')) {
            const parts = line.split(',');
            name = parts[0].trim();
            email = parts[1].trim().toLowerCase();
        } else if (line.includes('\t')) {
            const parts = line.split('\t');
            name = parts[0].trim();
            email = parts[1].trim().toLowerCase();
        } else if (line.includes(' - ')) {
            const parts = line.split(' - ');
            name = parts[0].trim();
            email = parts[1].trim().toLowerCase();
        } else if (line.includes(' ')) {
            const parts = line.split(' ');
            email = parts.pop().trim().toLowerCase();
            name = parts.join(' ').trim();
        }

        if (name && email && email.includes('@')) {
            champState.participants.push({
                id: `part_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                championship_id: champState.activeChampionship?.id || 'champ_1',
                email: email,
                student_name: name,
                seed_number: champState.participants.length + 1,
                is_active: true,
                eliminated: false
            });
            addedCount++;
        }
    }

    saveChampionshipToLocalCache(group);
    closeBulkImportModal();
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Import Completed', `Successfully added ${addedCount} competitors to the roster (Total: ${champState.participants.length}/60).`, 'success');
}

/**
 * Generate Tournament Bracket from Registered Competitors
 */
export function generateBracketFromAdmin() {
    const participants = champState.participants || [];
    if (participants.length < 2) {
        window.showToast?.('Roster Incomplete', 'At least 2 competitors are required to generate a championship bracket.', 'warning');
        return;
    }

    // Enforce Unified Round Schedules up to Grand Final before bracket draw can be generated
    // Dynamically adapts to exact tournament size (e.g. 10 players -> Preliminary, QF, SF, Final)
    const requiredRounds = getRequiredRoundsForSize(participants.length);

    const currentSchedules = champState.activeChampionship?.round_schedules || {};
    const missingRounds = requiredRounds.filter(r => !currentSchedules[r]);

    if (missingRounds.length > 0) {
        const missingLabels = missingRounds.map(r => ROUND_LABELS[r] || r).join(', ');
        window.showToast?.('مواعيد البطولة مطلوبة', `لا يمكن إجراء القرعة قبل تحديد مواعيد كافة الأدوار حتى النهائي (${missingLabels}). يرجى حفظ المواعيد أولاً.`, 'warning');
        champState.adminActiveSubTab = 'schedules';
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
        return;
    }

    const group = getActiveGroupName();
    const title = champState.activeChampionship?.title || 'Hawari Medical Cup';

    const generated = generateChampionshipBracket(participants, {
        id: champState.activeChampionship?.id || `champ_${Date.now()}`,
        title: title,
        group_name: group,
        round_schedules: champState.activeChampionship?.round_schedules || {},
        round_questions: champState.activeChampionship?.round_questions || {},
        match_interval_mins: 25,
        status: champState.activeChampionship?.status || 'draft'
    });

    champState.activeChampionship = generated.championship;
    champState.participants = generated.participants;
    champState.matches = generated.matches;

    saveChampionshipToLocalCache(group);
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Draw Generated! 🎲', `Bracket generated successfully for ${participants.length} players (${generated.totalMatches} matches).`, 'success');
}

/**
 * Save Round Schedules Form
 */
export function saveRoundSchedulesForm(e) {
    if (e && e.preventDefault) e.preventDefault();

    if (!champState.activeChampionship) {
        createTournamentPrompt();
        return;
    }

    const schedules = {};
    ALL_ROUNDS.forEach(r => {
        const input = document.getElementById(`sched-input-${r.key}`);
        if (input && input.value) {
            schedules[r.key] = new Date(input.value).toISOString();
        }
    });

    champState.activeChampionship.round_schedules = schedules;

    // Apply schedules to matches immediately (preserving completed match timestamps)
    (champState.matches || []).forEach(m => {
        if (m.status !== 'completed' && schedules[m.round_name]) {
            m.scheduled_start = schedules[m.round_name];
        }
    });

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('تم حفظ المواعيد', 'تم تحديث مواعيد الأدوار وتطبيقها فورياً على جميع المباريات والشجرة.', 'success');
}

/**
 * Prompt Admin to Select Question Count from Course Bank
 */
export function promptPickRoundQuestions(roundKey) {
    const input = prompt("أدخل عدد الأسئلة المراد اختيارها عشوائياً من بنك أسئلة الكورس لهذا الدور (مثال: 5، 10، 15، 20):", "10");
    if (!input) return;
    const count = parseInt(input.trim()) || 10;
    pickRoundQuestionsFromBank(roundKey, count);
}

/**
 * Pick Questions from Course Bank for a Round
 */
export function pickRoundQuestionsFromBank(roundKey, count = 10) {
    if (!champState.activeChampionship) {
        window.showToast?.('Tournament Required', 'Create a tournament first before loading questions.', 'warning');
        return;
    }

    const sourcePool = (window.state?.questions && window.state.questions.length > 0)
        ? window.state.questions
        : (window.globalQuestionsCache || []);

    if (sourcePool.length === 0) {
        window.showToast?.('Bank Empty', 'No questions available in question bank to select from.', 'warning');
        return;
    }

    // Shuffle and pick
    const shuffled = [...sourcePool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count).map(q => ({
        id: q.id,
        text: q.text,
        options: q.options,
        correctOption: q.correctOption,
        explanation: q.explanation || '',
        topic: q.topic || 'General'
    }));

    if (!champState.activeChampionship.round_questions) {
        champState.activeChampionship.round_questions = {};
    }
    champState.activeChampionship.round_questions[roundKey] = selected;

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Questions Assigned', `Loaded ${selected.length} MCQs into ${ROUND_LABELS[roundKey] || roundKey}.`, 'success');

    // Automatically open preview & edit modal for the loaded questions
    viewRoundQuestionsModal(roundKey);
}

/**
 * Clear Round Questions
 */
export function clearRoundQuestions(roundKey) {
    if (!champState.activeChampionship?.round_questions) return;
    delete champState.activeChampionship.round_questions[roundKey];

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Cleared', `Question set cleared for ${ROUND_LABELS[roundKey] || roundKey}.`, 'info');
}

/**
 * Open Upload Questions Modal
 */
export function openUploadQuestionsModal(roundKey) {
    let overlay = document.getElementById('champ-upload-q-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'champ-upload-q-modal';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px;';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border-color); width: 100%; max-width: 650px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); max-height: 90vh; overflow-y: auto;">
            <h3 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-upload" style="color: #10b981;"></i> Upload Questions for ${ROUND_LABELS[roundKey] || roundKey}
            </h3>
            <p style="margin: 0 0 16px 0; font-size: 0.88rem; color: var(--text-secondary);">
                Paste a JSON array of MCQs. All competitors in this round will synchronously receive this exact set of questions.
            </p>

            <textarea id="upload-q-textarea" rows="12" placeholder='[&#10;  {&#10;    "text": "What is the primary vector for Dengue fever?",&#10;    "options": { "A": "Aedes aegypti", "B": "Anopheles", "C": "Culex", "D": "Ixodes" },&#10;    "correctOption": "A",&#10;    "explanation": "Aedes aegypti is the primary mosquito vector."&#10;  }&#10;]' style="width: 100%; border-radius: 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 12px; font-family: monospace; font-size: 0.85rem; box-sizing: border-box;"></textarea>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
                <button class="btn btn-secondary" onclick="window.closeUploadQuestionsModal()">Cancel</button>
                <button class="btn btn-primary" onclick="window.submitUploadQuestions('${roundKey}')">Upload Question Set</button>
            </div>
        </div>
    `;
    overlay.style.display = 'flex';
}

export function closeUploadQuestionsModal() {
    const overlay = document.getElementById('champ-upload-q-modal');
    if (overlay) overlay.style.display = 'none';
}

export function submitUploadQuestions(roundKey) {
    const txtArea = document.getElementById('upload-q-textarea');
    if (!txtArea || !txtArea.value.trim()) return;

    try {
        const parsed = JSON.parse(txtArea.value.trim());
        if (!Array.isArray(parsed) || parsed.length === 0) {
            alert('Invalid JSON format: Must be a non-empty array of question objects.');
            return;
        }

        const sanitized = parsed.map((q, idx) => ({
            id: q.id || `cq_${roundKey}_${idx + 1}_${Date.now()}`,
            text: q.text || q.stem || 'Question Stem',
            options: q.options || { A: 'A', B: 'B', C: 'C', D: 'D' },
            correctOption: (q.correctOption || q.answer || 'A').toUpperCase().trim(),
            explanation: q.explanation || '',
            topic: q.topic || 'Championship'
        }));

        if (!champState.activeChampionship) {
            createTournamentPrompt();
        }

        if (!champState.activeChampionship.round_questions) {
            champState.activeChampionship.round_questions = {};
        }
        champState.activeChampionship.round_questions[roundKey] = sanitized;

        const group = getActiveGroupName();
        saveChampionshipToLocalCache(group);

        closeUploadQuestionsModal();
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
        window.showToast?.('Upload Successful', `Successfully saved ${sanitized.length} questions for ${ROUND_LABELS[roundKey] || roundKey}.`, 'success');

        // Automatically open Preview & Edit modal for uploaded questions
        viewRoundQuestionsModal(roundKey);
    } catch (err) {
        alert('JSON Syntax Error: ' + err.message);
    }
}

/**
 * Preview & Edit Questions Modal for Round
 */
export function viewRoundQuestionsModal(roundKey) {
    if (typeof document === 'undefined') return;
    const questions = champState.activeChampionship?.round_questions?.[roundKey] || [];
    let overlay = document.getElementById('champ-view-q-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'champ-view-q-modal';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px;';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border-color); width: 100%; max-width: 780px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); max-height: 85vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
                <div>
                    <h3 style="margin: 0; color: var(--text-primary); font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-list-check" style="color: #10b981;"></i>
                        Preview & Edit Questions: ${ROUND_LABELS[roundKey] || roundKey} (${questions.length})
                    </h3>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">
                        All matches in this round will strictly present these synchronized questions.
                    </span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-primary btn-sm" onclick="window.openAddQuestionModal('${roundKey}')">
                        <i class="fa-solid fa-plus"></i> Add Question
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="window.closeViewQuestionsModal()">Close</button>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 14px;">
                ${questions.length === 0 ? `
                    <div style="padding: 30px; text-align: center; color: var(--text-muted); background: var(--bg-secondary); border-radius: 10px;">
                        No questions in this round yet. Click "Add Question" above or "Pick from Bank" to load questions.
                    </div>
                ` : questions.map((q, idx) => `
                    <div style="background: var(--bg-secondary); padding: 16px; border-radius: 12px; border: 1px solid var(--border-color); font-size: 0.9rem;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px;">
                            <div style="font-weight: 700; color: var(--text-primary); line-height: 1.5;">
                                ${idx + 1}. ${q.text}
                            </div>
                            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                <button class="btn btn-secondary btn-sm" onclick="window.openEditQuestionModal('${roundKey}', ${idx})" style="padding: 3px 8px; font-size: 0.78rem;">
                                    <i class="fa-solid fa-pen"></i> Edit
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="window.deleteQuestionFromRound('${roundKey}', ${idx})" style="padding: 3px 8px; font-size: 0.78rem; color: #ef4444;">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px; margin-bottom: 8px; font-size: 0.85rem;">
                            ${Object.keys(q.options || {}).map(optKey => `
                                <div style="color: ${optKey === q.correctOption ? '#10b981' : 'var(--text-secondary)'}; font-weight: ${optKey === q.correctOption ? '700' : '400'};">
                                    <strong>${optKey}:</strong> ${q.options[optKey]} ${optKey === q.correctOption ? '✓ (Correct)' : ''}
                                </div>
                            `).join('')}
                        </div>
                        ${q.explanation ? `<div style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px dashed var(--border-color); padding-top: 6px;">Rationale: ${q.explanation}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    overlay.style.display = 'flex';
}

export function closeViewQuestionsModal() {
    const overlay = document.getElementById('champ-view-q-modal');
    if (overlay) overlay.style.display = 'none';
}

export function openEditQuestionModal(roundKey, qIdx) {
    const questions = champState.activeChampionship?.round_questions?.[roundKey] || [];
    const q = questions[qIdx];
    if (!q) return;

    let overlay = document.getElementById('champ-edit-single-q-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'champ-edit-single-q-modal';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 100001; display: flex; align-items: center; justify-content: center; padding: 20px;';
        document.body.appendChild(overlay);
    }

    const opts = q.options || {};
    const optA = opts.A || '';
    const optB = opts.B || '';
    const optC = opts.C || '';
    const optD = opts.D || '';
    const optE = opts.E || '';
    const correctOpt = (q.correctOption || 'A').toUpperCase();

    overlay.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: 16px; border: 1.5px solid var(--primary-color); width: 100%; max-width: 600px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto;">
            <h3 style="margin: 0 0 16px 0; color: var(--text-primary); font-size: 1.2rem; display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-pen-to-square" style="color: var(--primary-color);"></i> Edit Question #${qIdx + 1} (${ROUND_LABELS[roundKey] || roundKey})
            </h3>

            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <label style="font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Question Stem (نص السؤال):</label>
                    <textarea id="edit-q-text" rows="3" class="form-control" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px; font-size: 0.9rem;">${q.text || ''}</textarea>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <label style="font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Option A:</label>
                        <input type="text" id="edit-q-opt-A" class="form-control" value="${optA}" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 10px;">
                    </div>
                    <div>
                        <label style="font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Option B:</label>
                        <input type="text" id="edit-q-opt-B" class="form-control" value="${optB}" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 10px;">
                    </div>
                    <div>
                        <label style="font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Option C:</label>
                        <input type="text" id="edit-q-opt-C" class="form-control" value="${optC}" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 10px;">
                    </div>
                    <div>
                        <label style="font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Option D:</label>
                        <input type="text" id="edit-q-opt-D" class="form-control" value="${optD}" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 10px;">
                    </div>
                </div>

                <div>
                    <label style="font-weight: 700; font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Option E (Optional / اختياري):</label>
                    <input type="text" id="edit-q-opt-E" class="form-control" value="${optE}" placeholder="Leave empty if 4 options only" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 6px 10px;">
                </div>

                <div>
                    <label style="font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Correct Answer (الإجابة الصحيحة):</label>
                    <select id="edit-q-correct" class="form-control" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px; font-weight: 700;">
                        <option value="A" ${correctOpt === 'A' ? 'selected' : ''}>Option A</option>
                        <option value="B" ${correctOpt === 'B' ? 'selected' : ''}>Option B</option>
                        <option value="C" ${correctOpt === 'C' ? 'selected' : ''}>Option C</option>
                        <option value="D" ${correctOpt === 'D' ? 'selected' : ''}>Option D</option>
                        <option value="E" ${correctOpt === 'E' ? 'selected' : ''}>Option E</option>
                    </select>
                </div>

                <div>
                    <label style="font-weight: 700; font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Explanation / Rationale (التفسير الطبي):</label>
                    <textarea id="edit-q-explanation" rows="2" class="form-control" style="width: 100%; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); padding: 8px 12px; font-size: 0.85rem;">${q.explanation || ''}</textarea>
                </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="window.closeEditQuestionModal()">Cancel</button>
                <button class="btn btn-primary" onclick="window.saveEditedQuestion('${roundKey}', ${qIdx})">
                    <i class="fa-solid fa-save"></i> Save Question
                </button>
            </div>
        </div>
    `;
    overlay.style.display = 'flex';
}

export function closeEditQuestionModal() {
    const overlay = document.getElementById('champ-edit-single-q-modal');
    if (overlay) overlay.style.display = 'none';
}

export function saveEditedQuestion(roundKey, qIdx) {
    const questions = champState.activeChampionship?.round_questions?.[roundKey] || [];
    const text = document.getElementById('edit-q-text')?.value.trim();
    const optA = document.getElementById('edit-q-opt-A')?.value.trim();
    const optB = document.getElementById('edit-q-opt-B')?.value.trim();
    const optC = document.getElementById('edit-q-opt-C')?.value.trim();
    const optD = document.getElementById('edit-q-opt-D')?.value.trim();
    const optE = document.getElementById('edit-q-opt-E')?.value.trim();
    const correctOption = document.getElementById('edit-q-correct')?.value || 'A';
    const explanation = document.getElementById('edit-q-explanation')?.value.trim();

    if (!text || !optA || !optB) {
        alert('Question stem and at least options A and B are required.');
        return;
    }

    const options = { A: optA, B: optB };
    if (optC) options.C = optC;
    if (optD) options.D = optD;
    if (optE) options.E = optE;

    if (qIdx >= 0 && qIdx < questions.length) {
        questions[qIdx] = {
            ...questions[qIdx],
            text,
            options,
            correctOption,
            explanation
        };
    } else {
        questions.push({
            id: `cq_${roundKey}_${Date.now()}`,
            text,
            options,
            correctOption,
            explanation,
            topic: 'Championship'
        });
    }

    if (!champState.activeChampionship.round_questions) {
        champState.activeChampionship.round_questions = {};
    }
    champState.activeChampionship.round_questions[roundKey] = questions;

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    closeEditQuestionModal();
    viewRoundQuestionsModal(roundKey);
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Question Saved', 'Question updated successfully and synchronized with round matches.', 'success');
}

export function deleteQuestionFromRound(roundKey, qIdx) {
    const questions = champState.activeChampionship?.round_questions?.[roundKey] || [];
    if (!questions[qIdx]) return;

    if (!confirm(`Delete Question #${qIdx + 1}?`)) return;

    questions.splice(qIdx, 1);
    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    viewRoundQuestionsModal(roundKey);
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Question Deleted', 'Question removed from round.', 'info');
}

export function openAddQuestionModal(roundKey) {
    if (!champState.activeChampionship) {
        createTournamentPrompt();
        return;
    }
    if (!champState.activeChampionship.round_questions) {
        champState.activeChampionship.round_questions = {};
    }
    if (!champState.activeChampionship.round_questions[roundKey]) {
        champState.activeChampionship.round_questions[roundKey] = [];
    }
    const questions = champState.activeChampionship.round_questions[roundKey];
    const newIdx = questions.length;
    questions.push({
        id: `cq_${roundKey}_${Date.now()}`,
        text: 'New Medical Question',
        options: { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
        correctOption: 'A',
        explanation: '',
        topic: 'Championship'
    });
    openEditQuestionModal(roundKey, newIdx);
}

/**
 * Replay Single Match Prompt
 */
export function replayMatchPrompt(matchId) {
    const match = (champState.matches || []).find(m => m.id === matchId);
    if (!match) return;

    if (!confirm(`Reset match "${match.player1_info?.student_name} vs ${match.player2_info?.student_name}" and replay?`)) return;

    match.status = 'scheduled';
    match.p1_score = 0;
    match.p2_score = 0;
    match.p1_time_ms = 0;
    match.p2_time_ms = 0;
    match.winner_id = null;

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Match Reset', 'Match has been reset to scheduled status.', 'success');
}

/**
 * Reschedule Single Match Prompt
 */
export function rescheduleSingleMatchPrompt(matchId) {
    const match = (champState.matches || []).find(m => m.id === matchId);
    if (!match) return;

    const newTime = prompt('Enter new match start time (e.g. 21:00 or 08:30 PM):');
    if (!newTime || !newTime.trim()) return;

    match.scheduled_start = new Date().toISOString();

    const group = getActiveGroupName();
    saveChampionshipToLocalCache(group);

    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    window.showToast?.('Match Rescheduled', `Updated match time to: ${newTime}`, 'success');
}

/**
 * Enter Live Championship Match
 */
export function enterChampionshipMatch(matchId, showToast = (typeof window !== 'undefined' ? window.showToast : null)) {
    const match = (champState.matches || []).find(m => m.id === matchId);
    if (!match) {
        if (showToast) showToast('خطأ', 'المباراة غير موجودة أو انتهت بالفعل.', 'error');
        return;
    }

    const currentUser = getActiveCurrentUser();
    const userEmail = (currentUser?.email || '').toLowerCase().trim();
    const userPart = (champState.participants || []).find(p => p.email.toLowerCase().trim() === userEmail);

    if (!userPart) {
        if (showToast) showToast('وضع المشاهد فقط', 'عذراً، هذا الحساب في وضع المشاهد فقط ولا يمكنه خوض المباراة الرسمية.', 'info');
        return;
    }

    if (userPart.eliminated) {
        if (showToast) showToast('تم الإقصاء', 'عذراً، لقد تم إقصاؤك من البطولة ولا يمكنك دخول مباريات جديدة.', 'warning');
        return;
    }

    const isMatchCompetitor = (match.player1_id === userPart.id || match.player2_id === userPart.id);
    if (!isMatchCompetitor) {
        if (showToast) showToast('دخول غير مصرح', 'هذه المباراة مخصصة فقط للاعبين المحددين في الجدول.', 'warning');
        return;
    }

    if (match.status === 'completed') {
        if (showToast) showToast('مباراة مكتملة', 'تم حسم هذه المباراة مسبقاً وتأهل الفائز.', 'info');
        return;
    }

    if (match.status === 'double_forfeit') {
        if (showToast) showToast('مباراة ملغاة', 'تم استبعاد طرفي هذه المباراة لعدم الحضور في الموعد الرسمي.', 'info');
        return;
    }

    // Schedule Gatekeeper: Do not allow entrance more than 5 minutes before scheduled start!
    const schedTime = match.scheduled_start ? new Date(match.scheduled_start).getTime() : 0;
    const now = Date.now();
    const PREP_WINDOW_MS = 5 * 60 * 1000;
    if (schedTime && (now < schedTime - PREP_WINDOW_MS)) {
        let timeStr = '';
        try {
            timeStr = new Date(match.scheduled_start).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch(e) {
            timeStr = new Date(match.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (showToast) {
            showToast('الموعد الرسمي لم يحن بعد', `المباراة مجدولة في تمام الساعة (${timeStr}). تفتح غرفة الاستعداد قبل الموعد بـ 5 دقائق فقط.`, 'warning');
        }
        return;
    }

    console.log('[Championship] Entering match room:', matchId);
    champState.inMatch = true;
    champState.activeMatchRoom = match;

    if (typeof window.launchChampionshipArena === 'function') {
        window.launchChampionshipArena(match);
    }
}

/**
 * Filter Roster Search
 */
export function filterRosterSearch(query) {
    champState.rosterSearchQuery = query;
    renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
}

// Global Window Bindings
if (typeof window !== 'undefined') {
    window.renderChampionshipHub = renderChampionshipHub;
    window.champState = champState;

    window.switchChampSubTab = (tab) => {
        champState.activeSubTab = tab;
        renderChampionshipHub(champState.lastContainerId || 'battle-championship-container', getActiveCurrentUser());
    };

    window.switchAdminChampTab = (tab) => {
        champState.adminActiveSubTab = tab;
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    };

    window.createTournamentPrompt = createTournamentPrompt;
    window.toggleTournamentPublishStatus = toggleTournamentPublishStatus;
    window.resetTournamentPrompt = resetTournamentPrompt;
    window.addParticipantFormSubmit = addParticipantFormSubmit;
    window.editParticipantPrompt = editParticipantPrompt;
    window.removeParticipant = removeParticipant;
    window.clearAllParticipantsPrompt = clearAllParticipantsPrompt;
    window.openBulkImportModal = openBulkImportModal;
    window.closeBulkImportModal = closeBulkImportModal;
    window.submitBulkImport = submitBulkImport;
    window.generateBracketFromAdmin = generateBracketFromAdmin;
    window.saveRoundSchedulesForm = saveRoundSchedulesForm;
    window.promptPickRoundQuestions = promptPickRoundQuestions;
    window.pickRoundQuestionsFromBank = pickRoundQuestionsFromBank;
    window.clearRoundQuestions = clearRoundQuestions;
    window.openUploadQuestionsModal = openUploadQuestionsModal;
    window.closeUploadQuestionsModal = closeUploadQuestionsModal;
    window.submitUploadQuestions = submitUploadQuestions;
    window.viewRoundQuestionsModal = viewRoundQuestionsModal;
    window.closeViewQuestionsModal = closeViewQuestionsModal;
    window.openEditQuestionModal = openEditQuestionModal;
    window.closeEditQuestionModal = closeEditQuestionModal;
    window.saveEditedQuestion = saveEditedQuestion;
    window.deleteQuestionFromRound = deleteQuestionFromRound;
    window.openAddQuestionModal = openAddQuestionModal;
    window.replayMatchPrompt = replayMatchPrompt;
    window.rescheduleSingleMatchPrompt = rescheduleSingleMatchPrompt;
    window.enterChampionshipMatch = enterChampionshipMatch;
    window.startStudentMatchCountdownTicker = startStudentMatchCountdownTicker;
    window.filterRosterSearch = filterRosterSearch;
    window.checkExpiredUnplayedMatches = checkExpiredUnplayedMatches;
    window.deleteChampionshipFromCloud = deleteChampionshipFromCloud;

    window.editTournamentTitlePrompt = () => {
        if (!champState.activeChampionship) return;
        const newTitle = prompt('Enter new championship title:', champState.activeChampionship.title);
        if (!newTitle || !newTitle.trim()) return;
        champState.activeChampionship.title = newTitle.trim();
        const group = getActiveGroupName();
        saveChampionshipToLocalCache(group);
        renderChampionshipHub(champState.lastContainerId || 'admin-championship-tab-container', getActiveCurrentUser());
    };

    // Instant Reactive UI Re-render without page refresh
    window.addEventListener('championship_updated', () => {
        const group = getActiveGroupName();
        try {
            const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                champState.activeChampionship = (parsed && parsed.championship) ? parsed.championship : null;
                champState.participants = (parsed && parsed.participants) || [];
                champState.matches = (parsed && parsed.matches) || [];
            } else {
                champState.activeChampionship = null;
                champState.participants = [];
                champState.matches = [];
            }
        } catch(e) {}

        const champContainer = document.getElementById('battle-championship-container');
        if (champContainer && !champContainer.classList.contains('hidden')) {
            renderChampionshipHub('battle-championship-container', getActiveCurrentUser());
        }
        const adminContainer = document.getElementById('admin-championship-tab-container');
        if (adminContainer) {
            renderChampionshipHub('admin-championship-tab-container', getActiveCurrentUser());
        }
    });

    // Cross-tab synchronization
    window.addEventListener('storage', (e) => {
        if (e.key && e.key.startsWith(STORAGE_CHAMP_KEY)) {
            window.dispatchEvent(new CustomEvent('championship_updated'));
        }
    });

    // Background interval to periodically check for unplayed expired matches (Double Forfeits / Walkovers)
    setInterval(() => {
        if (champState.activeChampionship?.status === 'active') {
            checkExpiredUnplayedMatches();
        }
    }, 15000);
}
