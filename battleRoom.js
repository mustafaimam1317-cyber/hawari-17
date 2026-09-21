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
            realtime: {
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
        try { battleState.roomChannel.unsubscribe(); } catch(e) {}
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

                    // Resend every 1.5s (up to 8 times = 12s) to guarantee arrival over real network latency
                    let retryCount = 0;
                    battleState.guestHandshakeInterval = setInterval(() => {
                        retryCount++;
                        if (battleState.gameStatus !== "waiting" || (battleState.questions && battleState.questions.length > 0) || retryCount > 8) {
                            clearInterval(battleState.guestHandshakeInterval);
                            battleState.guestHandshakeInterval = null;
                            return;
                        }
                        sendGuestReady();
                    }, 1500);

                    // Generous 30-second timeout ONLY started after successful SUBSCRIBED status
                    battleState.guestWaitTimeout = setTimeout(() => {
                        if (battleState.gameStatus === "waiting" && (!battleState.questions || battleState.questions.length === 0)) {
                            window.showToast?.("Host Not Found", "لم يتم العثور على منشئ الغرفة. يرجى التأكد من بقاء زميلك داخل شاشة الانتظار وصحة كود الغرفة.", "warning");
                            leaveBattleRoom();
                        }
                    }, 30000);
                }
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.error(`[BattleRoom] Channel subscription failed with status: ${status}`);
                if (!isHost && battleState.gameStatus === "waiting") {
                    window.showToast?.("Connection Error", "تعذر الاتصال بسيرفر الغرف عبر الشبكة. يرجى إعادة المحاولة.", "danger");
                    leaveBattleRoom();
                }
            }
        });
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

    // Load question objects from local cache using IDs (Zero-Egress)
    const pool = getQuestionsBase();
    const questionMap = new Map(pool.map(q => [q.id, q]));
    let resolvedQuestions = payload.questionIds.map(id => questionMap.get(id)).filter(Boolean);

    // Fallback: If guest local cache is missing any question, use host fullQuestions payload
    if (resolvedQuestions.length < payload.questionIds.length && Array.isArray(payload.fullQuestions) && payload.fullQuestions.length === payload.questionIds.length) {
        console.warn("[BattleRoom] Incomplete local question cache; using host fallback payload.");
        resolvedQuestions = payload.fullQuestions;
    }
    battleState.questions = resolvedQuestions;

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
function handleStartCountdown({ startsAt }) {
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
            startLiveBattleMatch();
        }
    }, 1000);
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
            handleQuestionTimeout(q);
        }
    }, 1000);
}

/**
 * Handle Current Player Selecting an Answer Option
 */
function handlePlayerSelectAnswer(selectedKey, question) {
    if (battleState.myAnswered) return;
    battleState.myAnswered = true;

    // Highlight selected button using platform .selected class
    const selectedBtn = document.getElementById(`battle-opt-${selectedKey}`);
    if (selectedBtn) {
        selectedBtn.classList.add("selected");
    }

    // Disable option clicks
    const allBtns = document.querySelectorAll(".battle-option-btn");
    allBtns.forEach(b => b.style.pointerEvents = "none");

    const isCorrect = selectedKey === question.correctOption;
    const timeRem = battleState.timeRemaining;
    const pointsEarned = isCorrect ? 10 : 0;

    battleState.myScore += pointsEarned;
    battleState.myAnswers[battleState.currentQuestionIndex] = {
        selected: selectedKey,
        correct: question.correctOption,
        isCorrect: isCorrect,
        timeRemaining: timeRem,
        points: pointsEarned
    };

    // Update HUD Score & Status Badge
    const p1Score = document.getElementById("battle-arena-p1-score");
    const p1Status = document.getElementById("battle-arena-p1-status");
    if (p1Score) p1Score.innerText = `${battleState.myScore} pts`;
    if (p1Status) {
        p1Status.innerText = "Answered ⚡";
        p1Status.style.background = "rgba(16, 185, 129, 0.15)";
        p1Status.style.color = "#10b981";
    }

    // Notify Opponent without revealing the chosen option
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "OPPONENT_ANSWERED",
            payload: {
                pointsEarned: pointsEarned,
                totalScore: battleState.myScore,
                timeRemaining: timeRem
            }
        });
    }

    // Check if both players have answered
    checkBothAnsweredAdvance(question);
}

/**
 * Handle Opponent Answer Broadcast
 */
function handleOpponentAnswered(payload) {
    battleState.opponentAnswered = true;
    battleState.opponentScore = payload.totalScore;

    const p2Score = document.getElementById("battle-arena-p2-score");
    const p2Status = document.getElementById("battle-arena-p2-status");
    if (p2Score) p2Score.innerText = `${battleState.opponentScore} pts`;
    if (p2Status) {
        p2Status.innerText = "Answered ⚡";
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

    // Notify opponent
    if (battleState.roomChannel) {
        battleState.roomChannel.send({
            type: "broadcast",
            event: "PLAYER_FORFEIT",
            payload: { forfeitedBy: myName }
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
    battleState.opponentScore = 0;
    battleState.myScore = Math.max(battleState.myScore, 30);
    finishBattleMatch();
}

/**
 * Handle Question Timeout (0 seconds left)
 */
function handleQuestionTimeout(question) {
    if (!battleState.myAnswered) {
        battleState.myAnswered = true;
        battleState.myAnswers[battleState.currentQuestionIndex] = {
            selected: null,
            correct: question.correctOption,
            isCorrect: false,
            timeRemaining: 0,
            points: 0
        };
    }
    revealQuestionFeedbackAndAdvance(question);
}

/**
 * Check if both players have submitted and advance
 */
function checkBothAnsweredAdvance(question) {
    if (battleState.myAnswered && battleState.opponentAnswered) {
        clearInterval(battleState.timerInterval);
        revealQuestionFeedbackAndAdvance(question);
    }
}

/**
 * Reveal correct answer highlight using platform .correct-choice / .incorrect-choice classes
 */
function revealQuestionFeedbackAndAdvance(question) {
    const correctBtn = document.getElementById(`battle-opt-${question.correctOption}`);
    if (correctBtn) {
        correctBtn.classList.add("correct-choice");
    }

    const myChoice = battleState.myAnswers[battleState.currentQuestionIndex]?.selected;
    if (myChoice && myChoice !== question.correctOption) {
        const wrongBtn = document.getElementById(`battle-opt-${myChoice}`);
        if (wrongBtn) wrongBtn.classList.add("incorrect-choice");
    }

    setTimeout(() => {
        battleState.currentQuestionIndex++;
        renderCurrentArenaQuestion();
    }, 1800);
}

/**
 * Finish Match and Display Celebratory Results
 */
function finishBattleMatch() {
    clearInterval(battleState.timerInterval);

    // Free server room capacity slot immediately
    if (battleState.activeRoom?.isHost && battleState.lobbyChannel) {
        try { battleState.lobbyChannel.untrack(); } catch(e) {}
    }

    switchBattleSubscreen("results");

    const myScore = battleState.myScore;
    const opScore = battleState.opponentScore;

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
        if (iconEl) iconEl.innerText = "🤝";
        if (titleEl) {
            titleEl.innerText = "IT'S A DRAW!";
            titleEl.style.color = "#3b82f6";
        }
        if (subEl) subEl.innerText = "Perfect parity! Both competitors matched each other's score and timing.";
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

    // Reset Rematch button text
    const btnRematch = document.getElementById("btn-battle-rematch");
    if (btnRematch) {
        btnRematch.disabled = false;
        btnRematch.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Rematch`;
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

    battleState.questions.forEach((q, idx) => {
        const myAns = battleState.myAnswers[idx];
        const isCorrect = myAns?.isCorrect;
        const myChoice = myAns?.selected || "None (Timed Out)";

        const item = document.createElement("div");
        item.className = "card";
        item.style.cssText = "padding: 16px; margin-bottom: 10px;";
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">Q${idx + 1}: ${q.source || 'Exam'} • ${q.topic || 'Medical Case'}</span>
                <span class="badge" style="font-size: 0.78rem; font-weight: 700; padding: 2px 8px; ${isCorrect ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">
                    ${isCorrect ? 'Correct (+points)' : 'Incorrect'}
                </span>
            </div>
            <div style="font-size: 0.92rem; color: var(--text-primary); margin-bottom: 8px; line-height: 1.5;">${q.text}</div>
            <div style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 6px;">
                <strong>Your Choice:</strong> Option ${myChoice} &bull; <strong>Model Answer:</strong> Option ${q.correctOption}
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
        try { battleState.roomChannel.unsubscribe(); } catch(e) {}
        battleState.roomChannel = null;
    }

    if (battleState.activeRoom?.isHost && battleState.lobbyChannel) {
        try { battleState.lobbyChannel.untrack(); } catch(e) {}
    }

    battleState.activeRoom = null;
    battleState.questions = [];
    switchBattleSubscreen("lobby");
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
export function renderBattleRoomView() {
    connectToBattleLobby();
    populateBattleTopicsList();
    updateServerCapacityBadge();
    if (battleState.gameStatus === "idle") {
        switchBattleSubscreen("lobby");
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
}
