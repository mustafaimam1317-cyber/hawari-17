/**
 * ============================================================================
 * HAWARI PLATFORM - 1v1 BATTLE ROOM MULTIPLAYER ENGINE (v3.0)
 * Author: Mustafa Imam
 * Copyright (c) 2026 Hawari Platform. All Rights Reserved.
 *
 * Real-time 1v1 Competitive Medical Quiz Arena:
 * - Names formatted using the first 5 characters of student email
 * - In-Match Surrender / Forfeit Button with immediate winner attribution
 * - Two-Way Rematch Protocol (Presence verification + Interactive Accept/Decline)
 * - Dynamic Source Selector: Past Exams, College MCQs, or Mixed
 * - Topics Selection: Mixed (All) or Specific Detailed Topics with Checkboxes
 * - Fully Student-Controlled Question Count & Custom Timer (Seconds per Question)
 * - Strict 50 Concurrent Rooms Gatekeeper (Server Capacity Cap)
 * - Realtime WebSockets & Presence synchronization via Supabase Realtime
 * - Native Platform CSS Integration (.choice-btn, .test-setup-card, Clay & Neumorphism)
 * - Anti-Cheat Answering & Speed + Accuracy Scoring Engine (100 Base + Speed Bonus)
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import {
    initChampionshipLeague,
    renderChampionshipHub,
    enterChampionshipMatch,
    champState,
    saveChampionshipToLocalCache,
    getActiveGroupName,
    STORAGE_CHAMP_KEY,
    checkExpiredUnplayedMatches
} from './championshipLeague.js';
import { evaluateMatchResult, advanceWinnerToNextRound, ROUND_LABELS } from './championshipBracketEngine.js';

// Global Engine State
export const battleState = {
    // Supabase Realtime Client & Channels
    supabaseClient: null,
    lobbyChannel: null,
    roomChannel: null,

    // Server Capacity (Strict 50 Rooms Limit)
    MAX_CONCURRENT_ROOMS: 50,
    activeRoomsCount: 0,
    activeRoomsMap: new Map(),

    // Filtering & Setup State
    selectedSource: "Past Exam",
    topicMode: "mixed", // "mixed" or "custom"

    // Current Session & Room Details
    activeRoom: null, // { id, code, source, topics, count, timeLimit, isHost, role: 'p1'|'p2', opponent: { email, name, avatar } }
    questions: [], // Loaded locally from question bank
    currentQuestionIndex: 0,

    // Score & Answering HUD
    myScore: 0,
    opponentScore: 0,
    myAnswered: false,
    opponentAnswered: false,
    myCurrentSelection: null,
    myAnswerLocked: false,
    opponentAnswerLocked: false,
    myAnswers: {}, // { [qIdx]: { selectedOption, isCorrect, timeRemaining, scoreEarned } }
    opponentAnswers: {},

    // Question Timer
    timerInterval: null,
    timeRemaining: 30,
    totalTime: 30,

    // Matchmaking, Rematch & Disconnect State
    isSearchingMatch: false,
    matchSearchTimeout: null,
    rematchTimeout: null,
    disconnectTimeout: null,
    disconnectSeconds: 30,
    guestWaitTimeout: null,
    guestHandshakeInterval: null,

    // Lifecycle Status: 'idle' | 'lobby' | 'waiting' | 'countdown' | 'arena' | 'feedback' | 'results'
    gameStatus: 'idle'
};

/**
 * Helper to format user display name: first 5 characters of email
 */
export function formatUserDisplay(user) {
    if (!user) return "USER";
    const email = user.email || "";
    if (email) {
        const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
        return (prefix.slice(0, 5) || "STUD").toUpperCase();
    }
    const name = user.name || "";
    if (name) {
        const clean = name.replace(/[^a-zA-Z0-9]/g, "");
        return (clean.slice(0, 5) || "STUD").toUpperCase();
    }
    return "STUD1";
}

/**
 * Initialize or retrieve the Supabase Realtime Client
 */
export function getBattleSupabaseClient() {
    if (battleState.supabaseClient) return battleState.supabaseClient;
    try {
        const url = import.meta.env?.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
        const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
        
        battleState.supabaseClient = createClient(url, anonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
                storageKey: 'hawari_battle_anon'
            },
            realtime: {
                timeout: 35000,
                params: {
                    eventsPerSecond: 15
                }
            }
        });
    } catch (e) {
        console.error("[BattleRoom] Supabase client initialization failed:", e);
    }
    return battleState.supabaseClient;
}

/**
 * Connect to the Global Battle Lobby to track server capacity & room discovery
 */
export function connectToBattleLobby() {
    const client = getBattleSupabaseClient();
    if (!client || battleState.lobbyChannel) return;

    const user = getActiveUser();
    const userEmail = user.email;

    battleState.lobbyChannel = client.channel("hawari_battle_lobby", {
        config: {
            presence: { key: userEmail }
        }
    });

    battleState.lobbyChannel
        .on("presence", { event: "sync" }, () => {
            const state = battleState.lobbyChannel.presenceState();
            let count = 0;
            battleState.activeRoomsMap.clear();

            Object.keys(state).forEach(key => {
                const presences = state[key];
                if (Array.isArray(presences) && presences.length > 0) {
                    const data = presences[0];
                    if (data.isRoomHost && data.roomId) {
                        count++;
                        battleState.activeRoomsMap.set(data.roomId, data);
                    }
                }
            });

            battleState.activeRoomsCount = count;
            updateServerCapacityBadge();
        })
        .subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("[BattleRoom] Connected to Global Battle Lobby.");
            }
        });
}

/**
 * Update the live UI server capacity indicator
 */
export function updateServerCapacityBadge() {
    const countEl = document.getElementById("battle-active-rooms-count");
    const dotEl = document.getElementById("battle-capacity-dot");
    if (!countEl) return;

    countEl.innerText = battleState.activeRoomsCount;

    if (dotEl) {
        if (battleState.activeRoomsCount >= battleState.MAX_CONCURRENT_ROOMS) {
            dotEl.style.background = "#ef4444";
            dotEl.style.boxShadow = "0 0 8px #ef4444";
        } else if (battleState.activeRoomsCount >= 40) {
            dotEl.style.background = "#f59e0b";
            dotEl.style.boxShadow = "0 0 8px #f59e0b";
        } else {
            dotEl.style.background = "#10b981";
            dotEl.style.boxShadow = "0 0 8px #10b981";
        }
    }
}

/**
 * Strict Gatekeeper: checks if server room capacity is exhausted
 */
export function verifyServerRoomCapacity() {
    if (battleState.activeRoomsCount >= battleState.MAX_CONCURRENT_ROOMS) {
        if (typeof window.showToast === "function") {
            window.showToast("Server Capacity Reached", "غير مسموح، العدد مكتمل. برجاء المحاولة في وقت لاحق", "danger");
        } else {
            alert("غير مسموح، العدد مكتمل. برجاء المحاولة في وقت لاحق");
        }
        return false;
    }
    return true;
}

/**
 * Helper to get active user (with graceful guest fallback)
 */
function getActiveUser() {
    const state = window.state || {};
    if (state.currentUser && state.currentUser.email) {
        return state.currentUser;
    }
    let storedAnon = sessionStorage.getItem("hawari_anon_battle_user");
    if (!storedAnon) {
        const id = Math.floor(100 + Math.random() * 900);
        storedAnon = JSON.stringify({
            name: "Student " + id,
            email: `med_${id}@hawari.local`,
            role: "student"
        });
        sessionStorage.setItem("hawari_anon_battle_user", storedAnon);
    }
    return JSON.parse(storedAnon);
}

/**
 * Question Source Selection (Past Exam, College MCQ, All Sources)
 */
export function selectBattleSource(sourceKey) {
    battleState.selectedSource = sourceKey;

    const cards = document.querySelectorAll(".battle-source-card");
    cards.forEach(c => {
        if (c.getAttribute("data-source") === sourceKey) {
            c.classList.add("active");
        } else {
            c.classList.remove("active");
        }
    });

    populateBattleTopicsList();
}

/**
 * Topic Selection Mode (Mixed vs Custom Detailed Topics)
 */
export function setBattleTopicMode(mode) {
    battleState.topicMode = mode;

    const btnMixed = document.getElementById("btn-topic-mode-mixed");
    const btnCustom = document.getElementById("btn-topic-mode-custom");
    const wrapper = document.getElementById("battle-topics-wrapper");

    if (mode === "mixed") {
        btnMixed?.classList.add("active");
        btnCustom?.classList.remove("active");
        wrapper?.classList.add("hidden");
    } else {
        btnMixed?.classList.remove("active");
        btnCustom?.classList.add("active");
        wrapper?.classList.remove("hidden");
        populateBattleTopicsList();
    }
}

/**
 * Populate detailed topics matching current source
 */
export function populateBattleTopicsList() {
    const container = document.getElementById("battle-topics-list");
    if (!container) return;

    const questions = getQuestionsBase();
    const source = battleState.selectedSource;

    let filtered = questions;
    if (source && source !== "all") {
        filtered = filtered.filter(q => 
            q.source === source ||
            (source === "College MCQ" && q.source === "College") ||
            (source === "College" && q.source === "College MCQ")
        );
    }

    const uniqueTopics = [...new Set(filtered.map(q => q.topic).filter(Boolean))].sort();

    // Update Source Badges
    const pastExamCount = questions.filter(q => q.source === "Past Exam").length;
    const collegeCount = questions.filter(q => q.source === "College MCQ" || q.source === "College").length;
    const totalCount = questions.length;

    const badgePast = document.getElementById("battle-badge-past-exam");
    const badgeCollege = document.getElementById("battle-badge-college-mcq");
    const badgeAll = document.getElementById("battle-badge-all");

    if (badgePast) badgePast.innerText = `${pastExamCount} Qs`;
    if (badgeCollege) badgeCollege.innerText = `${collegeCount} Qs`;
    if (badgeAll) badgeAll.innerText = `${totalCount} Qs`;

    container.innerHTML = "";
    if (uniqueTopics.length === 0) {
        container.innerHTML = `<span style="font-size:0.82rem; color:var(--text-muted);">No specific topics found for this source.</span>`;
        return;
    }

    uniqueTopics.forEach(topic => {
        const item = document.createElement("label");
        item.className = "topic-checkbox-item";
        item.innerHTML = `
            <input type="checkbox" class="battle-topic-chk" value="${topic}" checked>
            <span>${topic}</span>
        `;
        container.appendChild(item);
    });
}

export function toggleAllBattleTopics(check) {
    const chks = document.querySelectorAll(".battle-topic-chk");
    chks.forEach(c => c.checked = check);
}

function getSelectedBattleTopics() {
    if (battleState.topicMode === "mixed") return [];
    const chks = document.querySelectorAll(".battle-topic-chk:checked");
    return Array.from(chks).map(c => c.value);
}

function getQuestionsBase() {
    const state = window.state || {};
    return (state.questions && state.questions.length > 0)
        ? state.questions
        : (window.globalQuestionsCache || []);
}

function getFilteredBattleQuestions() {
    const pool = getQuestionsBase();
    let filtered = pool;

    // 1. Filter by Source
    const source = battleState.selectedSource;
    if (source && source !== "all") {
        filtered = filtered.filter(q => 
            q.source === source ||
            (source === "College MCQ" && q.source === "College") ||
            (source === "College" && q.source === "College MCQ")
        );
    }

    // 2. Filter by Topics if Custom
    if (battleState.topicMode === "custom") {
        const topics = getSelectedBattleTopics();
        if (topics.length > 0) {
            filtered = filtered.filter(q => topics.includes(q.topic));
        }
    }

    return filtered.length > 0 ? filtered : pool;
}

/**
 * Switch between the 4 Battle Sub-screens (Lobby, Waiting, Arena, Results)
 */
export function switchBattleSubscreen(screenName) {
    const screens = {
        lobby: document.getElementById("battle-screen-lobby"),
        waiting: document.getElementById("battle-screen-waiting"),
        arena: document.getElementById("battle-screen-arena"),
        results: document.getElementById("battle-screen-results")
    };

    Object.keys(screens).forEach(key => {
        const el = screens[key];
        if (el) {
            if (key === screenName) el.classList.remove("hidden");
            else el.classList.add("hidden");
        }
    });

    battleState.gameStatus = screenName;
}

/**
 * Create a new Direct Challenge Battle Room
 */
export async function createBattleRoom() {
    if (!verifyServerRoomCapacity()) return;

    const currentUser = getActiveUser();
    const userDisplayName = formatUserDisplay(currentUser);
    const source = battleState.selectedSource;
    const countInput = parseInt(document.getElementById("battle-custom-count")?.value || "10");
    const timeInput = parseInt(document.getElementById("battle-custom-time")?.value || "30");

    const count = Math.max(1, Math.min(countInput, 50));
    const timeLimit = Math.max(10, Math.min(timeInput, 180));

    // Generate clean 6-digit room code
    const code = "HAW-" + Math.floor(100 + Math.random() * 900);

    // Pick question IDs from bank (Zero-Egress Strategy)
    const pool = getFilteredBattleQuestions();
    if (pool.length === 0) {
        window.showToast?.("No Questions", "No questions available for the selected filters.", "warning");
        return;
    }

    const shuffled = shuffleArray([...pool]);
    const selectedQuestions = shuffled.slice(0, Math.min(count, pool.length));
    const questionIds = selectedQuestions.map(q => q.id);

    battleState.activeRoom = {
        id: code,
        code: code,
        source: source,
        topicMode: battleState.topicMode,
        count: selectedQuestions.length,
        timeLimit: timeLimit,
        isHost: true,
        role: "p1",
        questionIds: questionIds,
        opponent: null
    };

    battleState.questions = selectedQuestions;

    // 1. INSTANT UI UPDATE (0ms latency: room code and waiting screen immediately visible)
    const codeEl = document.getElementById("battle-waiting-room-code");
    if (codeEl) codeEl.innerText = code;

    const p1Name = document.getElementById("battle-lobby-p1-name");
    const p1Avatar = document.getElementById("battle-lobby-p1-avatar");
    if (p1Name) p1Name.innerText = userDisplayName;
    if (p1Avatar) p1Avatar.innerText = userDisplayName[0];

    const p2Name = document.getElementById("battle-lobby-p2-name");
    const p2Avatar = document.getElementById("battle-lobby-p2-avatar");
    const p2Badge = document.getElementById("battle-lobby-p2-badge");
    if (p2Name) p2Name.innerText = "Waiting for Opponent...";
    if (p2Avatar) p2Avatar.innerText = "?";
    if (p2Badge) {
        p2Badge.innerText = "Waiting";
        p2Badge.style.background = "var(--border-color)";
        p2Badge.style.color = "var(--text-secondary)";
    }

    const countdownBox = document.getElementById("battle-countdown-box");
    if (countdownBox) countdownBox.classList.add("hidden");

    switchBattleSubscreen("waiting");
    window.showToast?.("Battle Room Created", `Room ${code} is ready. Share code with your colleague!`, "success");

    // 2. Track host room in global lobby presence in background (fire-and-forget, non-blocking)
    if (battleState.lobbyChannel) {
        battleState.lobbyChannel.track({
            isRoomHost: true,
            roomId: code,
            source: source,
            count: selectedQuestions.length,
            timeLimit: timeLimit,
            mode: "direct",
            status: "waiting",
            hostEmail: currentUser.email,
            hostDisplayName: userDisplayName,
            createdAt: Date.now()
        }).catch(e => {
            console.warn("[BattleRoom] Failed to track lobby presence:", e);
        });
    }

    // 3. Connect to room channel
    joinRoomChannel(code, true);
}

/**
 * Join an existing Battle Room by 6-digit code
 */
export async function joinBattleRoomByCode(directCode = null) {
    const input = document.getElementById("battle-input-join-code");
    let code = (directCode || input?.value || "").trim().toUpperCase();

    // Clean whitespace, non-printable unicode, and normalize dashes (–, —, − -> -)
    code = code.replace(/[\u200B-\u200D\uFEFF]/g, "")
               .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
               .replace(/\s+/g, "");

    if (!code) {
        window.showToast?.("Invalid Code", "Please enter a valid room code (e.g. HAW-782)", "warning");
        return;
    }

    // Auto-normalize: "HAW782" -> "HAW-782"
    if (/^HAW\d+$/.test(code)) {
        code = code.replace(/^HAW/, "HAW-");
    }
    // Auto-normalize: "782" -> "HAW-782"
    else if (/^\d+$/.test(code)) {
        code = "HAW-" + code;
    }

    if (code.length < 4) {
        window.showToast?.("Invalid Code", "Please enter a valid room code (e.g. HAW-782)", "warning");
        return;
    }

    const currentUser = getActiveUser();
    const userDisplayName = formatUserDisplay(currentUser);

    battleState.activeRoom = {
        id: code,
        code: code,
        isHost: false,
        role: "p2",
        opponent: null
    };

    // Immediate visual feedback on Guest screen
    switchBattleSubscreen("waiting");
    const codeEl = document.getElementById("battle-waiting-room-code");
    if (codeEl) codeEl.innerText = code;

    const p1Name = document.getElementById("battle-lobby-p1-name");
    const p1Avatar = document.getElementById("battle-lobby-p1-avatar");
    if (p1Name) p1Name.innerText = "جاري الاتصال بالسيرفر...";
    if (p1Avatar) p1Avatar.innerText = "⏳";

    const p2Name = document.getElementById("battle-lobby-p2-name");
    const p2Avatar = document.getElementById("battle-lobby-p2-avatar");
    const p2Badge = document.getElementById("battle-lobby-p2-badge");
    if (p2Name) p2Name.innerText = userDisplayName;
    if (p2Avatar) p2Avatar.innerText = userDisplayName[0];
    if (p2Badge) {
        p2Badge.innerText = "Connecting";
        p2Badge.style.background = "#f59e0b";
        p2Badge.style.color = "white";
    }

    const countdownBox = document.getElementById("battle-countdown-box");
    if (countdownBox) countdownBox.classList.add("hidden");

    window.showToast?.("Joining Room", `جاري الاتصال بالغرفة ${code}...`, "info");

    // Connect to room channel (safety timeout will be initiated upon SUBSCRIBED event)
    joinRoomChannel(code, false);
}

/**
 * Connect to the specific 1v1 Room Channel via WebSockets
 */
function joinRoomChannel(code, isHost) {
    const client = getBattleSupabaseClient();
    if (!client) return;

    if (battleState.roomChannel) {
        try { client.removeChannel(battleState.roomChannel); } catch(e) {}
        battleState.roomChannel = null;
    }

    const currentUser = getActiveUser();
    const userDisplayName = formatUserDisplay(currentUser);
    const userEmail = currentUser.email;
    const clientSessionId = Math.random().toString(36).slice(2, 9);
    battleState.clientSessionId = clientSessionId;

    // Unique presence key per device connection to allow testing from same account!
    const presenceKey = `${userEmail || 'user'}_${isHost ? 'host' : 'guest'}_${clientSessionId}`;

    battleState.roomChannel = client.channel(`battle_room_${code}`, {
        config: {
            presence: { key: presenceKey }
        }
    });

    battleState.roomChannel
        // Broadcast Events
        .on("broadcast", { event: "LOBBY_DATA" }, ({ payload }) => {
            handleLobbyData(payload);
        })
        .on("broadcast", { event: "GUEST_READY" }, ({ payload }) => {
            if (isHost && battleState.activeRoom && (battleState.gameStatus === "waiting" || battleState.gameStatus === "countdown")) {
                const guest = payload?.guest;
                if (guest) {
                    battleState.activeRoom.opponent = guest;
                    updateLobbyCompetitorUI(guest);
                    sendLobbyDataToGuest();
                }
            }
        })
        .on("broadcast", { event: "GUEST_ACK" }, () => {
            if (isHost && battleState.activeRoom) {
                console.log("[BattleRoom] Guest acknowledged questions receipt.");
            }
        })
        .on("broadcast", { event: "START_COUNTDOWN" }, ({ payload }) => {
            handleStartCountdown(payload);
        })
        .on("broadcast", { event: "OPPONENT_SELECTING" }, () => {
            handleOpponentSelecting();
        })
        .on("broadcast", { event: "OPPONENT_ANSWERED" }, ({ payload }) => {
            handleOpponentAnswered(payload);
        })
        .on("broadcast", { event: "PLAYER_FORFEIT" }, ({ payload }) => {
            handleOpponentForfeit(payload);
        })
        .on("broadcast", { event: "REMATCH_REQUESTED" }, ({ payload }) => {
            handleRematchOfferReceived(payload);
        })
        .on("broadcast", { event: "REMATCH_ACCEPTED" }, ({ payload }) => {
            handleRematchAcceptedByOpponent(payload);
        })
        .on("broadcast", { event: "REMATCH_DECLINED" }, () => {
            handleRematchDeclinedByOpponent();
        })
        .on("broadcast", { event: "CHAMP_PING" }, () => {
            if (typeof window.onChampOpponentPing === "function") {
                window.onChampOpponentPing();
            }
        })
        // Presence Events
        .on("presence", { event: "sync" }, () => {
            handleRoomPresenceSync(isHost);
        })
        .on("presence", { event: "leave" }, ({ key }) => {
            handleOpponentLeave(key);
        })
        .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
                // Clear any leftover interval or timeout
                clearInterval(battleState.guestHandshakeInterval);
                battleState.guestHandshakeInterval = null;
                clearTimeout(battleState.guestWaitTimeout);
                battleState.guestWaitTimeout = null;

                await battleState.roomChannel.track({
                    email: currentUser.email,
                    displayName: userDisplayName,
                    isHost: isHost,
                    clientId: clientSessionId,
                    ready: true,
                    joinedAt: Date.now()
                }).catch(e => console.warn("[BattleRoom] Presence track warning:", e));

                if (!isHost) {
                    // Update Guest UI to Stage 2: Connected to server, syncing with host
                    const p1Name = document.getElementById("battle-lobby-p1-name");
                    const p2Badge = document.getElementById("battle-lobby-p2-badge");
                    if (p1Name && battleState.gameStatus === "waiting") {
                        p1Name.innerText = "تم الاتصال، جاري المزامنة مع المنشئ...";
                    }
                    if (p2Badge && battleState.gameStatus === "waiting") {
                        p2Badge.innerText = "Syncing...";
                        p2Badge.style.background = "#3b82f6";
                        p2Badge.style.color = "white";
                    }

                    const sendGuestReady = () => {
                        if (!battleState.roomChannel || battleState.gameStatus !== "waiting") return;
                        battleState.roomChannel.send({
                            type: "broadcast",
                            event: "GUEST_READY",
                            payload: {
                                guest: {
                                    email: currentUser.email,
                                    displayName: userDisplayName,
                                    isHost: false,
                                    clientId: clientSessionId
                                }
                            }
                        }).catch(e => console.warn("[BattleRoom] GUEST_READY broadcast error:", e));
                    };

                    // Send immediately
                    sendGuestReady();

                    // Resend every 1.5s (up to 12 times = 18s) to guarantee arrival over real network latency
                    let retryCount = 0;
                    battleState.guestHandshakeInterval = setInterval(() => {
                        retryCount++;
                        if (battleState.gameStatus !== "waiting" || (battleState.questions && battleState.questions.length > 0) || retryCount > 12) {
                            clearInterval(battleState.guestHandshakeInterval);
                            battleState.guestHandshakeInterval = null;
                            return;
                        }
                        sendGuestReady();
                    }, 1500);

                    // Generous 35-second timeout ONLY started after successful SUBSCRIBED status
                    battleState.guestWaitTimeout = setTimeout(() => {
                        if (battleState.gameStatus === "waiting" && (!battleState.questions || battleState.questions.length === 0)) {
                            window.showToast?.("Host Not Found", "لم يتم العثور على منشئ الغرفة. يرجى التأكد من بقاء زميلك داخل شاشة الانتظار وصحة كود الغرفة.", "warning");
                            leaveBattleRoom();
                        }
                    }, 35000);
                }
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.warn(`[BattleRoom] Channel status warning: ${status}. Realtime client is retrying connection in background...`);
                if (!isHost && battleState.gameStatus === "waiting") {
                    const p1Name = document.getElementById("battle-lobby-p1-name");
                    if (p1Name) {
                        p1Name.innerText = "جاري إعادة المحاولة والاتصال بالسيرفر...";
                    }
                }
            }
        }, 35000);
}

function sendLobbyDataToGuest() {
    if (!battleState.roomChannel || !battleState.activeRoom) return;

    const currentUser = getActiveUser();
    const userDisplayName = formatUserDisplay(currentUser);

    battleState.roomChannel.send({
        type: "broadcast",
        event: "LOBBY_DATA",
        payload: {
            source: battleState.activeRoom.source,
            count: battleState.activeRoom.count,
            timeLimit: battleState.activeRoom.timeLimit,
            questionIds: battleState.activeRoom.questionIds,
            fullQuestions: battleState.questions, // Zero-Egress fallback payload
            host: {
                email: currentUser.email,
                displayName: userDisplayName,
                isHost: true,
                clientId: battleState.clientSessionId
            }
        }
    });

    // Trigger countdown after 1.2 seconds if in waiting
    setTimeout(() => {
        if (battleState.gameStatus === "waiting") {
            triggerRoomCountdown();
        }
    }, 1200);
}

/**
 * Handle Room Presence Sync
 */
function handleRoomPresenceSync(isHost) {
    if (!battleState.roomChannel) return;
    const presence = battleState.roomChannel.presenceState();

    let p1 = null;
    let p2 = null;

    Object.keys(presence).forEach(key => {
        const list = presence[key];
        if (Array.isArray(list)) {
            list.forEach(item => {
                if (item.isHost) p1 = item;
                else p2 = item;
            });
        }
    });

    // Check if opponent reconnected during grace period
    const opponent = isHost ? p2 : p1;
    if (battleState.gameStatus === "arena" && opponent && opponentReconnectTimeout) {
        clearTimeout(opponentReconnectTimeout);
        clearInterval(opponentReconnectInterval);
        opponentReconnectTimeout = null;
        opponentReconnectInterval = null;
        hideOpponentReconnectingBanner();
        window.showToast?.("Opponent Reconnected!", "عاد الخصم واستؤنفت الجولة بنجاح!", "success");
    }

    // If opponent joined while waiting
    if (isHost && p2 && battleState.gameStatus === "waiting") {
        battleState.activeRoom.opponent = p2;
        updateLobbyCompetitorUI(p2);
        sendLobbyDataToGuest();
    } else if (!isHost && p1) {
        battleState.activeRoom.opponent = p1;
        updateLobbyCompetitorUI(p1);
    }
}

/**
 * Update Competitor UI in Lobby using first 5 characters of email
 */
function updateLobbyCompetitorUI(opponent) {
    const p2Name = document.getElementById("battle-lobby-p2-name");
    const p2Avatar = document.getElementById("battle-lobby-p2-avatar");
    const p2Badge = document.getElementById("battle-lobby-p2-badge");

    const displayName = opponent.displayName || formatUserDisplay(opponent);

    if (p2Name) p2Name.innerText = displayName;
    if (p2Avatar) {
        p2Avatar.innerText = displayName[0];
        p2Avatar.style.background = "#ef4444";
        p2Avatar.style.color = "white";
        p2Avatar.style.border = "none";
    }
    if (p2Badge) {
        p2Badge.innerText = "Connected";
        p2Badge.style.background = "#10b981";
        p2Badge.style.color = "white";
    }
}

/**
 * Handle Guest receiving Room data from Host
 */
function handleLobbyData(payload) {
    clearTimeout(battleState.guestWaitTimeout);
    battleState.guestWaitTimeout = null;
    clearInterval(battleState.guestHandshakeInterval);
    battleState.guestHandshakeInterval = null;

    if (battleState.activeRoom?.isHost) return;

    battleState.activeRoom.source = payload.source;
    battleState.activeRoom.count = payload.count;
    battleState.activeRoom.timeLimit = payload.timeLimit;
    battleState.activeRoom.questionIds = payload.questionIds;
    battleState.activeRoom.opponent = payload.host;

    // Use Host's synchronized questions payload directly to guarantee identical questions and correctOption parity
    if (Array.isArray(payload.fullQuestions) && payload.fullQuestions.length > 0) {
        battleState.questions = payload.fullQuestions;
    } else {
        const pool = getQuestionsBase();
        const questionMap = new Map(pool.map(q => [q.id, q]));
        battleState.questions = payload.questionIds.map(id => questionMap.get(id)).filter(Boolean);
    }

    // Switch to waiting screen with connected opponent
    const codeEl = document.getElementById("battle-waiting-room-code");
    if (codeEl) codeEl.innerText = battleState.activeRoom.code;

    const p1Name = document.getElementById("battle-lobby-p1-name");
    const p1Avatar = document.getElementById("battle-lobby-p1-avatar");
    const user = getActiveUser();
    const myDisplay = formatUserDisplay(user);

    if (p1Name) p1Name.innerText = myDisplay;
    if (p1Avatar) p1Avatar.innerText = myDisplay[0];

    updateLobbyCompetitorUI(payload.host);
    switchBattleSubscreen("waiting");

    // Acknowledge receipt to host
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "GUEST_ACK",
            payload: { ok: true }
        }).catch(() => {});
    }
}

/**
 * Host triggers synchronized 3.. 2.. 1.. Countdown
 */
function triggerRoomCountdown() {
    if (!battleState.roomChannel) return;
    battleState.roomChannel.send({
        type: "broadcast",
        event: "START_COUNTDOWN",
        payload: { startsAt: Date.now() + 3000 }
    });
    handleStartCountdown({ startsAt: Date.now() + 3000 });
}

/**
 * Handle Countdown and launch Arena
 */
function handleStartCountdown(payload = {}) {
    // 1. Remove championship waiting modal for guest as well
    const waitingOverlay = document.getElementById("champ-match-waiting-modal");
    if (waitingOverlay) waitingOverlay.remove();

    if (battleState.prepTimerInterval) {
        clearInterval(battleState.prepTimerInterval);
        battleState.prepTimerInterval = null;
    }

    // 2. Synchronize questions if guest didn't have them
    if (payload?.fullQuestions && Array.isArray(payload.fullQuestions) && payload.fullQuestions.length > 0) {
        battleState.questions = payload.fullQuestions;
        if (battleState.activeRoom) {
            battleState.activeRoom.questionIds = payload.fullQuestions.map(q => q.id);
        }
    }

    const box = document.getElementById("battle-countdown-box");
    const secondsEl = document.getElementById("battle-countdown-seconds");
    if (box) box.classList.remove("hidden");

    let count = 3;
    if (secondsEl) secondsEl.innerText = count;

    const interval = setInterval(() => {
        count--;
        if (secondsEl) secondsEl.innerText = count;
        if (count <= 0) {
            clearInterval(interval);
            if (box) box.classList.add("hidden");
            startLiveBattleMatch();
        }
    }, 1000);
}

/**
 * Anti-Cheat Focus Guard: Warns or locks questions if student switches tabs during match
 */
function setupAntiCheatFocusGuard() {
    if (typeof document === 'undefined') return;
    if (window._champVisibilityHandler) {
        document.removeEventListener("visibilitychange", window._champVisibilityHandler);
    }
    battleState.tabBlurCount = 0;

    window._champVisibilityHandler = () => {
        if (document.visibilityState === "hidden" && battleState.gameStatus === "arena") {
            battleState.tabBlurCount = (battleState.tabBlurCount || 0) + 1;
            if (battleState.tabBlurCount === 1) {
                window.showToast?.("⚠️ تنبيه نزاهة الاختبار", "ممنوع مغادرة شاشة البطولة أو التبديل بين التبويبات! تكرار ذلك سيؤدي لقفل السؤال تلقائياً.", "warning");
            } else {
                window.showToast?.("🚨 مخالفة نزاهة الاختبار", "تم رصد مغادرة شاشة الاختبار مجدداً. تم حسم السؤال الحالي.", "danger");
                const currentQ = battleState.questions[battleState.currentQuestionIndex];
                if (currentQ && !battleState.myAnswerLocked) {
                    lockAndSubmitCurrentAnswer(currentQ, true);
                }
            }
        }
    };
    document.addEventListener("visibilitychange", window._champVisibilityHandler);
}

function removeAntiCheatFocusGuard() {
    if (typeof document !== 'undefined' && window._champVisibilityHandler) {
        document.removeEventListener("visibilitychange", window._champVisibilityHandler);
        window._champVisibilityHandler = null;
    }
}

/**
 * BeforeUnload Guard: Prevents accidental tab close, back swipe or page reload during matches
 */
function setupBeforeUnloadGuard() {
    if (typeof window === 'undefined') return;
    if (window._battleBeforeUnloadHandler) {
        window.removeEventListener("beforeunload", window._battleBeforeUnloadHandler);
    }
    window._battleBeforeUnloadHandler = (e) => {
        if (battleState.gameStatus === "arena" || battleState.gameStatus === "waiting") {
            e.preventDefault();
            e.returnValue = "هل أنت متأكد من مغادرة شاشة المباراة؟ سيؤدي ذلك لانسحابك وخسارتك تلقائياً!";
            return e.returnValue;
        }
    };
    window.addEventListener("beforeunload", window._battleBeforeUnloadHandler);
}

function removeBeforeUnloadGuard() {
    if (typeof window === 'undefined') return;
    if (window._battleBeforeUnloadHandler) {
        window.removeEventListener("beforeunload", window._battleBeforeUnloadHandler);
        window._battleBeforeUnloadHandler = null;
    }
}

/**
 * Launch the Live Match in the Arena
 */
function startLiveBattleMatch() {
    battleState.currentQuestionIndex = 0;
    battleState.myScore = 0;
    battleState.opponentScore = 0;
    battleState.myAnswers = {};
    battleState.opponentAnswers = {};

    setupAntiCheatFocusGuard();
    setupBeforeUnloadGuard();

    switchBattleSubscreen("arena");
    setupArenaHUD();
    renderCurrentArenaQuestion();
}

/**
 * Setup Arena HUD with 5-Character Player Names & Avatars
 */
function setupArenaHUD() {
    const currentUser = getActiveUser();
    const opponent = battleState.activeRoom?.opponent;

    const myName = formatUserDisplay(currentUser);
    const opName = opponent?.displayName || formatUserDisplay(opponent);

    const p1Name = document.getElementById("battle-arena-p1-name");
    const p1Avatar = document.getElementById("battle-arena-p1-avatar");
    const p1Score = document.getElementById("battle-arena-p1-score");

    const p2Name = document.getElementById("battle-arena-p2-name");
    const p2Avatar = document.getElementById("battle-arena-p2-avatar");
    const p2Score = document.getElementById("battle-arena-p2-score");

    if (p1Name) p1Name.innerText = myName;
    if (p1Avatar) p1Avatar.innerText = myName[0];
    if (p1Score) p1Score.innerText = "0 pts";

    if (p2Name) p2Name.innerText = opName;
    if (p2Avatar) p2Avatar.innerText = opName[0];
    if (p2Score) p2Score.innerText = "0 pts";
}

/**
 * Render Active Question and start Countdown Timer
 * Uses native platform classes (.choice-btn, .choice-letter, .choice-text)
 */
function renderCurrentArenaQuestion() {
    clearInterval(battleState.timerInterval);

    const idx = battleState.currentQuestionIndex;
    const total = battleState.questions.length;

    if (idx >= total) {
        finishBattleMatch();
        return;
    }

    const q = battleState.questions[idx];
    if (!q) {
        finishBattleMatch();
        return;
    }

    battleState.myAnswered = false;
    battleState.opponentAnswered = false;
    battleState.myCurrentSelection = null;
    battleState.myAnswerLocked = false;
    battleState.opponentAnswerLocked = false;

    // Reset Player Badges to "Thinking..."
    const p1Status = document.getElementById("battle-arena-p1-status");
    const p2Status = document.getElementById("battle-arena-p2-status");
    if (p1Status) {
        p1Status.innerText = "Thinking...";
        p1Status.style.background = "rgba(59, 130, 246, 0.15)";
        p1Status.style.color = "#3b82f6";
    }
    if (p2Status) {
        p2Status.innerText = "Thinking...";
        p2Status.style.background = "rgba(239, 68, 68, 0.15)";
        p2Status.style.color = "#ef4444";
    }

    // Question Counter & Topic
    const counterEl = document.getElementById("battle-question-counter");
    if (counterEl) counterEl.innerText = `Question ${idx + 1} of ${total}`;

    const topicEl = document.getElementById("battle-q-topic-tag");
    if (topicEl) topicEl.innerText = `${q.source || 'Medical Case'} • ${q.topic || 'General'}`;

    const textEl = document.getElementById("battle-q-text");
    if (textEl) textEl.innerHTML = q.text;

    // Options Container using Native Platform .choice-btn
    const optionsContainer = document.getElementById("battle-options-container");
    if (!optionsContainer) return;
    optionsContainer.innerHTML = "";

    const opts = q.options || {};
    const keys = ["A", "B", "C", "D", "E"].filter(k => !!opts[k]);

    keys.forEach(k => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choice-btn battle-option-btn";
        btn.id = `battle-opt-${k}`;

        btn.innerHTML = `
            <span class="choice-letter">${k}</span>
            <span class="choice-text">${opts[k]}</span>
        `;

        btn.onclick = () => handlePlayerSelectAnswer(k, q);
        optionsContainer.appendChild(btn);
    });

    // Dynamic Action Row below Options for Confirm Button & Hint
    let actionRow = document.getElementById("battle-arena-action-row");
    if (!actionRow) {
        actionRow = document.createElement("div");
        actionRow.id = "battle-arena-action-row";
        actionRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-top: 18px; flex-wrap: wrap; gap: 12px;";
        optionsContainer.parentNode.appendChild(actionRow);
    }
    actionRow.innerHTML = `
        <span id="battle-selection-hint" style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">
            <i class="fa-solid fa-hand-pointer"></i> يمكنك تغيير إجابتك بحرية طالما العداد شغال
        </span>
        <button type="button" id="battle-btn-confirm" class="btn btn-primary" style="display: none; font-weight: 700; padding: 8px 20px; border-radius: 8px; font-size: 0.9rem; align-items: center; gap: 6px;">
            <i class="fa-solid fa-check-circle"></i> تأكيد الإجابة ⚡
        </button>
    `;

    const btnConfirm = document.getElementById("battle-btn-confirm");
    if (btnConfirm) {
        btnConfirm.onclick = () => lockAndSubmitCurrentAnswer(q, false);
    }

    // Start Timer
    battleState.totalTime = battleState.activeRoom?.timeLimit || 30;
    battleState.timeRemaining = battleState.totalTime;

    const timerEl = document.getElementById("battle-arena-timer");
    const progressEl = document.getElementById("battle-timer-progress");
    if (timerEl) timerEl.innerText = battleState.timeRemaining;
    if (progressEl) progressEl.style.width = "100%";

    battleState.timerInterval = setInterval(() => {
        battleState.timeRemaining--;
        if (timerEl) timerEl.innerText = battleState.timeRemaining;
        if (progressEl) {
            const pct = (battleState.timeRemaining / battleState.totalTime) * 100;
            progressEl.style.width = `${Math.max(0, pct)}%`;
        }

        if (battleState.timeRemaining <= 0) {
            clearInterval(battleState.timerInterval);
            // AUTO-SUBMIT: Whatever choice is selected when timer reaches 0 is counted 100%!
            lockAndSubmitCurrentAnswer(q, true);
        }
    }, 1000);
}

/**
 * Handle Current Player Selecting an Answer Option (Allows changing choice anytime before lock)
 */
function handlePlayerSelectAnswer(selectedKey, question) {
    if (battleState.myAnswerLocked) return;
    battleState.myCurrentSelection = selectedKey;

    // Highlight selected button, clear others
    const allBtns = document.querySelectorAll(".battle-option-btn");
    allBtns.forEach(b => b.classList.remove("selected"));

    const selectedBtn = document.getElementById(`battle-opt-${selectedKey}`);
    if (selectedBtn) {
        selectedBtn.classList.add("selected");
    }

    // Reveal and enable confirm button
    const btnConfirm = document.getElementById("battle-btn-confirm");
    if (btnConfirm) {
        btnConfirm.style.display = "inline-flex";
    }

    const hint = document.getElementById("battle-selection-hint");
    if (hint) {
        hint.innerHTML = `<i class="fa-solid fa-check-circle" style="color: #10b981;"></i> تم اختيار <strong>[${selectedKey}]</strong> (يمكنك التغيير أو التأكيد الآن)`;
    }

    // Status badge: Selected
    const p1Status = document.getElementById("battle-arena-p1-status");
    if (p1Status) {
        p1Status.innerText = "Selected ✓";
        p1Status.style.background = "rgba(59, 130, 246, 0.2)";
        p1Status.style.color = "#3b82f6";
    }

    // Notify opponent neutrally (without revealing chosen option or points)
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "OPPONENT_SELECTING",
            payload: { hasSelection: true }
        }).catch(() => {});
    }
}

/**
 * Handle Opponent Selecting Event
 */
function handleOpponentSelecting() {
    const p2Status = document.getElementById("battle-arena-p2-status");
    if (p2Status && !battleState.opponentAnswerLocked) {
        p2Status.innerText = "Selected 💭";
        p2Status.style.background = "rgba(239, 68, 68, 0.2)";
        p2Status.style.color = "#ef4444";
    }
}

/**
 * Lock and Submit Current Answer (Called via "تأكيد" button OR automatically on timer timeout)
 */
function lockAndSubmitCurrentAnswer(question, isTimeout = false) {
    if (battleState.myAnswerLocked) return;
    battleState.myAnswerLocked = true;
    battleState.myAnswered = true;

    // Lock option buttons
    const allBtns = document.querySelectorAll(".battle-option-btn");
    allBtns.forEach(b => b.style.pointerEvents = "none");

    const btnConfirm = document.getElementById("battle-btn-confirm");
    if (btnConfirm) {
        btnConfirm.style.display = "none";
    }

    const selectedKey = battleState.myCurrentSelection;
    const isCorrect = (selectedKey && selectedKey === question.correctOption);
    const pointsEarned = isCorrect ? 10 : 0;
    battleState.myScore += pointsEarned;

    const timeRem = battleState.timeRemaining;
    battleState.myAnswers[battleState.currentQuestionIndex] = {
        selected: selectedKey || null,
        correct: question.correctOption,
        isCorrect: !!isCorrect,
        timeRemaining: timeRem,
        points: pointsEarned
    };

    // Update HUD Badge
    const p1Status = document.getElementById("battle-arena-p1-status");
    if (p1Status) {
        p1Status.innerText = selectedKey ? "Locked ⚡" : "Timed Out ⏱️";
        p1Status.style.background = "rgba(16, 185, 129, 0.15)";
        p1Status.style.color = "#10b981";
    }

    const hint = document.getElementById("battle-selection-hint");
    if (hint) {
        hint.innerHTML = selectedKey
            ? `<i class="fa-solid fa-lock" style="color: #10b981;"></i> تم تثبيت اختيارك [${selectedKey}] بنجاح.`
            : `<i class="fa-solid fa-clock" style="color: #ef4444;"></i> انتهى الوقت دون اختيار.`;
    }

    // Broadcast neutral lock notification to opponent (sharing selectedKey for the end-of-match review card)
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "OPPONENT_ANSWERED",
            payload: {
                locked: true,
                selectedKey: selectedKey || null,
                pointsEarned: pointsEarned,
                totalScore: battleState.myScore,
                timeRemaining: timeRem
            }
        }).catch(() => {});
    }

    // Check if both players have locked
    checkBothAnsweredAdvance(question);
}

/**
 * Handle Opponent Answer Broadcast
 */
function handleOpponentAnswered(payload) {
    battleState.opponentAnswered = true;
    battleState.opponentAnswerLocked = true;
    if (typeof payload.totalScore === "number") {
        battleState.opponentScore = payload.totalScore;
    }
    battleState.opponentAnswers[battleState.currentQuestionIndex] = payload;

    const p2Status = document.getElementById("battle-arena-p2-status");
    if (p2Status) {
        p2Status.innerText = payload.selectedKey ? "Locked ⚡" : "Timed Out ⏱️";
        p2Status.style.background = "rgba(16, 185, 129, 0.15)";
        p2Status.style.color = "#10b981";
    }

    const currentQ = battleState.questions[battleState.currentQuestionIndex];
    if (currentQ) {
        checkBothAnsweredAdvance(currentQ);
    }
}

/**
 * Handle In-Match Surrender / Forfeit
 */
export function forfeitBattleMatch() {
    if (battleState.gameStatus !== "arena") return;

    const confirmMsg = "هل أنت متأكد من الانسحاب من هذه الجولة؟ سيُعلن الخصم فائزاً تلقائياً.";
    if (!confirm(confirmMsg)) return;

    clearInterval(battleState.timerInterval);

    const currentUser = getActiveUser();
    const myName = formatUserDisplay(currentUser);
    const myId = currentUser?.id || currentUser?.email;

    // Record forfeit in championship match metadata if applicable
    if (battleState.activeRoom?.isChampionship && battleState.activeRoom?.championshipMatch) {
        const cMatch = battleState.activeRoom.championshipMatch;
        cMatch.status = "forfeit";
        cMatch.match_meta = cMatch.match_meta || {};
        cMatch.match_meta.forfeit_by = myId;
        cMatch.score_text = `انسحاب المتسابق (${myName})`;
    }

    // Notify opponent
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "PLAYER_FORFEIT",
            payload: { forfeitedBy: myName, forfeitedId: myId }
        });
    }

    battleState.myScore = 0;
    battleState.opponentScore = Math.max(battleState.opponentScore, 30);
    window.showToast?.("Surrendered", "لقد أعلنت انسحابك من الجولة.", "warning");
    finishBattleMatch();
}

function handleOpponentForfeit(payload) {
    clearInterval(battleState.timerInterval);
    window.showToast?.("🏆 Opponent Surrendered!", `أعلن الخصم (${payload.forfeitedBy}) انسحابه! تم احتساب الفوز لك!`, "success");
    
    if (battleState.activeRoom?.isChampionship && battleState.activeRoom?.championshipMatch) {
        const cMatch = battleState.activeRoom.championshipMatch;
        cMatch.status = "forfeit";
        cMatch.match_meta = cMatch.match_meta || {};
        cMatch.match_meta.forfeit_by = payload.forfeitedId || payload.forfeitedBy;
        cMatch.score_text = `فوز بانسحاب الخصم (${payload.forfeitedBy})`;
    }

    battleState.opponentScore = 0;
    battleState.myScore = Math.max(battleState.myScore, 30);
    finishBattleMatch();
}

/**
 * Handle Question Timeout (0 seconds left)
 */
function handleQuestionTimeout(question) {
    lockAndSubmitCurrentAnswer(question, true);
}

/**
 * Check if both players have submitted and advance
 */
function checkBothAnsweredAdvance(question) {
    if (battleState.myAnswerLocked && battleState.opponentAnswerLocked) {
        clearInterval(battleState.timerInterval);
        advanceToNextQuestionClean();
    }
}

/**
 * Clean transition without showing green/red answers mid-match (Zero-Reveal)
 */
function advanceToNextQuestionClean() {
    const p1Status = document.getElementById("battle-arena-p1-status");
    const p2Status = document.getElementById("battle-arena-p2-status");
    if (p1Status) p1Status.innerText = "Next Q...";
    if (p2Status) p2Status.innerText = "Next Q...";

    setTimeout(() => {
        battleState.currentQuestionIndex++;
        renderCurrentArenaQuestion();
    }, 900);
}

/**
 * Finish Match and Display Celebratory Results
 */
function finishBattleMatch() {
    clearInterval(battleState.timerInterval);
    removeAntiCheatFocusGuard();
    removeBeforeUnloadGuard();

    // Free server room capacity slot immediately
    if (battleState.activeRoom?.isHost && battleState.lobbyChannel) {
        try { battleState.lobbyChannel.untrack(); } catch(e) {}
    }

    switchBattleSubscreen("results");

    const myScore = battleState.myScore;
    const opScore = battleState.opponentScore;
    const isChampionship = !!(battleState.activeRoom?.isChampionship && battleState.activeRoom?.championshipMatch);
    let evalRes = null;

    // Championship Match Recording & Winner Advancement
    if (isChampionship) {
        const cMatch = battleState.activeRoom.championshipMatch;
        if (cMatch.status !== "forfeit") {
            cMatch.status = "completed";
        }
        if (battleState.activeRoom.role === "p1") {
            cMatch.p1_score = myScore;
            cMatch.p2_score = opScore;
        } else {
            cMatch.p1_score = opScore;
            cMatch.p2_score = myScore;
        }
        
        evalRes = evaluateMatchResult(cMatch);
        cMatch.winner_id = evalRes.winner_id;
        
        // Eliminate the loser from subsequent matches
        const loserId = evalRes.loser_id;
        if (loserId) {
            const loserPart = (champState.participants || []).find(p => p.id === loserId);
            if (loserPart) {
                loserPart.eliminated = true;
            }
        }

        // Advance winner to the next round slot
        if (evalRes.winner_id && cMatch.next_match_id) {
            advanceWinnerToNextRound(champState.matches, cMatch.id, evalRes.winner_id);
        }

        try {
            const group = getActiveGroupName();
            saveChampionshipToLocalCache(group);
            renderChampionshipHub("battle-championship-container", getActiveUser());
        } catch(e) {}
    }

    const currentUser = getActiveUser();
    const opponent = battleState.activeRoom?.opponent;
    const myName = formatUserDisplay(currentUser);
    const opName = opponent?.displayName || formatUserDisplay(opponent);

    const iconEl = document.getElementById("battle-result-icon");
    const titleEl = document.getElementById("battle-result-title");
    const subEl = document.getElementById("battle-result-subtitle");

    if (myScore > opScore) {
        if (iconEl) iconEl.innerText = "🏆";
        if (titleEl) {
            titleEl.innerText = "VICTORY!";
            titleEl.style.color = "#10b981";
        }
        if (subEl) subEl.innerText = `Congratulations ${myName}! You outscored your colleague with clinical speed & precision.`;
    } else if (myScore < opScore) {
        if (iconEl) iconEl.innerText = "⚔️";
        if (titleEl) {
            titleEl.innerText = "DEFEAT";
            titleEl.style.color = "#ef4444";
        }
        if (subEl) subEl.innerText = "A close battle! Review the clinical explanations below to master these concepts.";
    } else {
        if (isChampionship && evalRes?.winner_id) {
            const isWinner = (evalRes.winner_id === currentUser?.id || evalRes.winner_id === currentUser?.email);
            if (isWinner) {
                if (iconEl) iconEl.innerText = "🏆";
                if (titleEl) {
                    titleEl.innerText = "VICTORY BY TIE-BREAKER!";
                    titleEl.style.color = "#10b981";
                }
                const reasonText = evalRes.reason === 'speed_tiebreaker' 
                    ? `مبارك د. ${myName}! تم كسر التعادل واحتساب الفوز لك بأفضلية سرعة الإجابة بالميلي ثانية! ⚡`
                    : `مبارك د. ${myName}! تم كسر التعادل المطلق لصالحك وفقاً للأفضلية التصنيفية في قرعة البطولة (Seed) 🎯`;
                if (subEl) subEl.innerText = reasonText;
            } else {
                if (iconEl) iconEl.innerText = "⚔️";
                if (titleEl) {
                    titleEl.innerText = "DEFEAT BY TIE-BREAKER";
                    titleEl.style.color = "#ef4444";
                }
                const reasonText = evalRes.reason === 'speed_tiebreaker'
                    ? "تعادل في النقاط، ولكن الخصم تفوق بفارق سرعة الإجابة بالميلي ثانية. ⚡"
                    : "تعادل تام في النقاط والسرعة! رجحت كفة الخصم وفقاً للأفضلية التصنيفية في القرعة (Seed).";
                if (subEl) subEl.innerText = reasonText;
            }
        } else {
            if (iconEl) iconEl.innerText = "🤝";
            if (titleEl) {
                titleEl.innerText = "IT'S A DRAW!";
                titleEl.style.color = "#3b82f6";
            }
            if (subEl) subEl.innerText = "Perfect parity! Both competitors matched each other's score and timing.";
        }
    }

    // Populate comparison table with 5-character display names
    const myCorrect = Object.values(battleState.myAnswers).filter(a => a.isCorrect).length;
    const totalQ = battleState.questions.length;

    const p1LabelEl = document.getElementById("battle-res-p1-label");
    const p1ScoreEl = document.getElementById("battle-res-p1-score");
    const p1StatsEl = document.getElementById("battle-res-p1-stats");

    const p2LabelEl = document.getElementById("battle-res-p2-label");
    const p2ScoreEl = document.getElementById("battle-res-p2-score");
    const p2StatsEl = document.getElementById("battle-res-p2-stats");

    if (p1LabelEl) p1LabelEl.innerText = myName;
    if (p1ScoreEl) p1ScoreEl.innerText = `${myScore} pts`;
    if (p1StatsEl) p1StatsEl.innerText = `${myCorrect}/${totalQ} Correct • ${myScore}/${totalQ * 10} pts`;

    if (p2LabelEl) p2LabelEl.innerText = opName;
    if (p2ScoreEl) p2ScoreEl.innerText = `${opScore} pts`;
    if (p2StatsEl) p2StatsEl.innerText = `Final Score: ${opScore}/${totalQ * 10} pts`;

    // Action Buttons: Hide Rematch in Championship and show Tournament Bracket button
    const btnRematch = document.getElementById("btn-battle-rematch");
    const btnChampBracket = document.getElementById("btn-battle-champ-bracket");
    if (isChampionship) {
        if (btnRematch) btnRematch.classList.add("hidden");
        if (btnChampBracket) btnChampBracket.classList.remove("hidden");
    } else {
        if (btnRematch) {
            btnRematch.classList.remove("hidden");
            btnRematch.disabled = false;
            btnRematch.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Rematch`;
        }
        if (btnChampBracket) btnChampBracket.classList.add("hidden");
    }

    // Render clinical explanations review accordion
    renderBattleReviewList();
}

/**
 * Render clinical explanations review for all questions in the match
 */
function renderBattleReviewList() {
    const list = document.getElementById("battle-review-list");
    if (!list) return;
    list.innerHTML = "";

    const opponent = battleState.activeRoom?.opponent;
    const opName = opponent?.displayName || formatUserDisplay(opponent) || "Colleague";

    battleState.questions.forEach((q, idx) => {
        const myAns = battleState.myAnswers[idx];
        const isCorrect = myAns?.isCorrect;
        const myChoice = myAns?.selected || "None (Timed Out)";

        const opAns = battleState.opponentAnswers[idx];
        const opChoice = opAns?.selectedKey || "None (Timed Out)";
        const opIsCorrect = (opChoice && opChoice === q.correctOption);

        const item = document.createElement("div");
        item.className = "card";
        item.style.cssText = "padding: 16px; margin-bottom: 12px; border-radius: 12px;";
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">Q${idx + 1}: ${q.source || 'Exam'} • ${q.topic || 'Medical Case'}</span>
                <span class="badge" style="font-size: 0.78rem; font-weight: 700; padding: 3px 10px; ${isCorrect ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">
                    ${isCorrect ? 'You: Correct (+10 pts)' : 'You: Incorrect (0 pts)'}
                </span>
            </div>
            <div style="font-size: 0.92rem; color: var(--text-primary); margin-bottom: 10px; line-height: 1.5;">${q.text}</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 0.85rem;">
                <span style="padding: 4px 10px; border-radius: 6px; font-weight: 700; ${isCorrect ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">
                    You: Option [${myChoice}] ${isCorrect ? '(+10 pts)' : '(0 pts)'}
                </span>
                <span style="padding: 4px 10px; border-radius: 6px; font-weight: 700; ${opIsCorrect ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">
                    ${opName}: Option [${opChoice}] ${opIsCorrect ? '(+10 pts)' : '(0 pts)'}
                </span>
                <span style="padding: 4px 10px; border-radius: 6px; font-weight: 700; background: rgba(59,130,246,0.15); color: #3b82f6;">
                    Model Answer: Option [${q.correctOption}]
                </span>
            </div>
            <div style="font-size: 0.86rem; background: var(--bg-primary); border-radius: 8px; padding: 10px 14px; color: var(--text-secondary); line-height: 1.5; border-left: 3px solid var(--primary-color);">
                <strong>Clinical Rationale:</strong> ${q.explanation || 'Verified evidence-based clinical answer.'}
            </div>
        `;
        list.appendChild(item);
    });
}

/**
 * Toggle the Review Questions Section visibility
 */
export function toggleBattleReviewSection() {
    const container = document.getElementById("battle-review-container");
    if (container) container.classList.toggle("hidden");
}

/**
 * Rematch Protocol: Checks opponent presence and sends REMATCH_REQUESTED
 */
export function requestBattleRematch() {
    if (battleState.activeRoom?.isChampionship) {
        window.showToast?.("Rematch Disabled", "جولة الإعادة غير متاحة في مباريات البطولة الرسمية. يرجى متابعة جدول المباريات وشجرة التصفيات.", "info");
        return;
    }

    // 1. Verify opponent is still connected
    const presence = battleState.roomChannel?.presenceState() || {};
    const myEmail = getActiveUser().email;
    let opponentConnected = false;

    Object.keys(presence).forEach(key => {
        const list = presence[key];
        if (Array.isArray(list)) {
            list.forEach(item => {
                if (item.clientId && item.clientId !== battleState.clientSessionId) {
                    opponentConnected = true;
                } else if (!item.clientId && key !== myEmail) {
                    opponentConnected = true;
                }
            });
        }
    });

    if (!opponentConnected) {
        window.showToast?.("Opponent Left", "الخصم غادر الروم بالفعل ولا يمكن عمل جولة إعادة. يرجى العودة للوبي لإنشاء تحدٍ جديد.", "warning");
        return;
    }

    const btnRematch = document.getElementById("btn-battle-rematch");
    if (btnRematch) {
        btnRematch.disabled = true;
        btnRematch.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Waiting for Opponent...`;
    }

    const myName = formatUserDisplay(getActiveUser());
    battleState.roomChannel.send({
        type: "broadcast",
        event: "REMATCH_REQUESTED",
        payload: { requester: myName }
    });

    window.showToast?.("Rematch Offered", "تم إرسال طلب جولة إعادة.. جاري انتظار موافقة الخصم.", "info");

    // Timeout after 20 seconds
    clearTimeout(battleState.rematchTimeout);
    battleState.rematchTimeout = setTimeout(() => {
        if (btnRematch && btnRematch.disabled) {
            btnRematch.disabled = false;
            btnRematch.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Rematch`;
            window.showToast?.("No Response", "لم يستجب الخصم لطلب جولة الإعادة في الوقت المحدد.", "warning");
        }
    }, 20000);
}

/**
 * Handle incoming Rematch Offer Modal
 */
function handleRematchOfferReceived(payload) {
    const requesterName = payload.requester || "Your Opponent";
    const modal = document.getElementById("modal-battle-rematch-request");
    const textEl = document.getElementById("battle-rematch-prompt-text");

    if (textEl) {
        textEl.innerText = `زميلك (${requesterName}) يطلب جولة إعادة بمجموعة أسئلة جديدة! هل توافق؟`;
    }

    if (modal) {
        modal.classList.remove("hidden");
    }
}

/**
 * Accept Rematch: Notify requester and start countdown with synchronized questions
 */
export function acceptBattleRematch() {
    const modal = document.getElementById("modal-battle-rematch-request");
    if (modal) modal.classList.add("hidden");

    const pool = getFilteredBattleQuestions();
    const shuffled = shuffleArray([...pool]);
    const count = battleState.activeRoom?.count || 10;
    const selectedQuestions = shuffled.slice(0, Math.min(count, pool.length));
    const questionIds = selectedQuestions.map(q => q.id);

    battleState.questions = selectedQuestions;

    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "REMATCH_ACCEPTED",
            payload: {
                questionIds: questionIds,
                fullQuestions: selectedQuestions
            }
        });
    }

    window.showToast?.("Rematch Accepted", "تم قبول التحدي! جاري تجهيز الجولة الجديدة...", "success");
    triggerRoomCountdown();
}

/**
 * Decline Rematch: Notify requester and leave room
 */
export function declineBattleRematch() {
    const modal = document.getElementById("modal-battle-rematch-request");
    if (modal) modal.classList.add("hidden");

    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "REMATCH_DECLINED"
        });
    }

    leaveBattleRoom();
}

function handleRematchAcceptedByOpponent(payload) {
    clearTimeout(battleState.rematchTimeout);
    window.showToast?.("Rematch Accepted!", "وافق الخصم على التحدي! جاري انطلاق الجولة الجديدة...", "success");

    if (payload && Array.isArray(payload.questionIds)) {
        const pool = getQuestionsBase();
        const questionMap = new Map(pool.map(q => [q.id, q]));
        let resolved = payload.questionIds.map(id => questionMap.get(id)).filter(Boolean);
        if (resolved.length < payload.questionIds.length && Array.isArray(payload.fullQuestions)) {
            resolved = payload.fullQuestions;
        }
        battleState.questions = resolved;
    } else {
        const pool = getFilteredBattleQuestions();
        const shuffled = shuffleArray([...pool]);
        battleState.questions = shuffled.slice(0, battleState.activeRoom?.count || 10);
    }

    triggerRoomCountdown();
}

function handleRematchDeclinedByOpponent() {
    clearTimeout(battleState.rematchTimeout);
    const btnRematch = document.getElementById("btn-battle-rematch");
    if (btnRematch) {
        btnRematch.disabled = false;
        btnRematch.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Rematch`;
    }
    window.showToast?.("Rematch Declined", "اعتذر الخصم عن جولة الإعادة وغادر الروم.", "info");
}

/**
 * Leave Battle Room and return to Lobby
 */
export function returnToBattleLobby() {
    leaveBattleRoom();
}

export function leaveBattleRoom() {
    clearInterval(battleState.timerInterval);
    removeAntiCheatFocusGuard();
    removeBeforeUnloadGuard();
    clearInterval(battleState.guestHandshakeInterval);
    battleState.guestHandshakeInterval = null;
    clearTimeout(battleState.rematchTimeout);
    clearTimeout(battleState.guestWaitTimeout);
    battleState.guestWaitTimeout = null;
    clearTimeout(opponentReconnectTimeout);
    clearInterval(opponentReconnectInterval);
    opponentReconnectTimeout = null;
    opponentReconnectInterval = null;
    hideOpponentReconnectingBanner();

    const modal = document.getElementById("modal-battle-rematch-request");
    if (modal) modal.classList.add("hidden");

    if (battleState.roomChannel) {
        try {
            const client = getBattleSupabaseClient();
            if (client) client.removeChannel(battleState.roomChannel);
            else battleState.roomChannel.unsubscribe();
        } catch(e) {}
        battleState.roomChannel = null;
    }

    if (battleState.activeRoom?.isHost && battleState.lobbyChannel) {
        try { battleState.lobbyChannel.untrack(); } catch(e) {}
    }

    const wasChamp = battleState.activeRoom?.isChampionship;
    battleState.activeRoom = null;
    battleState.questions = [];
    if (wasChamp) {
        switchBattleArenaMode("championship");
    } else {
        switchBattleSubscreen("lobby");
    }
}

/**
 * Quick Matchmaking Engine
 */
export async function startQuickMatchmaking() {
    if (!verifyServerRoomCapacity()) return;

    const currentUser = getActiveUser();
    const userDisplayName = formatUserDisplay(currentUser);

    const idleView = document.getElementById("battle-matchmaking-idle-view");
    const searchingView = document.getElementById("battle-matchmaking-searching-view");
    if (idleView) idleView.classList.add("hidden");
    if (searchingView) searchingView.classList.remove("hidden");

    battleState.isSearchingMatch = true;

    // 1. Check if any random waiting room is available
    let availableRoom = null;
    battleState.activeRoomsMap.forEach((room) => {
        if (room.mode === "random" && room.status === "waiting" && room.hostEmail !== currentUser.email) {
            availableRoom = room;
        }
    });

    if (availableRoom) {
        window.showToast?.("Opponent Matched!", `Connected with ${availableRoom.hostDisplayName || 'Peer'}. Starting duel!`, "success");
        cancelQuickMatchmaking();
        joinBattleRoomByCode(availableRoom.roomId);
        return;
    }

    // 2. Otherwise, host an open random room
    const code = "HAW-" + Math.floor(100 + Math.random() * 900);
    const pool = getQuestionsBase();
    const shuffled = shuffleArray([...pool]);
    const selectedQuestions = shuffled.slice(0, 10);
    const questionIds = selectedQuestions.map(q => q.id);

    battleState.activeRoom = {
        id: code,
        code: code,
        source: "all",
        count: 10,
        timeLimit: 30,
        isHost: true,
        role: "p1",
        questionIds: questionIds,
        opponent: null
    };
    battleState.questions = selectedQuestions;

    if (battleState.lobbyChannel) {
        try {
            await battleState.lobbyChannel.track({
                isRoomHost: true,
                roomId: code,
                source: "all",
                count: 10,
                timeLimit: 30,
                mode: "random",
                status: "waiting",
                hostEmail: currentUser.email,
                hostDisplayName: userDisplayName,
                createdAt: Date.now()
            });
        } catch(e) {}
    }

    joinRoomChannel(code, true);

    // Timeout after 45 seconds if no match found
    battleState.matchSearchTimeout = setTimeout(() => {
        if (battleState.isSearchingMatch) {
            cancelQuickMatchmaking();
            leaveBattleRoom();
            window.showToast?.("No Opponent Found", "No competitors are currently online. Share a room code with your colleague!", "info");
        }
    }, 45000);
}

export function cancelQuickMatchmaking() {
    battleState.isSearchingMatch = false;
    clearTimeout(battleState.matchSearchTimeout);

    const idleView = document.getElementById("battle-matchmaking-idle-view");
    const searchingView = document.getElementById("battle-matchmaking-searching-view");
    if (idleView) idleView.classList.remove("hidden");
    if (searchingView) searchingView.classList.add("hidden");
}

/**
 * Copy Battle Room Code to Clipboard
 */
export function copyBattleRoomCode() {
    const code = battleState.activeRoom?.code || "";
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
        window.showToast?.("Code Copied", `Room Code ${code} copied to clipboard.`, "success");
    }).catch(() => {
        prompt("Copy Room Code:", code);
    });
}

let opponentReconnectTimeout = null;
let opponentReconnectInterval = null;

function showOpponentReconnectingBanner(secondsLeft) {
    let banner = document.getElementById("battle-reconnecting-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "battle-reconnecting-banner";
        banner.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 99999; background: #f59e0b; color: #fff; padding: 12px 24px; border-radius: 14px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 10px; font-size: 0.92rem; border: 2px solid rgba(255,255,255,0.4);";
        document.body.appendChild(banner);
    }
    banner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>الخصم انقطع اتصاله لحظياً.. في انتظار عودته (${secondsLeft}s)...</span>`;
    banner.classList.remove("hidden");
}

function hideOpponentReconnectingBanner() {
    const banner = document.getElementById("battle-reconnecting-banner");
    if (banner) banner.classList.add("hidden");
}

/**
 * Handle Opponent Leaving or Disconnecting with 12-second Grace Period
 */
function handleOpponentLeave(key) {
    if (battleState.gameStatus === "arena") {
        if (opponentReconnectTimeout) return; // already in grace period

        let secondsLeft = 12;
        showOpponentReconnectingBanner(secondsLeft);

        opponentReconnectInterval = setInterval(() => {
            secondsLeft--;
            if (secondsLeft > 0) {
                showOpponentReconnectingBanner(secondsLeft);
            } else {
                clearInterval(opponentReconnectInterval);
            }
        }, 1000);

        opponentReconnectTimeout = setTimeout(() => {
            clearInterval(opponentReconnectInterval);
            opponentReconnectTimeout = null;
            hideOpponentReconnectingBanner();

            window.showToast?.("Opponent Disconnected", "انتهت مهلة إعادة اتصال الخصم. تم احتساب الفوز لك بالانسحاب!", "warning");
            battleState.myScore += 30;
            finishBattleMatch();
        }, 12000);
    }
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Main View Renderer called by router (switchView('battle-room'))
 */

/**
 * Switch between Instant 1v1 and Championship Leagues Sub-Tabs
 */
export function switchBattleArenaMode(mode) {
    const btnQuick = document.getElementById("btn-battle-subtab-quick");
    const btnChamp = document.getElementById("btn-battle-subtab-champ");
    const champContainer = document.getElementById("battle-championship-container");
    const quickLobby = document.getElementById("battle-screen-lobby");

    if (mode === "championship") {
        if (btnQuick) {
            btnQuick.classList.remove("btn-primary");
            btnQuick.classList.add("btn-secondary");
        }
        if (btnChamp) {
            btnChamp.classList.remove("btn-secondary");
            btnChamp.classList.add("btn-primary");
        }
        if (quickLobby) quickLobby.classList.add("hidden");
        if (champContainer) {
            champContainer.classList.remove("hidden");
            renderChampionshipHub("battle-championship-container", getActiveUser());
        }
    } else {
        if (btnQuick) {
            btnQuick.classList.remove("btn-secondary");
            btnQuick.classList.add("btn-primary");
        }
        if (btnChamp) {
            btnChamp.classList.remove("btn-primary");
            btnChamp.classList.add("btn-secondary");
        }
        if (champContainer) champContainer.classList.add("hidden");
        if (quickLobby) quickLobby.classList.remove("hidden");
    }
}

/**
 * Launch Championship Match in Arena
 */
export function launchChampionshipArena(match) {
    const currentUser = getActiveUser();
    const userEmail = (currentUser && currentUser.email) ? currentUser.email.toLowerCase().trim() : "";
    
    const isP1 = (match.player1_info && match.player1_info.email.toLowerCase() === userEmail);
    const opponent = isP1 ? match.player2_info : match.player1_info;
    const opponentName = opponent ? opponent.student_name : "Competitor";

    battleState.activeRoom = {
        id: match.id,
        code: match.id,
        source: "Championship",
        topicMode: "mixed",
        count: 5,
        timeLimit: 20,
        isHost: isP1,
        role: isP1 ? "p1" : "p2",
        isChampionship: true,
        championshipMatch: match,
        opponent: {
            email: opponent ? opponent.email : "opponent@hawari.edu",
            displayName: opponentName,
            name: opponentName,
            avatar: opponentName.slice(0, 2).toUpperCase()
        }
    };

    const roundName = match.round_name || 'round_32';
    let matchQuestions = [];
    if (champState.activeChampionship?.round_questions?.[roundName]?.length > 0) {
        matchQuestions = champState.activeChampionship.round_questions[roundName];
    } else {
        const pool = getFilteredBattleQuestions();
        matchQuestions = pool.slice(0, 5);
    }
    battleState.activeRoom.questionIds = matchQuestions.map(q => q.id);
    battleState.questions = matchQuestions;
    battleState.gameStatus = "waiting";

    // Mark current player entered in match metadata
    match.match_meta = match.match_meta || {};
    if (isP1) {
        match.match_meta.p1_entered = true;
        match.match_meta.p1_entered_at = Date.now();
    } else {
        match.match_meta.p2_entered = true;
        match.match_meta.p2_entered_at = Date.now();
    }
    const group = getActiveGroupName ? getActiveGroupName() : 'infection';
    saveChampionshipToLocalCache(group);

    // Connect to Supabase Realtime channel for presence and live coordination
    joinRoomChannel(match.id, isP1);

    // Launch Waiting & Preparation Room with 3-minute grace countdown protocol
    showChampionshipWaitingRoom(match);
}

/**
 * Render Championship Waiting Room with 3-Minute Grace Countdown & Mandatory Opponent Presence
 */
export function showChampionshipWaitingRoom(match) {
    if (battleState.prepTimerInterval) {
        clearInterval(battleState.prepTimerInterval);
        battleState.prepTimerInterval = null;
    }

    let overlay = document.getElementById("champ-match-waiting-modal");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "champ-match-waiting-modal";
        document.body.appendChild(overlay);
    }

    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(10, 15, 30, 0.90); backdrop-filter: blur(8px); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; direction: rtl;";

    const currentUser = getActiveUser();
    const userEmail = (currentUser && currentUser.email) ? currentUser.email.toLowerCase().trim() : "";
    const isP1 = (match.player1_info && match.player1_info.email.toLowerCase() === userEmail);
    const roundLabel = ROUND_LABELS[match.round_name] || match.round_name;
    const p1Name = match.player1_info?.student_name || "المتسابق الأول";
    const p2Name = match.player2_info?.student_name || "المتسابق الثاني";
    const qCount = battleState.questions.length;
    const group = getActiveGroupName ? getActiveGroupName() : 'infection';

    let phase = 'prep'; // 'prep' (60s prep) or 'grace' (180s = 3 min grace)
    let secondsLeft = 60;
    let graceSecondsLeft = 180;
    let opponentPresent = false;

    // Helper to check if opponent is in room
    const isOpponentOnline = () => {
        // 1. Check Realtime presence
        if (battleState.roomChannel) {
            const pres = battleState.roomChannel.presenceState();
            let found = false;
            Object.keys(pres).forEach(k => {
                const arr = pres[k];
                if (Array.isArray(arr)) {
                    arr.forEach(u => {
                        if (u.clientId && u.clientId !== battleState.clientSessionId) found = true;
                        else if (u.email && u.email.toLowerCase() !== userEmail) found = true;
                    });
                }
            });
            if (found) return true;
        }

        // 2. Check match_meta in memory
        const currentM = (champState.matches || []).find(m => m.id === match.id) || match;
        if (isP1 && currentM.match_meta?.p2_entered) return true;
        if (!isP1 && currentM.match_meta?.p1_entered) return true;

        // 3. Check localStorage cache for cross-tab or concurrent sync
        try {
            const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                const mCached = (parsed.matches || []).find(m => m.id === match.id);
                if (mCached && mCached.match_meta) {
                    if (isP1 && mCached.match_meta.p2_entered) return true;
                    if (!isP1 && mCached.match_meta.p1_entered) return true;
                }
            }
        } catch (e) {}

        return false;
    };

    // Ping callback from joinRoomChannel broadcast
    window.onChampOpponentPing = () => {
        opponentPresent = true;
        updateUI();
    };

    const renderOverlayContent = () => {
        const curSeconds = (phase === 'prep') ? secondsLeft : graceSecondsLeft;
        const mins = Math.floor(curSeconds / 60);
        const secs = curSeconds % 60;
        const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        overlay.innerHTML = `
            <div style="background: var(--bg-primary, #1e293b); border: 2px solid ${phase === 'grace' ? '#ef4444' : 'rgba(245, 158, 11, 0.4)'}; border-radius: 20px; width: 100%; max-width: 620px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: center; color: var(--text-primary, #ffffff); font-family: inherit;">
                
                <!-- TOP HEADER -->
                <div style="display: flex; justify-content: center; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: ${phase === 'grace' ? 'linear-gradient(135deg, #ef4444, #b91c1c)' : 'linear-gradient(135deg, #f59e0b, #d97706)'}; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; color: #ffffff; box-shadow: 0 4px 14px ${phase === 'grace' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)'};">
                        <i class="fa-solid ${phase === 'grace' ? 'fa-clock' : 'fa-trophy'}"></i>
                    </div>
                    <div style="text-align: right;">
                        <h2 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: var(--text-primary);">
                            ${phase === 'grace' ? '⏳ مهلة انتظار الخصم الرسمية (3 دقائق)' : 'غرفة الاستعداد للمباراة الرسمية'}
                        </h2>
                        <span style="font-size: 0.85rem; color: ${phase === 'grace' ? '#ef4444' : '#f59e0b'}; font-weight: 700;">${roundLabel} &bull; مباراة رقم #${match.match_order}</span>
                    </div>
                </div>

                <!-- PLAYERS MATCHUP BADGE -->
                <div style="background: var(--bg-secondary, #0f172a); border-radius: 14px; padding: 14px 18px; margin-bottom: 20px; border: 1px solid var(--border-color, rgba(255,255,255,0.1)); display: flex; justify-content: space-around; align-items: center;">
                    <div style="font-weight: 700; color: ${isP1 ? '#3b82f6' : 'var(--text-primary)'}; font-size: 0.95rem;">
                        <i class="fa-solid fa-circle" style="color: #10b981; font-size: 0.7rem; margin-left: 6px;"></i>
                        د. ${p1Name} ${isP1 ? '<span class="badge" style="background: #3b82f6; color: white; font-size: 0.7rem; margin-right: 4px;">أنت</span>' : (opponentPresent ? '<span class="badge" style="background: #10b981; color: white; font-size: 0.7rem;">حاضر 🟢</span>' : '<span class="badge" style="background: #f59e0b; color: white; font-size: 0.7rem;">بانتظار الدخول ⏳</span>')}
                    </div>
                    <div style="font-weight: 900; color: #ef4444; font-size: 1.1rem; padding: 0 10px;">VS</div>
                    <div style="font-weight: 700; color: ${!isP1 ? '#f59e0b' : 'var(--text-primary)'}; font-size: 0.95rem;">
                        <i class="fa-solid fa-circle" style="color: ${(!isP1 || opponentPresent) ? '#10b981' : '#f59e0b'}; font-size: 0.7rem; margin-left: 6px;"></i>
                        د. ${p2Name} ${!isP1 ? '<span class="badge" style="background: #3b82f6; color: white; font-size: 0.7rem; margin-right: 4px;">أنت</span>' : (opponentPresent ? '<span class="badge" style="background: #10b981; color: white; font-size: 0.7rem;">حاضر 🟢</span>' : '<span class="badge" style="background: #f59e0b; color: white; font-size: 0.7rem;">بانتظار الدخول ⏳</span>')}
                    </div>
                </div>

                <!-- COUNTDOWN TIMER -->
                <div style="margin-bottom: 22px; ${phase === 'grace' ? 'background: rgba(239, 68, 68, 0.08); border: 1.5px solid #ef4444; border-radius: 16px; padding: 18px;' : ''}">
                    <span style="font-size: 0.88rem; color: ${phase === 'grace' ? '#ef4444' : 'var(--text-muted)'}; display: block; margin-bottom: 6px; font-weight: 700;">
                        ${phase === 'grace' ? '⏳ العداد التنازلي لمهلة الـ 3 دقائق (فوز بالانسحاب عند الانتهاء):' : 'العد التنازلي للاستعداد لبدء الامتحان:'}
                    </span>
                    <div id="champ-prep-timer-display" style="font-size: 3rem; font-weight: 900; color: ${phase === 'grace' ? '#ef4444' : '#f59e0b'}; font-family: monospace; letter-spacing: 3px; line-height: 1;">
                        ${timeStr}
                    </div>
                    ${phase === 'grace' ? `
                        <p style="font-size: 0.85rem; color: #fca5a5; margin: 8px 0 0 0; line-height: 1.5;">
                            الخصم لم ينضم بعد. في حال انتهاء العداد دون دخوله، <strong>سيتم احتسابك فائزاً بالانسحاب (Walkover) وصعودك للدور التالي مباشرة.</strong>
                        </p>
                    ` : `
                        <span style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; display: block;">(${qCount} أسئلة موحدة &bull; 20 ثانية لكل سؤال)</span>
                    `}
                </div>

                <!-- ARABIC INSTRUCTIONS CARD -->
                <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 18px; text-align: right; margin-bottom: 22px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 0.95rem; font-weight: 800; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-shield-halved" style="color: #3b82f6;"></i>
                        تعليمات وقواعد النزاهة الإجبارية:
                    </h4>
                    <ul style="margin: 0; padding: 0 18px 0 0; list-style-type: none; display: flex; flex-direction: column; gap: 10px; font-size: 0.88rem; line-height: 1.6; color: var(--text-secondary);">
                        <li style="display: flex; align-items: flex-start; gap: 8px;">
                            <span style="color: #ef4444; font-size: 1rem;">⚠️</span>
                            <div><strong style="color: #ef4444;">تنبيه هام:</strong> أي خروج أو إغلاق للمتصفح أثناء المباراة يُعتبر انسحاباً وهزيمة فورية.</div>
                        </li>
                        <li style="display: flex; align-items: flex-start; gap: 8px;">
                            <span style="color: #ef4444; font-size: 1rem;">🔒</span>
                            <div><strong style="color: #ef4444;">حظر بدء الأسئلة بمفردك:</strong> يُمنع تماماً بدء الامتحان حتى ينضم المنافس وتتأكد جاهزية الطرفين، مع منح الخصم مهلة 3 دقائق كحد أقصى للحضور.</div>
                        </li>
                        <li style="display: flex; align-items: flex-start; gap: 8px;">
                            <span style="color: #f59e0b; font-size: 1rem;">⚡</span>
                            <div><strong style="color: #f59e0b;">حسم التعادل:</strong> في حال التعادل بالنقاط، يتم احتساب الفائز بناءً على سرعة الإجابة بالمللي ثانية (للإجابات الصحيحة فقط).</div>
                        </li>
                        <li style="display: flex; align-items: flex-start; gap: 8px;">
                            <span style="color: #3b82f6; font-size: 1rem;">⏱️</span>
                            <div><strong style="color: #3b82f6;">وقت الأسئلة:</strong> لكل سؤال وقت محدد، احرص على اختيار الإجابة قبل انتهاء العداد.</div>
                        </li>
                        <li style="display: flex; align-items: flex-start; gap: 8px;">
                            <span style="color: #10b981; font-size: 1rem;">🏆</span>
                            <div><strong style="color: #10b981;">نظام خروج المغلوب:</strong> الفائز يصعد مباشرة للدور التالي، والخاسر يغادر البطولة.</div>
                        </li>
                    </ul>
                </div>

                <!-- ACTIONS -->
                <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button id="btn-champ-start-now" class="btn btn-primary" onclick="window.startChampionshipMatchNow()" ${!opponentPresent ? 'disabled' : ''} style="padding: 12px 28px; font-size: 1rem; font-weight: 800; border-radius: 12px; ${opponentPresent ? 'background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); cursor: pointer;' : 'background: #475569; opacity: 0.65; cursor: not-allowed;'} border: none;">
                        ${opponentPresent ? '<i class="fa-solid fa-play"></i> كليكما حاضر - ابدأ المباراة الآن 🚀' : '<i class="fa-solid fa-lock"></i> بانتظار دخول المنافس... (ممنوع بدء الأسئلة)'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.returnToChampionshipHub()" style="padding: 12px 20px; font-size: 0.9rem; border-radius: 12px;">
                        العودة لجدول المباريات
                    </button>
                </div>
            </div>
        `;
    };

    const updateUI = () => {
        renderOverlayContent();
    };

    renderOverlayContent();

    battleState.prepTimerInterval = setInterval(() => {
        // Broadcast presence ping
        if (battleState.roomChannel) {
            battleState.roomChannel.send({
                type: "broadcast",
                event: "CHAMP_PING",
                payload: { matchId: match.id, role: isP1 ? 'p1' : 'p2', email: userEmail }
            }).catch(() => {});
        }

        const online = isOpponentOnline();
        if (online && !opponentPresent) {
            opponentPresent = true;
            updateUI();
        }

        if (phase === 'prep') {
            secondsLeft--;
            const timerEl = document.getElementById("champ-prep-timer-display");
            if (timerEl) {
                const mins = Math.floor(secondsLeft / 60);
                const secs = secondsLeft % 60;
                timerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }

            if (secondsLeft <= 0) {
                if (opponentPresent) {
                    // Both present! Start match immediately
                    clearInterval(battleState.prepTimerInterval);
                    battleState.prepTimerInterval = null;
                    startChampionshipMatchNow();
                } else {
                    // Opponent NOT present! Switch to 3-minute grace countdown
                    phase = 'grace';
                    graceSecondsLeft = 180;
                    updateUI();
                    window.showToast?.("بدء مهلة الـ 3 دقائق", "الخصم لم ينضم بعد. بدأت مهلة الانتظار القانونية (3 دقائق).", "warning");
                }
            }
        } else if (phase === 'grace') {
            if (opponentPresent) {
                // Opponent arrived during grace countdown!
                clearInterval(battleState.prepTimerInterval);
                battleState.prepTimerInterval = null;
                const timerEl = document.getElementById("champ-prep-timer-display");
                if (timerEl) timerEl.innerText = "00:00";
                window.showToast?.("حضر الخصم!", "دخل المنافس الغرفة، جاري بدء المباراة الآن...", "success");
                setTimeout(() => {
                    startChampionshipMatchNow();
                }, 2000);
                return;
            }

            graceSecondsLeft--;
            const timerEl = document.getElementById("champ-prep-timer-display");
            if (timerEl) {
                const mins = Math.floor(graceSecondsLeft / 60);
                const secs = graceSecondsLeft % 60;
                timerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }

            if (graceSecondsLeft <= 0) {
                // 3 MINUTES EXPIRED! Connected player wins by walkover!
                clearInterval(battleState.prepTimerInterval);
                battleState.prepTimerInterval = null;
                declareChampionshipWalkover(match, currentUser);
            }
        }
    }, 1000);
}

/**
 * Declare Walkover Victory when Opponent fails to join within 3-minute grace period
 */
export function declareChampionshipWalkover(match, currentUser) {
    if (battleState.prepTimerInterval) {
        clearInterval(battleState.prepTimerInterval);
        battleState.prepTimerInterval = null;
    }
    const overlay = document.getElementById("champ-match-waiting-modal");
    if (overlay) overlay.remove();

    const userEmail = (currentUser?.email || "").toLowerCase().trim();
    const group = getActiveGroupName ? getActiveGroupName() : 'infection';

    // Reload latest state from localStorage
    try {
        const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            champState.activeChampionship = parsed.championship || champState.activeChampionship;
            champState.participants = parsed.participants || champState.participants;
            champState.matches = parsed.matches || champState.matches;
        }
    } catch (e) {}

    const cMatch = (champState.matches || []).find(m => m.id === match.id) || match;
    const isP1 = (cMatch.player1_info && cMatch.player1_info.email.toLowerCase().trim() === userEmail);

    const winnerId = isP1 ? cMatch.player1_id : cMatch.player2_id;
    const winnerInfo = isP1 ? cMatch.player1_info : cMatch.player2_info;
    const loserId = isP1 ? cMatch.player2_id : cMatch.player1_id;
    const loserInfo = isP1 ? cMatch.player2_info : cMatch.player1_info;

    cMatch.status = "completed";
    cMatch.winner_id = winnerId;
    cMatch.winner_info = winnerInfo;
    cMatch.p1_score = isP1 ? 1 : 0;
    cMatch.p2_score = isP1 ? 0 : 1;
    cMatch.score_text = "فوز بالانسحاب (عدم حضور الخصم)";
    cMatch.completed_at = new Date().toISOString();

    // Eliminate the absent opponent
    if (loserId) {
        const loserPart = (champState.participants || []).find(p => p.id === loserId);
        if (loserPart) {
            loserPart.eliminated = true;
            loserPart.elimination_reason = "انسحاب لعدم الحضور خلال المهلة المقررة (3 دقائق)";
        }
    }

    // Advance winner to the next round slot
    if (winnerId && cMatch.next_match_id) {
        advanceWinnerToNextRound(champState.matches, cMatch.id, winnerId);
    }

    // Save to local cache
    saveChampionshipToLocalCache(group);

    // Notify UI reactively
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent('championship_updated', {
            detail: { matchId: cMatch.id, winnerId: winnerId, type: 'walkover' }
        }));
    }

    // Show celebratory Walkover Modal
    showWalkoverVictoryModal(cMatch, winnerInfo, loserInfo);
}

/**
 * Show Celebratory Modal for Walkover Victory
 */
export function showWalkoverVictoryModal(match, winnerInfo, loserInfo) {
    let modal = document.getElementById("champ-walkover-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "champ-walkover-modal";
        document.body.appendChild(modal);
    }
    modal.style.cssText = "position: fixed; inset: 0; background: rgba(10, 15, 30, 0.92); backdrop-filter: blur(10px); z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 20px; direction: rtl;";

    const roundLabel = ROUND_LABELS[match.round_name] || match.round_name;
    const opponentName = loserInfo?.student_name || "المنافس";
    const winnerName = winnerInfo?.student_name || "المتسابق";

    modal.innerHTML = `
        <div style="background: var(--bg-primary, #1e293b); border: 2px solid #10b981; border-radius: 24px; width: 100%; max-width: 580px; padding: 36px 28px; box-shadow: 0 25px 50px rgba(0,0,0,0.6); text-align: center; color: var(--text-primary, #ffffff); font-family: inherit;">
            <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #059669); color: white; font-size: 2.8rem; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);">
                <i class="fa-solid fa-trophy"></i>
            </div>
            <h2 style="margin: 0 0 10px 0; font-size: 1.6rem; font-weight: 800; color: #10b981;">
                مبارك د. ${winnerName}! فوز رسمي بالانسحاب 🏆
            </h2>
            <p style="font-size: 1rem; color: var(--text-secondary); line-height: 1.6; margin: 0 0 24px 0;">
                نظراً لعدم حضور المنافس (<strong>د. ${opponentName}</strong>) خلال المهلة القانونية المقررة (3 دقائق)، تم احتسابك فائزاً بالمباراة وتأهلك رسمياً للدور التالي!
            </p>
            <div style="background: var(--bg-secondary, #0f172a); border-radius: 14px; padding: 18px; margin-bottom: 26px; border: 1px solid rgba(255,255,255,0.08); text-align: right; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
                    <span style="color: var(--text-muted);">المباراة:</span>
                    <strong style="color: var(--text-primary);">${roundLabel} &bull; مباراة رقم #${match.match_order}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
                    <span style="color: var(--text-muted);">النتيجة المعتمدة:</span>
                    <span class="badge" style="background: #10b981; color: white; font-weight: 700; padding: 3px 10px; border-radius: 6px;">فوز بالانسحاب (Walkover) 🏆</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;">
                    <span style="color: var(--text-muted);">حالة المنافس:</span>
                    <span class="badge" style="background: #ef4444; color: white; font-weight: 700; padding: 3px 10px; border-radius: 6px;">مستبعد لعدم الحضور</span>
                </div>
            </div>
            <button class="btn btn-primary btn-lg" onclick="window.closeWalkoverVictoryModal()" style="width: 100%; padding: 14px 24px; font-size: 1.05rem; font-weight: 800; border-radius: 14px; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4); cursor: pointer;">
                العودة لجدول المباريات ومعرفة الخصم القادم <i class="fa-solid fa-arrow-left" style="margin-right: 6px;"></i>
            </button>
        </div>
    `;
}

export function closeWalkoverVictoryModal() {
    const modal = document.getElementById("champ-walkover-modal");
    if (modal) modal.remove();
    returnToChampionshipHub();
}

export function startChampionshipMatchNow() {
    // Safety check: verify opponent presence before questions start
    const currentUser = getActiveUser();
    const userEmail = (currentUser?.email || "").toLowerCase().trim();
    const match = battleState.activeRoom?.championshipMatch;
    
    if (match) {
        const isP1 = (match.player1_info && match.player1_info.email.toLowerCase() === userEmail);
        const group = getActiveGroupName ? getActiveGroupName() : 'infection';
        let online = false;

        // Check local storage or memory
        if (match.match_meta?.[isP1 ? 'p2_entered' : 'p1_entered']) online = true;
        try {
            const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                const mCached = (parsed.matches || []).find(item => item.id === match.id);
                if (mCached?.match_meta?.[isP1 ? 'p2_entered' : 'p1_entered']) online = true;
            }
        } catch (e) {}

        // Check realtime presence
        if (battleState.roomChannel) {
            const pres = battleState.roomChannel.presenceState();
            if (Object.keys(pres).length > 1) online = true;
        }

        if (!online) {
            window.showToast?.("تنبيه هام", "ممنوع بدء الأسئلة قبل حضور ودخول المنافس للغرفة.", "warning");
            return;
        }
    }

    if (battleState.prepTimerInterval) {
        clearInterval(battleState.prepTimerInterval);
        battleState.prepTimerInterval = null;
    }
    const overlay = document.getElementById("champ-match-waiting-modal");
    if (overlay) overlay.remove();

    // Broadcast synchronized countdown start to opponent with questions
    const startsAt = Date.now() + 3000;
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "START_COUNTDOWN",
            payload: { startsAt: startsAt, fullQuestions: battleState.questions }
        }).catch(() => {});
    }

    // Trigger synchronized 3..2..1 countdown for Host as well (eliminating 3-second head start)
    handleStartCountdown({ startsAt: startsAt });
}

export function returnToChampionshipHub() {
    clearInterval(battleState.timerInterval);
    removeAntiCheatFocusGuard();
    removeBeforeUnloadGuard();
    if (battleState.prepTimerInterval) {
        clearInterval(battleState.prepTimerInterval);
        battleState.prepTimerInterval = null;
    }
    battleState.gameStatus = "idle";
    battleState.activeRoom = null;
    champState.inMatch = false;

    const waitingOverlay = document.getElementById("champ-match-waiting-modal");
    if (waitingOverlay) waitingOverlay.remove();
    const walkoverModal = document.getElementById("champ-walkover-modal");
    if (walkoverModal) walkoverModal.remove();

    if (typeof window.switchBattleArenaMode === 'function') {
        window.switchBattleArenaMode('championship');
    }
    champState.activeSubTab = 'bracket';
    renderChampionshipHub('battle-championship-container', getActiveUser());
}

export function renderBattleRoomView() {
    connectToBattleLobby();
    populateBattleTopicsList();
    updateServerCapacityBadge();

    // Always synchronize latest championship state from localStorage
    const group = getActiveGroupName ? getActiveGroupName() : 'infection';
    try {
        const cached = localStorage.getItem(`${STORAGE_CHAMP_KEY}_${group}`);
        if (cached) {
            const parsed = JSON.parse(cached);
            champState.activeChampionship = parsed.championship || champState.activeChampionship;
            champState.participants = parsed.participants || champState.participants;
            champState.matches = parsed.matches || champState.matches;
        }
    } catch (e) {}

    // Check for expired unplayed matches
    if (typeof checkExpiredUnplayedMatches === 'function') {
        checkExpiredUnplayedMatches();
    }

    const champ = champState.activeChampionship;
    const isLive = champ && champ.status === 'active';

    if (battleState.gameStatus === "idle") {
        if (isLive) {
            // Auto switch to Championship mode so students immediately see the live tournament!
            switchBattleArenaMode("championship");
        } else {
            switchBattleSubscreen("lobby");
            switchBattleArenaMode("quick");
        }
    }
}

// Global Bindings for all UI onclick handlers
if (typeof window !== "undefined") {
    window.formatUserDisplay = formatUserDisplay;
    window.selectBattleSource = selectBattleSource;
    window.setBattleTopicMode = setBattleTopicMode;
    window.toggleAllBattleTopics = toggleAllBattleTopics;
    window.createBattleRoom = createBattleRoom;
    window.joinBattleRoomByCode = joinBattleRoomByCode;
    window.startQuickMatchmaking = startQuickMatchmaking;
    window.cancelQuickMatchmaking = cancelQuickMatchmaking;
    window.leaveBattleRoom = leaveBattleRoom;
    window.copyBattleRoomCode = copyBattleRoomCode;
    window.toggleBattleReviewSection = toggleBattleReviewSection;
    window.forfeitBattleMatch = forfeitBattleMatch;
    window.requestBattleRematch = requestBattleRematch;
    window.acceptBattleRematch = acceptBattleRematch;
    window.declineBattleRematch = declineBattleRematch;
    window.returnToBattleLobby = returnToBattleLobby;
    window.renderBattleRoomView = renderBattleRoomView;
    window.switchBattleArenaMode = switchBattleArenaMode;
    window.launchChampionshipArena = launchChampionshipArena;
    window.showChampionshipWaitingRoom = showChampionshipWaitingRoom;
    window.startChampionshipMatchNow = startChampionshipMatchNow;
    window.returnToChampionshipHub = returnToChampionshipHub;
    window.declareChampionshipWalkover = declareChampionshipWalkover;
    window.showWalkoverVictoryModal = showWalkoverVictoryModal;
    window.closeWalkoverVictoryModal = closeWalkoverVictoryModal;
    window.switchChampSubTab = (tab) => {
        champState.activeSubTab = tab;
        renderChampionshipHub(champState.lastContainerId || "battle-championship-container", getActiveUser());
    };
    window.enterChampionshipMatch = (matchId) => {
        enterChampionshipMatch(matchId, window.showToast);
    };
    window.regenerateChampBracket = (type) => {
        if (typeof window.generateBracketFromAdmin === 'function') {
            window.generateBracketFromAdmin();
        }
    };
    window.rescheduleAllChampMatchesPrompt = () => {
        const newTime = prompt("Enter new round start time (e.g. 20:30 or 09:00 PM):");
        if (!newTime) return;
        window.showToast?.("Schedule Updated", "Round start time successfully updated to: " + newTime, "success");
    };
}
