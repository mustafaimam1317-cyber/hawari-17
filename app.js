
// ================= CENTRALIZED SUPABASE CONFIGURATION =================
const SUPABASE_CONFIG = {
    url: (import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co").replace(/\/$/, ""),
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c"
};

function getSupabaseAuthHeaders(jwtToken = null, extraHeaders = {}) {
    const token = jwtToken || SUPABASE_CONFIG.anonKey;
    return {
        "apikey": SUPABASE_CONFIG.anonKey,
        "Authorization": `Bearer ${token}`,
        ...extraHeaders
    };
}

let _bookUploadInProgress = false;

async function processBookPdfUpload({ title, file, progressContainer, progressBar, progressText, modalToClose, formToReset }) {
    console.log("[BookUpload] START processBookPdfUpload — title:", title, "file size:", file ? file.size : 0);

    // Guard against double-click / concurrent uploads
    if (_bookUploadInProgress) {
        console.warn("[BookUpload] BLOCKED: Upload already in progress, ignoring duplicate call.");
        showToast("جاري الرفع", "يتم رفع الكتاب حالياً، يرجى الانتظار...", "warning");
        return false;
    }
    _bookUploadInProgress = true;

    const hasSession = !!(state.currentUser && state.currentUser.email);
    const isAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "instructor");

    if (!hasSession || !isAdmin) {
        console.error("[BookUpload] FAILED: Admin session invalid or missing");
        showToast("جلسة غير صالحة", "رفع الكتب متاح فقط للمشرفين. يرجى تسجيل الدخول بحساب مسؤول.", "danger");
        if (progressContainer) progressContainer.classList.add("hidden");
        _bookUploadInProgress = false;
        return false;
    }

    if (!title || !file) {
        console.error("[BookUpload] FAILED: Missing title or file");
        showToast("Missing Required Fields", "Please enter a title and select a PDF file.", "warning");
        if (progressContainer) progressContainer.classList.add("hidden");
        _bookUploadInProgress = false;
        return false;
    }

    if (progressContainer) progressContainer.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "15%";
    if (progressText) progressText.innerText = "15%";

    try {
        // Auto-detect actual numPages from PDF file using PDF.js
        console.log("[BookUpload] Detecting actual page count from PDF buffer...");
        let detectedPages = 1;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfjs = await ensurePdfJsLoaded();
            const tempPdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
            detectedPages = tempPdf.numPages || 1;
            console.log("[BookUpload] Successfully detected total pages:", detectedPages);
        } catch (pdfErr) {
            console.warn("[BookUpload] Could not detect page count via PDF.js, fallback 1:", pdfErr.message);
        }

        if (progressBar) progressBar.style.width = "40%";
        if (progressText) progressText.innerText = "40%";

        const jwtToken = await getValidSupabaseAccessToken();
        const cleanUrl = SUPABASE_CONFIG.url;

        const fileExt = file.name.split('.').pop();
        const group = (state.activeGroup || "infection").toLowerCase();
        const fileName = `hawari_book_${group}_${Date.now()}.${fileExt}`;

        console.log("[BookUpload] Uploading binary to Supabase Storage: hawari_books/" + fileName);
        let storageSuccess = false;
        try {
            const uploadRes = await fetch(`${cleanUrl}/storage/v1/object/hawari_books/${fileName}`, {
                method: "POST",
                headers: getSupabaseAuthHeaders(jwtToken, {
                    "Content-Type": file.type || "application/pdf"
                }),
                body: file
            });
            if (uploadRes.ok) {
                storageSuccess = true;
                console.log("[BookUpload] Storage upload succeeded!");
            } else {
                console.warn("[BookUpload] Storage upload status:", uploadRes.status);
            }
        } catch (stErr) {
            console.warn("[BookUpload] Storage upload warning:", stErr.message);
        }

        if (progressBar) progressBar.style.width = "70%";
        if (progressText) progressText.innerText = "70%";

        const storageUrl = `${cleanUrl}/storage/v1/object/public/hawari_books/${fileName}`;
        const bookId = generateUuidV4();

        const dbPayload = {
            id: bookId,
            title: title.trim(),
            total_pages: detectedPages,
            storage_url: storageUrl,
            group_name: group,
            uploaded_at: new Date().toISOString()
        };

        const anonKey = SUPABASE_CONFIG.anonKey;

        const uploadAuthHeaders = getSupabaseAuthHeaders(jwtToken, {
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        });

        // 1. Insert to hawari_book_files table
        try {
            const insertRes = await fetch(`${cleanUrl}/rest/v1/hawari_book_files`, {
                method: "POST",
                headers: uploadAuthHeaders,
                body: JSON.stringify(dbPayload)
            });
            if (insertRes.ok) {
                console.log("[BookUpload] hawari_book_files insert succeeded!");
            } else {
                console.warn("[BookUpload] hawari_book_files insert status:", insertRes.status);
            }
        } catch (dbErr) {
            console.warn("[BookUpload] Table insert warning:", dbErr.message);
        }

        // 2. Persist to hawari_users admin row for 100% reliable cross-device sync
        try {
            const adminEmail = (state.currentUser && state.currentUser.email ? state.currentUser.email : "").toLowerCase();
            const currentBooks = (state.books || []).filter(b => b.id !== bookId);
            currentBooks.unshift(dbPayload);

            // Fetch or upsert admin row in hawari_users
            await fetch(`${cleanUrl}/rest/v1/hawari_users?email=eq.${encodeURIComponent(adminEmail)}&group_name=eq.${group}`, {
                method: "PATCH",
                headers: getSupabaseAuthHeaders(jwtToken, { "Content-Type": "application/json" }),
                body: JSON.stringify({
                    report_task_progress: {
                        ...(state.currentUser.report_task_progress || {}),
                        books: currentBooks
                    },
                    last_updated: Date.now()
                })
            });
            console.log("[BookUpload] Successfully synced book to hawari_users admin row for cross-device availability!");
        } catch (userSyncErr) {
            console.warn("[BookUpload] hawari_users sync warning:", userSyncErr.message);
        }

        if (!state.books) state.books = [];
        if (!state.books.some(b => b.id === bookId)) {
            state.books.unshift(dbPayload);
        }
        localStorage.setItem("hawari_books_" + group, JSON.stringify(state.books));

        if (progressBar) progressBar.style.width = "100%";
        if (progressText) progressText.innerText = "100%";

        showToast("Book Uploaded Successfully", `تم رفع كتاب "${title}" بنجاح وتوفيره لجميع الأجهزة! (${detectedPages} صفحة)`, "success");

        setTimeout(() => {
            if (progressContainer) progressContainer.classList.add("hidden");
            if (modalToClose) {
                const modal = document.getElementById(modalToClose);
                if (modal) modal.classList.add("hidden");
            }
            if (formToReset) formToReset.reset();
            renderBookLibrary();
            updateAdminActiveBookUI();
        }, 600);

        _bookUploadInProgress = false;
        return true;

    } catch (err) {
        console.error("[BookUpload] Exception:", err);
        showToast("Upload Error", err.message || "Failed to upload book.", "danger");
        if (progressContainer) progressContainer.classList.add("hidden");
        _bookUploadInProgress = false;
        return false;
    }
}

window.handleAdminBookUploadForm = async function(event) {
    if (event) event.preventDefault();
    console.log("[BookUpload] Submit button clicked!");
    
    const titleInput = document.getElementById("admin-book-file-title");
    const fileInput = document.getElementById("admin-book-pdf-file");
    const progressContainer = document.getElementById("admin-book-upload-progress");
    const progressBar = document.getElementById("admin-book-upload-bar");
    const progressText = document.getElementById("admin-book-upload-pct");
    const form = document.getElementById("admin-upload-book-form");

    const title = titleInput ? titleInput.value.trim() : "";
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!title || !file) {
        showToast("بيانات ناقصة", "يرجى كتابة عنوان الكتاب واختيار ملف الـ PDF.", "warning");
        return false;
    }

    const success = await processBookPdfUpload({
        title,
        file,
        progressContainer,
        progressBar,
        progressText,
        formToReset: form
    });
    
    return success;
};


// Safe local progress tracking fallback for missing hawari_user_book_progress table
let isUserBookProgressCloudAvailable = null;

async function saveBookReadingProgress(email, bookId, page, totalPages) {
    if (!email || !bookId) return;
    if (isUserBookProgressCloudAvailable === false) return;
    try {
        const res = await supabaseRequest("hawari_user_book_progress", {
            method: "POST",
            body: JSON.stringify({ email, book_id: bookId, page, total_pages: totalPages, updated_at: new Date().toISOString() })
        });
        if (res && res.status === 404) {
            isUserBookProgressCloudAvailable = false;
        }
    } catch (e) {
        // Silent fallback
    }
}


async function ensurePdfJsLoaded() {
    if (window.pdfjsLib) {
        if (window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        return window.pdfjsLib;
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.onload = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                resolve(window.pdfjsLib);
            } else {
                reject(new Error("pdfjsLib not available after script load"));
            }
        };
        script.onerror = () => reject(new Error("Failed to load PDF.js CDN script"));
        document.head.appendChild(script);
    });
}

async function loadRealBookPdfDocument(bookFile) {
    if (!bookFile) return null;
    console.log("[PDFViewer] Fetching real PDF document for book:", bookFile.id, bookFile.title);

    try {
        const pdfjs = await ensurePdfJsLoaded();
        const jwtToken = await getValidSupabaseAccessToken();
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
        const cleanUrl = supabaseUrl.replace(/\/$/, "");

        const rawUrl = bookFile.storage_url || "";
        let cleanPath = rawUrl.replace(/.*\/hawari_books\//, "").replace(/^public\//, "");
        if (!cleanPath || cleanPath.startsWith("http")) {
            cleanPath = rawUrl.split("/").pop();
        }

        console.log("[PDFViewer] Extracted cleanPath:", cleanPath);

        let pdfArrayBuffer = null;

        // Strategy A: Authenticated storage endpoint
        try {
            const authEndpoint = `${cleanUrl}/storage/v1/object/hawari_books/${encodeURIComponent(cleanPath)}`;
            const resAuth = await fetch(authEndpoint, {
                headers: {
                    "apikey": anonKey,
                    "Authorization": `Bearer ${jwtToken || anonKey}`
                }
            });
            if (resAuth.ok) {
                pdfArrayBuffer = await resAuth.arrayBuffer();
                console.log("[PDFViewer] Strategy A (Auth endpoint) succeeded! Bytes:", pdfArrayBuffer.byteLength);
            } else {
                console.warn("[PDFViewer] Strategy A returned status:", resAuth.status);
            }
        } catch (errA) {
            console.warn("[PDFViewer] Strategy A failed:", errA.message);
        }

        // Strategy B: Public storage endpoint
        if (!pdfArrayBuffer && rawUrl && rawUrl.startsWith("http")) {
            try {
                const resPub = await fetch(rawUrl, {
                    headers: { "apikey": anonKey }
                });
                if (resPub.ok) {
                    pdfArrayBuffer = await resPub.arrayBuffer();
                    console.log("[PDFViewer] Strategy B (Public URL) succeeded! Bytes:", pdfArrayBuffer.byteLength);
                } else {
                    console.warn("[PDFViewer] Strategy B returned status:", resPub.status);
                }
            } catch (errB) {
                console.warn("[PDFViewer] Strategy B failed:", errB.message);
            }
        }

        // Strategy C: Signed temporary URL from Supabase
        if (!pdfArrayBuffer && cleanPath) {
            try {
                const signRes = await fetch(`${cleanUrl}/storage/v1/object/sign/hawari_books/${encodeURIComponent(cleanPath)}`, {
                    method: "POST",
                    headers: {
                        "apikey": anonKey,
                        "Authorization": `Bearer ${jwtToken || anonKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ expiresIn: 3600 })
                });
                if (signRes.ok) {
                    const signJson = await signRes.json();
                    const signedPath = signJson.signedURL || signJson.signedUrl;
                    if (signedPath) {
                        const signedFullUrl = signedPath.startsWith("http") ? signedPath : `${cleanUrl}/storage/v1${signedPath}`;
                        const resSigned = await fetch(signedFullUrl);
                        if (resSigned.ok) {
                            pdfArrayBuffer = await resSigned.arrayBuffer();
                            console.log("[PDFViewer] Strategy C (Signed URL) succeeded! Bytes:", pdfArrayBuffer.byteLength);
                        }
                    }
                }
            } catch (errC) {
                console.warn("[PDFViewer] Strategy C failed:", errC.message);
            }
        }

        if (!pdfArrayBuffer || pdfArrayBuffer.byteLength === 0) {
            console.error("[PDFViewer] FAILED: Could not retrieve PDF binary buffer from any storage endpoint.");
            showToast("فشل تحميل الملف", "تعذر تحميل مستند الـ PDF من السيرفر. يرجى التحقق من اتصال الإنترنت.", "danger");
            return null;
        }

        // Load into PDF.js using Uint8Array
        const uint8Data = new Uint8Array(pdfArrayBuffer);
        const loadingTask = pdfjs.getDocument({
            data: uint8Data,
            cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
            cMapPacked: true
        });

        const pdfDoc = await loadingTask.promise;
        console.log("[PDFViewer] REAL PDF loaded successfully! Total pages:", pdfDoc.numPages);
        bookState.pdfDoc = pdfDoc;
        bookState.numPages = pdfDoc.numPages;
        return pdfDoc;
    } catch (e) {
        console.error("[PDFViewer] Error in loadRealBookPdfDocument:", e);
        showToast("خطأ في قراءة الـ PDF", e.message || "حدث خطأ أثناء فك تشفير مستند الـ PDF.", "danger");
        return null;
    }
}


function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
window.escapeHTML = escapeHTML;
window.escapeHtml = escapeHTML;






function generateUuidV4() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}


// ============================================================================
// SUPABASE AUTH SESSION ENGINE (Real GoTrue JWT Access Token Management)
// ============================================================================
const SUPABASE_SESSION_STORAGE_KEY = "hawari_supabase_session";

function parseJwtPayload(token) {
    if (!token || typeof token !== "string") return null;
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(atob(base64).split("").map(c => {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(""));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function getStoredSupabaseSession() {
    try {
        const raw = localStorage.getItem(SUPABASE_SESSION_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function saveSupabaseSession(sessionData) {
    if (!sessionData || !sessionData.access_token) return;
    window.supabaseSession = sessionData;
    if (state.currentUser) {
        state.currentUser.token = sessionData.access_token;
        state.currentUser.access_token = sessionData.access_token;
    }
    localStorage.setItem(SUPABASE_SESSION_STORAGE_KEY, JSON.stringify(sessionData));
}

function clearSupabaseSession() {
    window.supabaseSession = null;
    if (state.currentUser) {
        delete state.currentUser.token;
        delete state.currentUser.access_token;
    }
    localStorage.removeItem(SUPABASE_SESSION_STORAGE_KEY);
}

async function refreshSupabaseSession(refreshToken) {
    if (!refreshToken) return null;
    console.log("[Auth] Session refresh: started");
    const url = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";

    try {
        const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { "apikey": anonKey, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        const data = await res.json();
        if (data && data.access_token) {
            console.log("[Auth] Session refresh: success");
            const expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
            const sessionObj = {
                access_token: data.access_token,
                refresh_token: data.refresh_token || refreshToken,
                expires_at: expiresAt,
                user: data.user || { email: state.currentUser ? state.currentUser.email : "" }
            };
            saveSupabaseSession(sessionObj);
            return data.access_token;
        } else {
            console.warn("[Auth] Session refresh: failure");
            clearSupabaseSession();
            return null;
        }
    } catch (e) {
        console.error("[Auth] Session refresh error:", e);
        return null;
    }
}

async function getValidSupabaseSession() {
    const session = getStoredSupabaseSession() || window.supabaseSession;
    if (!session || !session.access_token) return null;

    // Check expiry (buffer 60 seconds)
    if (session.expires_at && session.expires_at < Date.now() + 60000) {
        if (session.refresh_token) {
            const newToken = await refreshSupabaseSession(session.refresh_token);
            if (newToken) return getStoredSupabaseSession();
        }
        clearSupabaseSession();
        return null;
    }
    return session;
}

async function getValidSupabaseAccessToken() {
    const session = await getValidSupabaseSession();
    if (session && session.access_token) {
        return session.access_token;
    }
    return null;
}

async function loginToSupabaseAuth(email, password) {
    const cleanUrl = SUPABASE_CONFIG.url;
    const cleanEmail = email.trim().toLowerCase();

    try {
        // Official GoTrue password login
        let res = await fetch(`${cleanUrl}/auth/v1/token?grant_type=password`, {
            method: "POST",
            headers: getSupabaseAuthHeaders(null, { "Content-Type": "application/json" }),
            body: JSON.stringify({ email: cleanEmail, password: password })
        });
        let data = await res.json();

        // If auth fails due to sync requirement, attempt auth-sync edge function
        if (!data || !data.access_token) {
            try {
                const syncRes = await fetch(`${cleanUrl}/functions/v1/auth-sync`, {
                    method: "POST",
                    headers: getSupabaseAuthHeaders(null, { "Content-Type": "application/json" }),
                    body: JSON.stringify({ email: cleanEmail, password: password })
                });
                if (syncRes.ok) {
                    res = await fetch(`${cleanUrl}/auth/v1/token?grant_type=password`, {
                        method: "POST",
                        headers: getSupabaseAuthHeaders(null, { "Content-Type": "application/json" }),
                        body: JSON.stringify({ email: cleanEmail, password: password })
                    });
                    data = await res.json();
                }
            } catch (syncErr) {
                console.warn("[Auth] Auth-sync edge function unavailable:", syncErr.message);
            }
        }

        if (data && data.access_token) {
            const expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
            const sessionObj = {
                access_token: data.access_token,
                refresh_token: data.refresh_token || "",
                expires_at: expiresAt,
                user: data.user || { id: data.user ? data.user.id : "", email: cleanEmail }
            };
            saveSupabaseSession(sessionObj);
            return sessionObj;
        } else {
            const errMsg = data.msg || data.error_description || "Invalid login credentials";
            console.warn("[Auth] Could not acquire Supabase Auth token for:", cleanEmail);
            showToast("Supabase Auth Warning", `Application profile exists, but Supabase Auth credentials are not valid (${errMsg}).`, "warning");
            return null;
        }
    } catch (e) {
        console.error("[Auth] Login exception:", e.message);
        return null;
    }
}




async function getValidSupabaseJwt() {
    if (!state.currentUser || !state.currentUser.email) return null;
    const email = state.currentUser.email.toLowerCase();

    if (state.currentUser.token) return state.currentUser.token;
    if (state.currentUser.access_token) return state.currentUser.access_token;
    if (window.supabaseSession && window.supabaseSession.access_token) return window.supabaseSession.access_token;

    const group = state.activeGroup || "infection";
    const cachedToken = localStorage.getItem(`hawari_jwt_${email}_${group}`) || localStorage.getItem("hawari_jwt_token");
    if (cachedToken) {
        const decoded = parseJwtPayload(cachedToken);
        if (decoded && decoded.exp && (decoded.exp * 1000 > Date.now() + 60000)) {
            state.currentUser.token = cachedToken;
            return cachedToken;
        }
    }
    return null;
}

// ================= SEED QUESTIONS DATABASE =================
// ================= SEED QUESTIONS DATABASE =================
// Production question banks are dynamically loaded from Supabase and cached in IndexedDB
const SEED_QUESTIONS = [];
const DERMA_QUESTIONS_DATA = [];


// ================= GLOBAL APPLICATION STATE =================
let state = {
    activeGroup: null, // "infection" or "dermatology"
    users: [],
    currentUser: null,
    questions: [],
    tests: [],
    notebookNotes: [],
    flashcards: [],
    activeTest: null,
    isDarkMode: false,
    activeView: "dashboard",
    adminActiveTab: "admin-questions-tab",
    reportTasks: [],
    courseQuizzes: [],
    quizResults: [],
    activeQuiz: null,
    announcement: "",
    grantedBookUsers: [],
    isUserProgressLoaded: false,
    isQuestionBankLoaded: false,
    isInitialSyncComplete: false
};

// ================= LOCAL STORAGE MANAGER =================
const STORAGE_KEYS = {
    USERS: "hawari_users",
    CURRENT_USER: "hawari_current_user",
    QUESTIONS: "hawari_questions",
    TESTS: "hawari_tests",
    NOTES: "hawari_notes",
    THEME: "hawari_theme_dark",
    FLASHCARDS: "hawari_flashcards",
    REPORT_TASKS: "hawari_report_tasks"
};

function getGroupKey(baseKey) {
    if (!state.activeGroup) return baseKey;
    if (baseKey === STORAGE_KEYS.THEME) return baseKey;
    return `${baseKey}_${state.activeGroup}`;
}

function getGroupQuestionsSeed(group = state.activeGroup) {
    if ((group || "").toLowerCase() === "dermatology") {
        return DERMA_QUESTIONS_DATA;
    }
    return SEED_QUESTIONS;
}

function isUserAdmin(user = state.currentUser) {
    if (!user) return false;
    return user.role === "admin" || user.role === "instructor" || user.is_admin === true;
}

let debouncedSyncTimer = null;
function debouncedSync() {
    if (debouncedSyncTimer) {
        clearTimeout(debouncedSyncTimer);
    }
    debouncedSyncTimer = setTimeout(() => {
        syncUsersWithCloud().catch(err => {
            console.warn("[DebouncedSync] Background progress sync deferred:", err);
        });
    }, 2000);
}

function saveStateToStorage(skipCloudSync = false) {
    if (!state.activeGroup) return;

    if (state.currentUser) {
        let userRecord = state.users.find(u => u.email.toLowerCase() === state.currentUser.email.toLowerCase());
        if (!userRecord) {
            userRecord = {
                email: state.currentUser.email,
                password: state.currentUser.password || "",
                role: state.currentUser.role || "student",
                status: state.currentUser.status || "approved",
                dateRegistered: state.currentUser.dateRegistered || new Date().toLocaleDateString(),
                displayName: state.currentUser.displayName || "",
                questions: [],
                tests: [],
                notebookNotes: [],
                flashcards: [],
                reportTaskProgress: {},
                lastUpdated: Date.now()
            };
            state.users.push(userRecord);
        }

        // Only update progress fields if user progress has been initialized/loaded
        // This prevents uninitialized empty arrays from overwriting loaded student progress
        if (state.isUserProgressLoaded) {
            userRecord.tests = state.tests || [];
            userRecord.reportTaskProgress = userRecord.reportTaskProgress || {};
            userRecord.notebookNotes = state.notebookNotes || [];
            userRecord.flashcards = state.flashcards || [];
            if (state.questions && state.questions.length > 0) {
                userRecord.questions = state.questions.map(q => ({
                    id: q.id,
                    status: q.status || "unused",
                    marked: q.marked || false,
                    notes: q.notes || "",
                    highlightedHtml: q.highlightedHtml || "",
                    userAnswer: q.userAnswer || null
                }));
            }
            userRecord.lastUpdated = Date.now();
            state.currentUser.lastUpdated = userRecord.lastUpdated;
        }
    }

    // Persist full state.users with all tests, progress, notes, and flashcards intact!
    encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);
    encryptLocal(getGroupKey(STORAGE_KEYS.CURRENT_USER), state.currentUser);
    encryptLocal(STORAGE_KEYS.THEME, state.isDarkMode);
    encryptLocal(getGroupKey(STORAGE_KEYS.REPORT_TASKS), state.reportTasks);
    
    // Cloud sync users registry
    if (!skipCloudSync) {
        debouncedSync();
    }

    // If active user is Admin, also upload the global questions template!
    if (isUserAdmin(state.currentUser)) {
        saveGlobalQuestionsToCloud();
    }
}

// Synchronous SHA-256 implementation for secure password hashing
function sha256Sync(ascii) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;
    var result = '';
    var words = [];
    var asciiLength = ascii[lengthProperty];
    var hash = [];
    var k = [];
    var primeCounter = 0;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (i = 0; i < 313; i += candidate) {
                isComposite[i] = 1;
            }
            hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) {
        ascii += '\x00';
    }
    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return ''; // ASCII only
        words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words[lengthProperty]] = ((asciiLength >>> 29) & 0x7);
    words[words[lengthProperty]] = (asciiLength << 3);
    for (j = 0; j < words[lengthProperty]; ) {
        var w = words.slice(j, j + 16);
        j += 16;
        var oldHash = hash.slice(0);
        for (i = 0; i < 64; i++) {
            var wItem = w[i];
            if (i >= 16) {
                var s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                var s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                wItem = w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }
            var s0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
            var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
            var t2 = s0 + maj;
            var s1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
            var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
            var t1 = hash[7] + s1 + ch + k[i] + wItem;
            hash = [ (t1 + t2) | 0 ].concat(hash);
            hash[4] = (hash[4] + t1) | 0;
            hash.length = 8;
        }
        for (i = 0; i < 8; i++) {
            hash[i] = (hash[i] + oldHash[i]) | 0;
        }
    }
    for (i = 0; i < 8; i++) {
        var a = hash[i] >>> 0;
        result += (a.toString(16)).padStart(8, '0');
    }
    return result;
}

function loadStateFromStorage() {
    // 1. Theme
    state.isDarkMode = JSON.parse(localStorage.getItem(STORAGE_KEYS.THEME)) || false;
    
    if (!state.activeGroup) return;

    // 2. Users Database (strictly scoped to active course)
    const storedUsers = decryptLocal(getGroupKey(STORAGE_KEYS.USERS), null);
    if (storedUsers && Array.isArray(storedUsers)) {
        state.users = storedUsers;
    } else {
        state.users = [];
    }

    // Ensure existing admins in stored users retain admin status
    state.users.forEach(u => {
        if (u.role === "admin") {
            u.status = "approved";
        }
    });

    // Ensure all registered users have hashed passwords
    state.users.forEach(u => {
        if (u.password && (u.password.length !== 64 || !/^[0-9a-fA-F]+$/.test(u.password))) {
            u.password = sha256Sync(u.password);
        }
    });
    encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);

    // 3. Current User
    const storedCurrentUser = decryptLocal(getGroupKey(STORAGE_KEYS.CURRENT_USER), null);
    if (storedCurrentUser) {
        try {
            state.currentUser = storedCurrentUser;
            // Verify user exists in the local database or initialize stub
            let dbUser = state.users.find(u => u.email === state.currentUser.email);
            if (!dbUser) {
                dbUser = {
                    email: state.currentUser.email,
                    role: state.currentUser.role || "student",
                    status: state.currentUser.status || "approved",
                    password: state.currentUser.password || "",
                    dateRegistered: state.currentUser.dateRegistered || new Date().toLocaleDateString(),
                    displayName: state.currentUser.displayName || "",
                    questions: [],
                    tests: [],
                    lastUpdated: 0
                };
                state.users.push(dbUser);
            }
            loadUserSpecificProgress(state.currentUser.email);
        } catch (e) {
            console.error("[Auth] Error loading stored current user:", e);
        }
    } else {
        state.questions = JSON.parse(JSON.stringify(getGroupQuestionsSeed()));
        state.tests = [];
        state.notebookNotes = [];
        state.flashcards = [];
    }

    // Trigger cloud synchronization in background
    syncUsersWithCloud();
}

// ================= TOAST SYSTEM GENERATOR =================
function showToast(title, msg, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "fa-info-circle";
    if (type === "success") icon = "fa-check-circle";
    if (type === "warning") icon = "fa-exclamation-triangle";
    if (type === "danger") icon = "fa-exclamation-circle";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-msg">${msg}</div>
        </div>
    `;
    
    container.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ================= INITIALIZATION & ROUTING =================
async function selectCourseTrack(groupName) {
    state.activeGroup = groupName;
    // Complete in-memory state reset for clean course isolation
    state.users = [];
    state.grantedBookUsers = [];
    state.tests = [];
    state.questions = [];
    state.notebookNotes = [];
    state.flashcards = [];
    state.reportTasks = [];
    state.courseQuizzes = [];
    state.quizResults = [];
    state.books = [];
    state.isUserProgressLoaded = false;
    state.isQuestionBankLoaded = false;
    state.isInitialSyncComplete = false;

    localStorage.setItem("hawari_active_group", groupName);
    
    // Apply body theme class
    const body = document.body;
    body.classList.remove("group-infection", "group-dermatology");
    body.classList.add(`group-${groupName}`);

    // Update dynamically customized text of landing page and sidebar brand
    const brandName = document.getElementById("sidebar-brand-name");
    const logoIcon = document.getElementById("sidebar-logo");
    
    const authBrandTitle = document.getElementById("auth-brand-title");
    const authBrandLogo = document.getElementById("auth-brand-logo");

    // Landing page elements
    const landingTitle = document.querySelector("#landing-page h1");
    const landingTagline = document.querySelector("#landing-page .landing-tagline");
    const landingDesc = document.querySelector("#landing-page .landing-description");
    const landingLogo = document.querySelector("#landing-page .landing-logo i");
    const landingMCQCount = document.querySelector("#landing-page .landing-features-grid .feature-card h3"); // 560+ MCQ Bank

    if (groupName === "infection") {
        if (brandName) brandName.innerText = "Hawari Infection";
        if (authBrandTitle) authBrandTitle.innerText = "Hawari Infection";
        if (authBrandLogo) {
            authBrandLogo.className = "fa-solid fa-virus-covid brand-logo-icon";
        }
        if (landingTitle) landingTitle.innerText = "Welcome to Hawari Infection";
        if (landingTagline) landingTagline.innerText = "Our integrated system for a happy journey";
        if (landingDesc) landingDesc.innerText = "Master clinical infection control, disease manifestations, and premium board exams with our comprehensive preparation engine.";
        if (landingLogo) {
            landingLogo.className = "fa-solid fa-virus-covid";
        }
        if (landingMCQCount) landingMCQCount.innerText = "560+ MCQ Bank";
    } else {
        if (brandName) brandName.innerText = "Hawari Dermatology";
        if (authBrandTitle) authBrandTitle.innerText = "Hawari Dermatology";
        if (authBrandLogo) {
            authBrandLogo.className = "fa-solid fa-hand-dots brand-logo-icon";
        }
        if (landingTitle) landingTitle.innerText = "Welcome to Hawari Dermatology";
        if (landingTagline) landingTagline.innerText = "Your premium companion for skin disorders";
        if (landingDesc) landingDesc.innerText = "Master skin pathology, clinical dermatology, diagnostics, and therapy. Build your custom decks and flashcard modules.";
        if (landingLogo) {
            landingLogo.className = "fa-solid fa-hand-dots";
        }
        if (landingMCQCount) landingMCQCount.innerText = "Custom MCQ Bank";
    }

    // Hide course selector page
    const selectorPage = document.getElementById("course-selector-page");
    if (selectorPage) selectorPage.classList.add("hidden");

    // 1. Instant local state initialization (0ms latency)
    loadStateFromStorage();

    // 2. Check auth status & render immediately
    if (state.currentUser) {
        enterWorkspace();
        // Background non-blocking sync of cloud data to avoid UI freeze
        setTimeout(async () => {
            try {
                await Promise.allSettled([
                    fetchGlobalQuestions(groupName),
                    fetchReportTasksFromCloud(groupName),
                    fetchCourseQuizzes(groupName),
                    fetchQuizResults(groupName),
                    fetchAnnouncement(groupName),
                    fetchBookLibraryData(groupName),
                    syncUsersWithCloud()
                ]);
            } catch (e) {
                console.warn("[StagedLoad] Background sync:", e);
            }
        }, 10);
    } else {
        showLandingPage();
        // Background fetch of public metadata
        setTimeout(async () => {
            try {
                await Promise.allSettled([
                    fetchAnnouncement(groupName),
                    fetchBookLibraryData(groupName)
                ]);
            } catch(e){}
        }, 10);
    }
}

async function seedDefaultUsersToCloud(group) {
    // Hardcoded seeding deprecated — user accounts are securely managed in Supabase Auth
    return true;
}

function switchCourseTrack() {
    // Save active state before clearing session
    saveStateToStorage();

    // Clear user session for the current group
    const activeGroupKey = state.activeGroup ? getGroupKey(STORAGE_KEYS.CURRENT_USER) : null;
    state.currentUser = null;
    if (activeGroupKey) {
        encryptLocal(activeGroupKey, null);
    }

    // Reset group selection
    state.activeGroup = null;
    localStorage.removeItem("hawari_active_group");

    // Reset body classes
    document.body.classList.remove("group-infection", "group-dermatology");

    // Complete in-memory state reset for clean course isolation
    state.users = [];
    state.grantedBookUsers = [];
    state.tests = [];
    state.questions = [];
    state.notebookNotes = [];
    state.flashcards = [];
    state.reportTasks = [];
    state.courseQuizzes = [];
    state.quizResults = [];
    state.books = [];

    // Show course selector page, hide layout/landing/auth
    const selectorPage = document.getElementById("course-selector-page");
    if (selectorPage) selectorPage.classList.remove("hidden");
    
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("app-layout").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
    // 1. Direct Deep Linking via URL hash (#infection, #dermatology, #videos) or path (/infection, /dermatology, /videos)
    const rawHash = (window.location.hash || "").toLowerCase().replace(/^#\/?/, "");
    const rawPath = (window.location.pathname || "").toLowerCase().replace(/^\//, "");

    let directTargetGroup = null;
    if (rawHash === "infection" || rawHash.startsWith("infection/") || rawPath === "infection") {
        directTargetGroup = "infection";
    } else if (rawHash === "dermatology" || rawHash.startsWith("dermatology/") || rawPath === "dermatology" || rawHash === "derma") {
        directTargetGroup = "dermatology";
    }

    if (directTargetGroup) {
        selectCourseTrack(directTargetGroup);
    } else if (rawHash === "videos" || rawHash.startsWith("video-portal") || rawPath === "videos") {
        // Will be routed by initRouter
        const selectorPage = document.getElementById("course-selector-page");
        if (selectorPage) selectorPage.classList.add("hidden");
    } else {
        // Check if group track was previously selected
        const savedGroup = localStorage.getItem("hawari_active_group");
        if (savedGroup) {
            selectCourseTrack(savedGroup);
        } else {
            // No active group, show course selector page
            const selectorPage = document.getElementById("course-selector-page");
            if (selectorPage) selectorPage.classList.remove("hidden");
            document.getElementById("landing-page").classList.add("hidden");
            document.getElementById("auth-overlay").classList.add("hidden");
            document.getElementById("app-layout").classList.add("hidden");
        }
    }

    // Bind Course Selection click listeners
    const btnSelectInfection = document.getElementById("card-select-infection");
    if (btnSelectInfection) {
        btnSelectInfection.addEventListener("click", () => {
            selectCourseTrack("infection");
        });
    }

    const btnSelectDermatology = document.getElementById("card-select-dermatology");
    if (btnSelectDermatology) {
        btnSelectDermatology.addEventListener("click", () => {
            selectCourseTrack("dermatology");
        });
    }

    // Bind Switch Course button listener
    const btnSwitchCourse = document.getElementById("btn-switch-course");
    if (btnSwitchCourse) {
        btnSwitchCourse.addEventListener("click", () => {
            if (confirm("Are you sure you want to switch groups? This will end your current session and return to the main selector screen.")) {
                switchCourseTrack();
            }
        });
    }

    initAppTheme();
    initRouter();
    initAuthFlow();
    initSidebarCollapse();
    initSecurityProtections();
    initVideoPortal();
    initBackupRestoreFlow();
    initAddBookModalForm();

    // Admin Announcements Form bindings
    const annForm = document.getElementById("admin-announcements-form");
    if (annForm) {
        annForm.onsubmit = async (e) => {
            e.preventDefault();
            const text = document.getElementById("admin-announcement-text").value.trim();
            if (!text) return;
            await saveAnnouncementToCloud(text);
            showToast("Announcement Published", "Announcement successfully updated on the dashboard.", "success");
        };
    }

    const annClearBtn = document.getElementById("btn-clear-announcement");
    if (annClearBtn) {
        annClearBtn.onclick = async () => {
            if (!confirm("Are you sure you want to clear the active announcement?")) return;
            await deleteAnnouncementFromCloud();
            document.getElementById("admin-announcement-text").value = "";
            showToast("Announcement Cleared", "Announcement successfully deleted.", "success");
        };
    }

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('[PWA] Service Worker registered successfully:', reg.scope))
                .catch(err => console.error('[PWA] Service Worker registration failed:', err));
        });
    }
});

// Theme setup
function initAppTheme() {
    const body = document.body;
    const toggle = document.getElementById("theme-toggle");
    
    // Claymorphism theme state (defaults to true)
    const storedClay = localStorage.getItem("hawari_clay_theme");
    const isClayEnabled = storedClay === null ? true : storedClay === "true";
    if (isClayEnabled) {
        body.classList.add("theme-clay");
    } else {
        body.classList.remove("theme-clay");
    }

    const clayToggleBtn = document.getElementById("btn-clay-theme-toggle");
    if (clayToggleBtn) {
        clayToggleBtn.innerHTML = isClayEnabled 
            ? `<i class="fa-solid fa-shapes"></i> <span>Clay 3D: On</span>` 
            : `<i class="fa-solid fa-shapes"></i> <span>Clay 3D: Off</span>`;
            
        clayToggleBtn.addEventListener("click", () => {
            body.classList.toggle("theme-clay");
            const active = body.classList.contains("theme-clay");
            localStorage.setItem("hawari_clay_theme", active ? "true" : "false");
            clayToggleBtn.innerHTML = active 
                ? `<i class="fa-solid fa-shapes"></i> <span>Clay 3D: On</span>` 
                : `<i class="fa-solid fa-shapes"></i> <span>Clay 3D: Off</span>`;
            showToast(active ? "Claymorphism 3D Activated" : "Original Theme Restored", 
                      active ? "تم تفعيل تصميم الكلاي مورفيزم ثلاثي الأبعاد." : "تم الرجوع للتصميم الأصلي.", "info");
        });
    }

    if (state.isDarkMode) {
        body.classList.remove("light-theme");
        body.classList.add("dark-theme");
        if (toggle) toggle.checked = true;
    } else {
        body.classList.remove("dark-theme");
        body.classList.add("light-theme");
        if (toggle) toggle.checked = false;
    }

    if (toggle) {
        toggle.addEventListener("change", (e) => {
            state.isDarkMode = e.target.checked;
            if (state.isDarkMode) {
                body.classList.remove("light-theme");
                body.classList.add("dark-theme");
            } else {
                body.classList.remove("dark-theme");
                body.classList.add("light-theme");
            }
            saveStateToStorage();
        });
    }
}
function initRouter() {
    const handleRoute = () => {
        let rawHash = (window.location.hash || "").toLowerCase().replace(/^#\/?/, "");
        let rawPath = (window.location.pathname || "").toLowerCase().replace(/^\//, "");

        // 1. Intercept video portal hashes
        if (rawHash === "videos" || rawHash.startsWith("video-portal") || rawHash.startsWith("video-subscribe") || rawPath === "videos") {
            handleVideoPortalRouting(rawHash || "video-portal");
            return;
        }

        // 2. Direct Course Track Deep Linking
        let targetGroup = null;
        let subView = "";
        if (rawHash === "infection" || rawHash.startsWith("infection/") || rawPath === "infection") {
            targetGroup = "infection";
            subView = rawHash.replace(/^infection\/?/, "");
        } else if (rawHash === "dermatology" || rawHash.startsWith("dermatology/") || rawPath === "dermatology" || rawHash === "derma") {
            targetGroup = "dermatology";
            subView = rawHash.replace(/^(dermatology|derma)\/?/, "");
        }

        if (targetGroup && state.activeGroup !== targetGroup) {
            selectCourseTrack(targetGroup).then(() => {
                if (subView && state.currentUser) {
                    switchView(subView);
                }
            });
            return;
        }

        if (state.activeQuiz && !state.activeQuiz.isReview) {
            if (confirm("تحذير: مغادرة الصفحة الآن ستنهي اختبارك بدرجة صفر. هل تريد الاستمرار؟")) {
                submitQuizCheatZero(state.activeQuiz.quizId, state.currentUser.email);
                state.activeQuiz = null;
                document.getElementById("active-quiz-overlay").classList.add("hidden");
                document.body.style.overflow = "auto";
                const sidebar = document.querySelector(".sidebar");
                if (sidebar) sidebar.classList.remove("hidden");
                const appLayout = document.getElementById("app-layout");
                if (appLayout) appLayout.style.gridTemplateColumns = "";
            } else {
                // Revert hash change to keep them locked
                window.location.hash = "#report-task";
                return;
            }
        }

        if (!state.activeGroup) {
            window.location.hash = "";
            switchCourseTrack();
            return;
        }
        if (!state.currentUser) {
            showAuthOverlay();
            return;
        }
        
        let hash = window.location.hash.replace(/^#\/?/, "") || "dashboard";
        
        // Prevent accessing admin panel if not admin
        if (hash === "admin-panel" && state.currentUser.role !== "admin") {
            window.location.hash = "#dashboard";
            return;
        }

        switchView(hash);
    };

    window.addEventListener("hashchange", handleRoute);

    // Navigation item clicks
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const href = item.getAttribute("href");
            window.location.hash = href;
        });
    });

    window.addEventListener("beforeunload", (e) => {
        try {
            saveStateToStorage(true);
        } catch (err) {}
        if (state.activeQuiz && !state.activeQuiz.isReview) {
            const msg = "مغادرة الصفحة الآن ستنهي اختبارك بدرجة صفر!";
            e.returnValue = msg;
            return msg;
        }
    });

    window.addEventListener("pagehide", () => {
        try {
            saveStateToStorage(true);
        } catch (err) {}
    });

    // Run router on startup
    handleRoute();

    // Bind click listener for Videos Portal selector card
    const btnSelectVideos = document.getElementById("card-select-videos");
    if (btnSelectVideos) {
        btnSelectVideos.addEventListener("click", () => {
            window.location.hash = "#video-portal";
        });
    }
}

function switchView(viewName) {
    if (viewName === "admin-panel") {
        if (!state.currentUser || state.currentUser.role !== "admin") {
            showToast("Access Denied", "You do not have administrative privileges to access this page.", "danger");
            window.location.hash = "#dashboard";
            return;
        }
    }

    state.activeView = viewName;
    
    // Toggle nav active classes
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach(item => {
        const href = item.getAttribute("href").substring(1);
        if (href === viewName) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    // Toggle view elements visibility
    const views = document.querySelectorAll(".view-section");
    views.forEach(view => {
        if (view.id === `${viewName}-view`) {
            view.classList.remove("hidden");
            view.classList.add("active");
        } else {
            view.classList.add("hidden");
            view.classList.remove("active");
        }
    });

    // Load view specific details
    if (viewName === "dashboard") {
        renderDashboard();
    } else if (viewName === "generate-test") {
        renderGenerateTest();
    } else if (viewName === "my-tests") {
        renderMyTests();
    } else if (viewName === "notebook") {
        renderNotebook();
    } else if (viewName === "flashcards") {
        renderFlashcardsView();
    } else if (viewName === "report-task") {
        renderReportTaskStudentView();
    } else if (viewName === "hawari-book") {
        renderHawariBookView();
    } else if (viewName === "admin-panel") {
        renderAdminPanel();
    }
}

function triggerViewRefresh() {
    updateDashboardStats();
    if (state.activeView) {
        switchView(state.activeView);
    }
}
window.triggerViewRefresh = triggerViewRefresh;

// ================= SECURITY & SANITIZATION UTILITIES =================
function sanitizeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function sanitizeRichHTML(html) {
    if (!html) return "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const blockedTags = doc.querySelectorAll("script, iframe, object, embed, style, link, meta");
    blockedTags.forEach(el => el.remove());
    const allElements = doc.querySelectorAll("*");
    allElements.forEach(el => {
        const attrs = Array.from(el.attributes);
        attrs.forEach(attr => {
            if (attr.name.startsWith("on")) {
                el.removeAttribute(attr.name);
            }
        });
    });
    return doc.body.innerHTML;
}

// ================= CLOUD SYNCHRONIZATION (RESTFUL-API.DEV) =================
const CLOUD_SYNC_IDS = {
    infection: "ff8081819d82fab6019f628a21cd6064",
    dermatology: "ff8081819d82fab6019f628a21fc6065"
};

function encryptLocal(key, value) {
    try {
        if (value === null || value === undefined) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(value));
        }
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || (e.message && e.message.includes("exceeded"))) {
            try {
                // Safely clean ONLY non-critical temporary cache items, NEVER touch user tests, scores, or questions!
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith('hawari_temp_') || k.startsWith('hawari_cache_') || k.startsWith('pdf_page_cache_')) {
                        localStorage.removeItem(k);
                    }
                });
                localStorage.setItem(key, JSON.stringify(value));
            } catch (err) {
                try {
                    sessionStorage.setItem(key, JSON.stringify(value));
                } catch (sErr) {
                    console.warn("Storage quota full, unable to persist non-critical state locally.");
                }
            }
        } else {
            console.warn("Local save warning:", e);
        }
    }
}

function decryptLocal(key, defaultValue) {
    try {
        const val = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!val) return defaultValue;
        return JSON.parse(val);
    } catch (e) {
        console.error("Local load failed:", e);
        return defaultValue;
    }
}

// Network and cache performance instrumentation
window.HawariNetworkMetrics = window.HawariNetworkMetrics || {
    totalRequests: 0,
    GETRequests: 0,
    POSTRequests: 0,
    PATCHRequests: 0,
    DELETERequests: 0,

    questionBankRequests: 0,
    questionBankFullDownloads: 0,
    questionBankVersionChecks: 0,

    examListRequests: 0,
    examListVersionChecks: 0,

    profileReads: 0,

    progressWrites: 0,
    queuedWrites: 0,

    quizSubmissions: 0,

    deduplicatedRequests: 0,

    cacheHits: 0,
    cacheMisses: 0,

    successfulRequests: 0,
    failedRequests: 0,
    retryCount: 0,

    estimatedBytes: 0
};

async function supabaseRequest(path, options = {}) {
    const url = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
    if (!url || !anonKey) {
        console.warn("Supabase credentials missing.");
        return { success: false, status: 0, error: "Credentials missing" };
    }

    const bearerToken = await getValidSupabaseAccessToken();
    const tokenToUse = bearerToken || anonKey;

    const headers = {
        "apikey": anonKey,
        "Authorization": `Bearer ${tokenToUse}`,
        "Content-Type": "application/json",
        ...options.headers
    };

    const method = (options.method || "GET").toUpperCase();
    
    // Track network metrics
    window.HawariNetworkMetrics.totalRequests++;
    if (method === "GET") window.HawariNetworkMetrics.GETRequests++;
    else if (method === "POST") window.HawariNetworkMetrics.POSTRequests++;
    else if (method === "PATCH") window.HawariNetworkMetrics.PATCHRequests++;
    else if (method === "DELETE") window.HawariNetworkMetrics.DELETERequests++;

    if (path.includes("hawari_global_questions")) {
        window.HawariNetworkMetrics.questionBankRequests++;
        if (path.includes("select=group_name,last_updated")) {
            window.HawariNetworkMetrics.questionBankVersionChecks++;
        } else {
            window.HawariNetworkMetrics.questionBankFullDownloads++;
        }
    } else if (path.includes("hawari_course_quizzes") || path.includes("hawari_report_tasks")) {
        window.HawariNetworkMetrics.examListRequests++;
    } else if (path.includes("hawari_users")) {
        if (method === "GET") window.HawariNetworkMetrics.profileReads++;
        else window.HawariNetworkMetrics.progressWrites++;
    } else if (path.includes("hawari_quiz_results")) {
        if (method === "POST") window.HawariNetworkMetrics.quizSubmissions++;
    }

    try {
        const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errText = await response.text();
            window.HawariNetworkMetrics.failedRequests++;
            console.error(`[SupabaseRequest] FAILED ${method} ${path} (${response.status}):`, errText);
            return { success: false, status: response.status, error: errText || `HTTP ${response.status}` };
        }

        window.HawariNetworkMetrics.successfulRequests++;

        if (method === "DELETE" || response.status === 204) {
            return { success: true, data: true };
        }
        const text = await response.text();
        if (!text || text.trim() === "") {
            return { success: true, data: [] };
        }
        
        window.HawariNetworkMetrics.estimatedBytes += text.length;

        try {
            return JSON.parse(text);
        } catch (jsonErr) {
            return { success: true, data: [] };
        }
    } catch (e) {
        window.HawariNetworkMetrics.failedRequests++;
        console.error(`[SupabaseRequest] Exception ${method} ${path}:`, e);
        return { success: false, status: 0, error: e.message };
    }
}

let globalQuestionsCache = [];

function mergeQuestionsWithGlobal(userQuestions, globalQuestions, group = state.activeGroup) {
    const activeCourse = (group || state.activeGroup || "infection").toLowerCase();
    const seed = getGroupQuestionsSeed(activeCourse);
    const expectedPrefix = activeCourse === "dermatology" ? "q_derma_" : "q_past_";

    let template = (globalQuestions && Array.isArray(globalQuestions) && globalQuestions.length > 0)
        ? globalQuestions
        : seed;

    // Strict validation: Ensure template questions belong to the requested course
    if (template.length > 0 && template[0].id && !String(template[0].id).startsWith(expectedPrefix)) {
        console.warn(`[Merge] Template question mismatch for course "${activeCourse}". Overriding with course seed.`);
        template = seed;
    }

    const userMap = new Map();
    if (Array.isArray(userQuestions)) {
        userQuestions.forEach(q => {
            if (q && q.id) userMap.set(String(q.id), q);
        });
    }

    return template.map(gq => {
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

/* ==========================================================================
   HAWARI MULTI-COURSE QUESTION-BANK & EXAM CACHING ENGINE
   Isolated for: "infection" & "dermatology"
   Layer 1: In-Memory Cache (0ms latency)
   Layer 2: IndexedDB Persistence (hawari_question_cache)
   Layer 3: Lightweight Cloud Version Check (~48-60 bytes)
   Layer 4: Full Cloud Question Bank Download (Only when missing/stale)
   Layer 5: Published Exams / Quizzes Separate Cache (Short 90s TTL)
   Layer 6: Persistent Write-Behind Sync Queue
   Layer 7: Cross-Tab Invalidation via BroadcastChannel
   ========================================================================== */

const QUESTION_CACHE_DB_NAME = "hawari_question_cache";
const QUESTION_CACHE_STORE_NAME = "question_banks";
const QUESTION_BANK_VERSION_CHECK_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
const PUBLISHED_EXAMS_CACHE_TTL_MS = 90 * 1000; // 90 seconds short TTL for published exams

// Global in-memory caches
window.HawariQuestionCacheMemory = window.HawariQuestionCacheMemory || { infection: null, dermatology: null };
window.HawariExamCacheMemory = window.HawariExamCacheMemory || { infection: null, dermatology: null };
window.HawariQuestionLoadPromises = window.HawariQuestionLoadPromises || {};
window.HawariExamLoadPromises = window.HawariExamLoadPromises || {};

window.HawariCacheMetricsByGroup = window.HawariCacheMetricsByGroup || {
    infection: { memoryHits: 0, indexedDBHits: 0, cloudVersionChecks: 0, fullCloudDownloads: 0, deduplicatedRequests: 0, cacheUpdates: 0 },
    dermatology: { memoryHits: 0, indexedDBHits: 0, cloudVersionChecks: 0, fullCloudDownloads: 0, deduplicatedRequests: 0, cacheUpdates: 0 }
};

// Cross-tab broadcast channel for instant cache invalidation
const questionBankSyncChannel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("hawari-question-bank-sync")
    : null;

if (questionBankSyncChannel) {
    questionBankSyncChannel.onmessage = (event) => {
        if (!event || !event.data) return;
        const { type, group, version } = event.data;
        if (type === "QUESTION_BANK_UPDATED" && group) {
            console.log(`[QuestionCache] Broadcast received: ${group} question bank updated to v${version}.`);
            if (window.HawariQuestionCacheMemory[group]) {
                delete window.HawariQuestionCacheMemory[group];
            }
            if (state && state.activeGroup === group && !state.activeQuiz) {
                fetchGlobalQuestions(group, true);
            }
        } else if (type === "EXAM_LIST_UPDATED" && group) {
            console.log(`[ExamCache] Broadcast received: ${group} exams updated. Revalidating...`);
            if (window.HawariExamCacheMemory[group]) {
                delete window.HawariExamCacheMemory[group];
            }
            if (state && state.activeGroup === group) {
                fetchCourseQuizzes(group, true);
                fetchReportTasksFromCloud(group, true);
            }
        }
    };
}

// Open / initialize IndexedDB
function openQuestionCacheDB() {
    return new Promise((resolve) => {
        if (typeof indexedDB === "undefined") {
            return resolve(null);
        }
        try {
            const request = indexedDB.open(QUESTION_CACHE_DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(QUESTION_CACHE_STORE_NAME)) {
                    db.createObjectStore(QUESTION_CACHE_STORE_NAME, { keyPath: "groupName" });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => {
                console.warn("[QuestionCache] IndexedDB open error:", e.target ? e.target.error : e);
                resolve(null);
            };
        } catch (err) {
            console.warn("[QuestionCache] IndexedDB open exception:", err);
            resolve(null);
        }
    });
}

// Read from IndexedDB
async function getCachedQuestionBank(groupName) {
    try {
        const db = await openQuestionCacheDB();
        if (!db) return null;
        return new Promise((resolve) => {
            const tx = db.transaction(QUESTION_CACHE_STORE_NAME, "readonly");
            const store = tx.objectStore(QUESTION_CACHE_STORE_NAME);
            const req = store.get(groupName);
            req.onsuccess = () => {
                const record = req.result;
                if (record && Array.isArray(record.questions) && record.questions.length > 0) {
                    resolve(record);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        console.warn(`[QuestionCache] Error reading ${groupName} from IndexedDB:`, e);
        return null;
    }
}

// Write to IndexedDB
async function setCachedQuestionBank(groupName, data) {
    try {
        const db = await openQuestionCacheDB();
        if (!db) return false;
        return new Promise((resolve) => {
            const tx = db.transaction(QUESTION_CACHE_STORE_NAME, "readwrite");
            const store = tx.objectStore(QUESTION_CACHE_STORE_NAME);
            const record = {
                groupName: groupName,
                version: data.version || Date.now(),
                generatedAt: data.generatedAt || Date.now(),
                lastCheckedAt: data.lastCheckedAt || Date.now(),
                questionCount: data.questions ? data.questions.length : 0,
                questions: data.questions || []
            };
            store.put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch (e) {
        console.warn(`[QuestionCache] Error writing ${groupName} to IndexedDB:`, e);
        return false;
    }
}

// Background lightweight version revalidator (Stale-While-Revalidate: ~48-60 bytes metadata only)
async function revalidateQuestionBankVersion(group, cachedVersion) {
    const metrics = window.HawariCacheMetricsByGroup[group] || window.HawariCacheMetricsByGroup.infection;
    metrics.cloudVersionChecks++;
    console.log(`[QuestionCache] Background version check for course "${group}" (cached: ${cachedVersion})...`);
    try {
        const checkRes = await supabaseRequest(`hawari_global_questions?group_name=eq.${group}&select=group_name,last_updated`);
        if (checkRes && checkRes.length > 0) {
            const serverVersion = checkRes[0].last_updated;
            if (serverVersion && serverVersion !== cachedVersion) {
                console.log(`[QuestionCache] VERSION CHANGED for ${group}: cached ${cachedVersion} != server ${serverVersion}. Downloading updated question bank in background...`);
                await downloadFullQuestionBankFromCloud(group, serverVersion);
            } else {
                console.log(`[QuestionCache] Version UNCHANGED for course ${group} (${cachedVersion}). Cache is valid.`);
                if (window.HawariQuestionCacheMemory[group]) {
                    window.HawariQuestionCacheMemory[group].lastCheckedAt = Date.now();
                }
                const existing = await getCachedQuestionBank(group);
                if (existing) {
                    existing.lastCheckedAt = Date.now();
                    await setCachedQuestionBank(group, existing);
                }
            }
        }
    } catch (e) {
        console.warn(`[QuestionCache] Background version check skipped/fallback for ${group}:`, e);
    }
}

// Full download from Supabase with zero-leakage question sanitization for students
async function downloadFullQuestionBankFromCloud(group, targetVersion = null) {
    const metrics = window.HawariCacheMetricsByGroup[group] || window.HawariCacheMetricsByGroup.infection;
    metrics.fullCloudDownloads++;
    console.log(`[QuestionCache] FULL DOWNLOAD executing for course "${group}"...`);
    try {
        let loadedQuestions = [];
        let version = targetVersion || Date.now();

        // 1. Try secure sanitized RPC function
        try {
            const rpcRes = await supabaseRequest(`rpc/get_sanitized_questions`, {
                method: "POST",
                body: JSON.stringify({ p_group: group })
            });
            if (rpcRes && Array.isArray(rpcRes) && rpcRes.length > 0) {
                loadedQuestions = rpcRes;
            }
        } catch (rpcErr) {
            console.warn("[QuestionCache] Sanitized RPC fallback:", rpcErr.message);
        }

        // 2. Fallback to table query if RPC not yet invoked, with client-side sanitization
        if (loadedQuestions.length === 0) {
            const records = await supabaseRequest(`hawari_global_questions?group_name=eq.${group}`);
            if (records && records.length > 0 && Array.isArray(records[0].questions)) {
                version = records[0].last_updated || version;
                const isAdmin = state.currentUser && state.currentUser.role === "admin";
                loadedQuestions = records[0].questions.map(q => ({
                    id: q.id,
                    source: q.source,
                    topic: q.topic,
                    text: q.text,
                    options: q.options,
                    // Only include answers/explanations if active user is verified admin editing questions
                    ...(isAdmin ? { correctOption: q.correctOption, explanation: q.explanation } : {})
                }));
            }
        }

        if (loadedQuestions.length > 0) {
            // 1. Update In-Memory
            window.HawariQuestionCacheMemory[group] = {
                groupName: group,
                version: version,
                lastCheckedAt: Date.now(),
                generatedAt: Date.now(),
                questionCount: loadedQuestions.length,
                questions: loadedQuestions
            };
            
            // 2. Update IndexedDB
            await setCachedQuestionBank(group, window.HawariQuestionCacheMemory[group]);
            
            // 3. Update globalQuestionsCache if this is the active course
            if (state && state.activeGroup === group) {
                globalQuestionsCache = loadedQuestions;
            }
            metrics.cacheUpdates++;
            console.log(`[QuestionCache] CACHE UPDATED for ${group}: ${loadedQuestions.length} questions, version ${version}`);
            
            // 4. Notify other tabs via BroadcastChannel & localStorage
            if (questionBankSyncChannel) {
                questionBankSyncChannel.postMessage({
                    type: "QUESTION_BANK_UPDATED",
                    group: group,
                    version: version
                });
            }
            try {
                localStorage.setItem("hawari_qb_sync_" + group, String(version));
            } catch (e) {}

            return loadedQuestions;
        } else {
            return [];
        }
    } catch (e) {
        console.error(`[QuestionCache] Full cloud download failed for ${group}:`, e);
        return [];
    }
}

// Multi-layer fetch entrypoint with synchronous Memory check & async request deduplication
async function fetchGlobalQuestions(group, forceRefresh = false) {
    if (!group) return globalQuestionsCache;

    const metrics = window.HawariCacheMetricsByGroup[group] || window.HawariCacheMetricsByGroup.infection;

    // LAYER 1: In-Memory Cache (0ms latency)
    const mem = window.HawariQuestionCacheMemory[group];
    if (mem && mem.questions && !forceRefresh) {
        if (state && state.activeGroup === group) {
            globalQuestionsCache = mem.questions;
        }
        metrics.memoryHits++;
        window.HawariNetworkMetrics.cacheHits++;
        console.log(`[QuestionCache] Memory HIT for course "${group}" (${mem.questions.length} questions)`);

        // Non-blocking background revalidation after TTL
        if (Date.now() - (mem.lastCheckedAt || 0) > QUESTION_BANK_VERSION_CHECK_TTL_MS) {
            revalidateQuestionBankVersion(group, mem.version);
        }
        return mem.questions;
    }

    // Request deduplication for inflight fetches
    if (window.HawariQuestionLoadPromises[group]) {
        metrics.deduplicatedRequests++;
        window.HawariNetworkMetrics.deduplicatedRequests++;
        return window.HawariQuestionLoadPromises[group];
    }

    const asyncFetchOperation = async () => {
        try {
            // LAYER 2: IndexedDB Cache
            const idbRecord = await getCachedQuestionBank(group);
            if (idbRecord && idbRecord.questions && !forceRefresh) {
                if (state && state.activeGroup === group) {
                    globalQuestionsCache = idbRecord.questions;
                }
                window.HawariQuestionCacheMemory[group] = idbRecord;
                metrics.indexedDBHits++;
                window.HawariNetworkMetrics.cacheHits++;
                console.log(`[QuestionCache] IndexedDB HIT for course "${group}" (${idbRecord.questions.length} questions, v${idbRecord.version})`);

                if (Date.now() - (idbRecord.lastCheckedAt || 0) > QUESTION_BANK_VERSION_CHECK_TTL_MS) {
                    revalidateQuestionBankVersion(group, idbRecord.version);
                }
                return idbRecord.questions;
            }

            // LAYER 3 & 4: Cold Load / Full Cloud Download
            window.HawariNetworkMetrics.cacheMisses++;
            return await downloadFullQuestionBankFromCloud(group);
        } finally {
            delete window.HawariQuestionLoadPromises[group];
        }
    };

    const inflightPromise = asyncFetchOperation();
    window.HawariQuestionLoadPromises[group] = inflightPromise;
    return inflightPromise;
}

// Background Question Bank Prefetch (runs on login / course load without blocking UI)
function prefetchQuestionBank(group) {
    if (!group) return;
    setTimeout(() => {
        fetchGlobalQuestions(group).catch(err => {
            console.warn(`[QuestionCache] Background prefetch warning for ${group}:`, err);
        });
    }, 150);
}

// Persistent Write-Behind Sync Queue
const SYNC_QUEUE_KEY = "hawari_pending_sync_queue";

function getPendingSyncQueue() {
    try {
        const raw = localStorage.getItem(SYNC_QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function savePendingSyncQueue(queue) {
    try {
        localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {}
}

function enqueueSyncItem(item) {
    const queue = getPendingSyncQueue();
    const existingIdx = queue.findIndex(q => q.id === item.id && q.entityType === item.entityType);
    const enrichedItem = {
        ...item,
        updatedAt: item.updatedAt || Date.now(),
        retryCount: 0,
        createdAt: item.createdAt || Date.now()
    };
    if (existingIdx >= 0) {
        queue[existingIdx] = enrichedItem;
    } else {
        queue.push(enrichedItem);
    }
    savePendingSyncQueue(queue);
    window.HawariNetworkMetrics.queuedWrites++;
    scheduleQueueFlush(2000);
}

function enqueuePendingSync(item) {
    return enqueueSyncItem(item);
}

function enqueueOfflineSync(table, operation, payload) {
    if (table === "hawari_users") {
        if (operation === "DELETE") {
            const email = (payload && payload.email) ? payload.email : "";
            const group = (payload && payload.group_name) ? payload.group_name : (state.activeGroup || "infection");
            if (email) {
                enqueueSyncItem({
                    entityType: "user_deletion",
                    id: `del_${email}_${group}_${Date.now()}`,
                    email: email,
                    group: group,
                    payload: { email, group_name: group }
                });
            }
        } else {
            const records = Array.isArray(payload) ? payload : [payload];
            records.forEach(rec => {
                if (rec && rec.email) {
                    const group = rec.group_name || state.activeGroup || "infection";
                    enqueueSyncItem({
                        entityType: "student_progress",
                        id: `progress_${rec.email}_${group}_${Date.now()}`,
                        email: rec.email,
                        group: group,
                        payload: rec
                    });
                }
            });
        }
    }
}

let queueFlushTimer = null;
let isFlushingQueue = false;

function scheduleQueueFlush(delayMs = 2500) {
    if (queueFlushTimer) clearTimeout(queueFlushTimer);
    queueFlushTimer = setTimeout(() => {
        flushPendingSyncQueue();
    }, delayMs);
}

async function flushPendingSyncQueue() {
    if (isFlushingQueue || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const queue = getPendingSyncQueue();
    if (queue.length === 0) return;

    isFlushingQueue = true;
    const remainingQueue = [];

    for (const item of queue) {
        try {
            if (item.entityType === "quiz_result") {
                await saveQuizResultToCloud(item.payload, true);
            } else if (item.entityType === "user_progress" || item.entityType === "student_progress") {
                await supabaseRequest("hawari_users", {
                    method: "POST",
                    headers: { "Prefer": "resolution=merge-duplicates" },
                    body: JSON.stringify(item.payload)
                });
            } else if (item.entityType === "user_deletion") {
                await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(item.email)}&group_name=eq.${encodeURIComponent(item.group)}`, {
                    method: "DELETE"
                });
            }
            console.log(`[SyncQueue] Successfully synced ${item.entityType} (${item.id})`);
        } catch (err) {
            console.warn(`[SyncQueue] Failed sync attempt for ${item.id}:`, err);
            item.retryCount = (item.retryCount || 0) + 1;
            window.HawariNetworkMetrics.retryCount++;
            if (item.retryCount < 5) {
                remainingQueue.push(item);
            } else {
                console.error(`[SyncQueue] Dropping item ${item.id} after 5 failed retries.`);
            }
        }
    }

    savePendingSyncQueue(remainingQueue);
    isFlushingQueue = false;

    if (remainingQueue.length > 0) {
        scheduleQueueFlush(10000);
    }
}

if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
        console.log("[SyncQueue] Network online. Flushing pending sync queue...");
        flushPendingSyncQueue();
    });
}

// Development debug helpers
window.debugQuestionCache = function() {
    const groups = ["infection", "dermatology"];
    const results = {};

    groups.forEach(grp => {
        const mem = window.HawariQuestionCacheMemory[grp];
        let cacheAgeStr = "N/A";
        let statusStr = "COLD";

        if (mem && mem.lastCheckedAt) {
            const diffMs = Date.now() - mem.lastCheckedAt;
            const mins = Math.floor(diffMs / 60000);
            const hours = Math.floor(mins / 60);
            cacheAgeStr = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m ${Math.round((diffMs % 60000) / 1000)}s`;
            statusStr = diffMs > QUESTION_BANK_VERSION_CHECK_TTL_MS ? "STALE" : "FRESH";
        }

        const metrics = window.HawariCacheMetricsByGroup[grp] || {
            memoryHits: 0,
            indexedDBHits: 0,
            fullCloudDownloads: 0,
            cloudVersionChecks: 0,
            deduplicatedRequests: 0
        };

        results[grp] = {
            course: grp.toUpperCase(),
            questions: mem ? mem.questionCount : 0,
            cachedVersion: mem ? mem.version : "N/A",
            cacheAge: cacheAgeStr,
            status: statusStr,
            memoryHits: metrics.memoryHits,
            indexedDBHits: metrics.indexedDBHits,
            fullDownloads: metrics.fullCloudDownloads,
            versionChecks: metrics.cloudVersionChecks,
            deduplicated: metrics.deduplicatedRequests
        };
    });

    console.group("=== HAWARI QUESTION CACHE DIAGNOSTICS ===");
    console.table(results);
    console.groupEnd();

    // Published Exam Cache
    const examCacheInfo = {};
    groups.forEach(grp => {
        const memExam = window.HawariExamCacheMemory && window.HawariExamCacheMemory[grp];
        examCacheInfo[grp] = {
            course: grp.toUpperCase(),
            cachedQuizzes: memExam && memExam.quizzes ? memExam.quizzes.length : 0,
            cachedReportTasks: memExam && memExam.reportTasks ? memExam.reportTasks.length : 0,
            lastCheckedAge: memExam && memExam.lastCheckedAt ? `${Math.round((Date.now() - memExam.lastCheckedAt)/1000)}s ago` : "N/A",
            status: memExam && (Date.now() - memExam.lastCheckedAt < PUBLISHED_EXAMS_CACHE_TTL_MS) ? "FRESH" : "STALE/EMPTY"
        };
    });
    console.group("=== HAWARI PUBLISHED EXAMS CACHE ===");
    console.table(examCacheInfo);
    console.groupEnd();

    // Sync Queue Status
    const queue = getPendingSyncQueue();
    console.group(`=== STUDENT SYNC QUEUE (${queue.length} pending writes) ===`);
    if (queue.length > 0) {
        console.table(queue.map(q => ({
            id: q.id,
            type: q.entityType,
            email: q.email,
            retries: q.retryCount,
            age: `${Math.round((Date.now() - q.createdAt)/1000)}s`
        })));
    } else {
        console.log("Sync queue is empty. All local state synchronized.");
    }
    console.groupEnd();

    return {
        questions: results,
        exams: examCacheInfo,
        pendingQueueCount: queue.length
    };
};

window.debugNetworkMetrics = function() {
    console.group("=== HAWARI SUPABASE NETWORK METRICS ===");
    console.table(window.HawariNetworkMetrics);
    console.groupEnd();
    return window.HawariNetworkMetrics;
};

async function saveGlobalQuestionsToCloud() {
    const group = state.activeGroup;
    if (!group) return;

    // Strip student-specific answers/status from global template
    const cleanQuestions = state.questions.map(q => {
        return {
            id: q.id,
            source: q.source,
            topic: q.topic,
            text: q.text,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation
        };
    });

    const newVersion = Date.now();
    const payload = {
        group_name: group,
        questions: cleanQuestions,
        last_updated: newVersion
    };

    try {
        await supabaseRequest("hawari_global_questions", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });
        
        // Update local memory and IndexedDB caches immediately
        window.HawariQuestionCacheMemory[group] = {
            groupName: group,
            version: newVersion,
            lastCheckedAt: Date.now(),
            generatedAt: Date.now(),
            questionCount: cleanQuestions.length,
            questions: cleanQuestions
        };
        await setCachedQuestionBank(group, window.HawariQuestionCacheMemory[group]);
        globalQuestionsCache = cleanQuestions;

        // Broadcast invalidation across tabs
        if (questionBankSyncChannel) {
            questionBankSyncChannel.postMessage({
                type: "QUESTION_BANK_UPDATED",
                group: group,
                version: newVersion
            });
        }
        try {
            localStorage.setItem("hawari_qb_sync_" + group, String(newVersion));
        } catch (e) {}

        console.log(`[Sync] Saved global questions template to cloud for course ${group} (version ${newVersion})`);
    } catch (e) {
        console.error("[Sync] Failed to save global questions to cloud:", e);
    }
}

// ==========================================
// PUBLISHED EXAMS / TESTS CACHING & FRESHNESS
// ==========================================

async function fetchReportTasksFromCloud(group, forceRefresh = false) {
    if (!group) return;

    // Check in-memory exam cache (90s TTL)
    const memExam = window.HawariExamCacheMemory[group];
    if (memExam && memExam.reportTasks && !forceRefresh) {
        state.reportTasks = memExam.reportTasks;
        if (Date.now() - memExam.lastCheckedAt > PUBLISHED_EXAMS_CACHE_TTL_MS) {
            // Background revalidation
            revalidateReportTasks(group);
        }
        return state.reportTasks;
    }

    try {
        const records = await supabaseRequest(`hawari_report_tasks?group_name=eq.${group}`);
        if (records && Array.isArray(records)) {
            state.reportTasks = records.map(row => ({
                id: row.id,
                title: row.title,
                duration: row.time_limit,
                questions: row.question_ids || [],
                dateCreated: row.date_created
            }));
            
            // Cache in memory
            window.HawariExamCacheMemory[group] = window.HawariExamCacheMemory[group] || {};
            window.HawariExamCacheMemory[group].reportTasks = state.reportTasks;
            window.HawariExamCacheMemory[group].lastCheckedAt = Date.now();
            
            console.log(`[Sync] Fetched ${state.reportTasks.length} report tasks from cloud for course ${group}`);
        }
    } catch (e) {
        console.error("[Sync] Failed to fetch report tasks from cloud:", e);
    }
}

async function revalidateReportTasks(group) {
    try {
        const records = await supabaseRequest(`hawari_report_tasks?group_name=eq.${group}`);
        if (records && Array.isArray(records)) {
            const mapped = records.map(row => ({
                id: row.id,
                title: row.title,
                duration: row.time_limit,
                questions: row.question_ids || [],
                dateCreated: row.date_created
            }));
            state.reportTasks = mapped;
            window.HawariExamCacheMemory[group] = window.HawariExamCacheMemory[group] || {};
            window.HawariExamCacheMemory[group].reportTasks = mapped;
            window.HawariExamCacheMemory[group].lastCheckedAt = Date.now();
            if (state.activeView === "report-task") {
                renderReportTaskStudentView();
            }
        }
    } catch (e) {}
}

async function saveReportTaskToCloud(rt) {
    const group = state.activeGroup;
    const payload = {
        id: rt.id,
        group_name: group,
        title: rt.title,
        question_ids: rt.questions,
        time_limit: rt.duration,
        date_created: rt.dateCreated
    };
    try {
        await supabaseRequest("hawari_report_tasks", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });
        
        // Invalidate and update exam cache immediately
        if (window.HawariExamCacheMemory[group]) {
            delete window.HawariExamCacheMemory[group];
        }
        if (questionBankSyncChannel) {
            questionBankSyncChannel.postMessage({
                type: "EXAM_LIST_UPDATED",
                group: group
            });
        }
        console.log(`[Sync] Saved report task "${rt.title}" to cloud`);
    } catch (e) {
        console.error("[Sync] Failed to save report task to cloud:", e);
    }
}

async function deleteReportTaskFromCloud(id) {
    const group = state.activeGroup;
    try {
        await supabaseRequest(`hawari_report_tasks?id=eq.${id}`, {
            method: "DELETE"
        });
        if (window.HawariExamCacheMemory[group]) {
            delete window.HawariExamCacheMemory[group];
        }
        if (questionBankSyncChannel) {
            questionBankSyncChannel.postMessage({
                type: "EXAM_LIST_UPDATED",
                group: group
            });
        }
        console.log(`[Sync] Deleted report task ${id} from cloud`);
    } catch (e) {
        console.error("[Sync] Failed to delete report task from cloud:", e);
    }
}

async function fetchCourseQuizzes(group, forceRefresh = false) {
    if (!group) return;

    // Check in-memory exam cache (90s TTL)
    const memExam = window.HawariExamCacheMemory[group];
    if (memExam && memExam.quizzes && !forceRefresh) {
        state.courseQuizzes = memExam.quizzes;
        if (Date.now() - memExam.lastCheckedAt > PUBLISHED_EXAMS_CACHE_TTL_MS) {
            // Background revalidation
            revalidateCourseQuizzes(group);
        }
        return state.courseQuizzes;
    }

    try {
        const records = await supabaseRequest(`hawari_course_quizzes?group_name=eq.${group}`);
        if (records && Array.isArray(records)) {
            state.courseQuizzes = records.map(row => ({
                id: row.id,
                title: row.title,
                questions: row.questions || [],
                duration: row.time_limit,
                startTime: row.start_time,
                endTime: row.end_time,
                status: row.status
            }));

            // Cache in memory
            window.HawariExamCacheMemory[group] = window.HawariExamCacheMemory[group] || {};
            window.HawariExamCacheMemory[group].quizzes = state.courseQuizzes;
            window.HawariExamCacheMemory[group].lastCheckedAt = Date.now();

            console.log(`[Sync] Fetched ${state.courseQuizzes.length} quizzes from cloud for course ${group}`);
        }
    } catch (e) {
        console.error("[Sync] Failed to fetch course quizzes:", e);
    }
}

async function revalidateCourseQuizzes(group) {
    try {
        const records = await supabaseRequest(`hawari_course_quizzes?group_name=eq.${group}`);
        if (records && Array.isArray(records)) {
            const mapped = records.map(row => ({
                id: row.id,
                title: row.title,
                questions: row.questions || [],
                duration: row.time_limit,
                startTime: row.start_time,
                endTime: row.end_time,
                status: row.status
            }));
            state.courseQuizzes = mapped;
            window.HawariExamCacheMemory[group] = window.HawariExamCacheMemory[group] || {};
            window.HawariExamCacheMemory[group].quizzes = mapped;
            window.HawariExamCacheMemory[group].lastCheckedAt = Date.now();
            if (state.activeView === "quizzes") {
                renderCourseQuizzesStudentView();
            }
        }
    } catch (e) {}
}

async function saveCourseQuizToCloud(quiz) {
    const group = state.activeGroup;
    const payload = {
        id: quiz.id,
        group_name: group,
        title: quiz.title,
        questions: quiz.questions,
        time_limit: quiz.duration,
        start_time: quiz.startTime,
        end_time: quiz.endTime,
        status: quiz.status || 'active'
    };
    try {
        await supabaseRequest("hawari_course_quizzes", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });

        // Invalidate and update exam cache immediately
        if (window.HawariExamCacheMemory[group]) {
            delete window.HawariExamCacheMemory[group];
        }
        if (questionBankSyncChannel) {
            questionBankSyncChannel.postMessage({
                type: "EXAM_LIST_UPDATED",
                group: group
            });
        }
        console.log(`[Sync] Saved course quiz "${quiz.title}" to cloud`);
    } catch (e) {
        console.error("[Sync] Failed to save course quiz:", e);
    }
}

async function deleteCourseQuizFromCloud(id) {
    const group = state.activeGroup;
    try {
        await supabaseRequest(`hawari_course_quizzes?id=eq.${id}`, {
            method: "DELETE"
        });
        if (window.HawariExamCacheMemory[group]) {
            delete window.HawariExamCacheMemory[group];
        }
        if (questionBankSyncChannel) {
            questionBankSyncChannel.postMessage({
                type: "EXAM_LIST_UPDATED",
                group: group
            });
        }
        console.log(`[Sync] Deleted quiz ${id} from cloud`);
    } catch (e) {
        console.error("[Sync] Failed to delete course quiz:", e);
    }
}

async function fetchAnnouncement(groupName) {
    try {
        const records = await supabaseRequest(`hawari_announcements?group_name=eq.${groupName}`);
        if (records && records.length > 0) {
            state.announcement = records[0].content;
        } else {
            state.announcement = "";
        }
    } catch (e) {
        console.error("[Sync] Failed to fetch announcement:", e);
        state.announcement = "";
    }
    renderAnnouncementWidget();
}

async function saveAnnouncementToCloud(content) {
    const group = state.activeGroup;
    if (!group) return;

    const payload = {
        group_name: group,
        content: content,
        updated_at: new Date().toISOString()
    };

    try {
        await supabaseRequest("hawari_announcements", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });
        state.announcement = content;
        renderAnnouncementWidget();
    } catch (e) {
        console.error("[Sync] Failed to save announcement:", e);
    }
}

async function deleteAnnouncementFromCloud() {
    const group = state.activeGroup;
    if (!group) return;

    try {
        await supabaseRequest(`hawari_announcements?group_name=eq.${group}`, {
            method: "DELETE"
        });
        state.announcement = "";
        renderAnnouncementWidget();
    } catch (e) {
        console.error("[Sync] Failed to delete announcement:", e);
    }
}

function renderAnnouncementWidget() {
    const card = document.getElementById("dashboard-announcements-card");
    const contentLbl = document.getElementById("dashboard-announcements-content");
    if (!card || !contentLbl) return;

    if (state.announcement) {
        contentLbl.innerText = state.announcement;
        card.classList.remove("hidden");
    } else {
        card.classList.add("hidden");
    }
}

async function fetchQuizResults(group) {
    try {
        const records = await supabaseRequest(`hawari_quiz_results?group_name=eq.${group}`);
        if (records && Array.isArray(records)) {
            state.quizResults = records;
            console.log(`[Sync] Fetched ${state.quizResults.length} quiz results from cloud`);
        }
    } catch (e) {
        console.error("[Sync] Failed to fetch quiz results:", e);
    }
}

async function saveQuizResultToCloud(result, isQueueFlush = false) {
    const payload = {
        id: result.id || `${result.quiz_id}_${result.email}`,
        quiz_id: result.quiz_id,
        email: result.email,
        group_name: state.activeGroup,
        score: result.score,
        total_questions: result.total_questions,
        answers: result.answers,
        submitted_at: result.submitted_at || new Date().toISOString(),
        status: result.status
    };
    try {
        const res = await supabaseRequest("hawari_quiz_results", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });

        if (res && res.error && !isQueueFlush) {
            enqueueSyncItem({
                id: payload.id,
                entityType: "quiz_result",
                group: state.activeGroup,
                email: result.email,
                payload: payload
            });
        }
        console.log(`[Sync] Saved quiz result for ${result.email} to cloud`);
    } catch (e) {
        console.error("[Sync] Failed to save quiz result:", e);
        if (!isQueueFlush) {
            enqueueSyncItem({
                id: payload.id,
                entityType: "quiz_result",
                group: state.activeGroup,
                email: result.email,
                payload: payload
            });
        }
    }
}

async function syncUsersWithCloud() {
    const group = state.activeGroup;
    if (!group) return;

    const isAdmin = state.currentUser && state.currentUser.role === "admin";
    
    // Determine target email to fetch/sync
    let targetEmail = null;
    if (state.currentUser) {
        targetEmail = state.currentUser.email.trim().toLowerCase();
    } else if (typeof currentAuthenticatingEmail !== 'undefined' && currentAuthenticatingEmail) {
        targetEmail = currentAuthenticatingEmail.trim().toLowerCase();
    }

    // Helper to test if question array contains meaningful student answers/marks
    function hasAnsweredQuestions(qArr) {
        if (!Array.isArray(qArr) || qArr.length === 0) return false;
        return qArr.some(q => (q.status && q.status !== "unused") || q.marked || q.notes || q.userAnswer);
    }

    // 1. Fetch cloud records for the current active course only
    let queryPath = `hawari_users?group_name=eq.${encodeURIComponent(group)}`;
    if (!isAdmin && targetEmail) {
        queryPath += `&email=eq.${encodeURIComponent(targetEmail)}`;
    } else if (!isAdmin && !targetEmail) {
        return;
    }

    try {
        const cloudRecords = await supabaseRequest(queryPath);
        if (cloudRecords && Array.isArray(cloudRecords)) {
            // Map cloud database rows to user object structure
            const cloudUsers = cloudRecords.map(row => {
                return {
                    email: row.email,
                    password: row.password_hash,
                    role: row.role,
                    status: row.status,
                    dateRegistered: row.date_registered,
                    questions: Array.isArray(row.questions) ? row.questions : [],
                    tests: Array.isArray(row.tests) ? row.tests : [],
                    notebookNotes: Array.isArray(row.notebook_notes) ? row.notebook_notes : [],
                    flashcards: Array.isArray(row.flashcards) ? row.flashcards : [],
                    reportTaskProgress: row.report_task_progress || {},
                    displayName: row.display_name || "",
                    lastUpdated: row.last_updated || 0
                };
            });

            // 2. Merge local state.users with cloudUsers
            cloudUsers.forEach(cu => {
                const localUserIdx = state.users.findIndex(u => u.email.toLowerCase() === cu.email.toLowerCase());
                if (localUserIdx >= 0) {
                    const lu = state.users[localUserIdx];
                    // Sync status (e.g. pending -> approved)
                    if (cu.status === "approved" && lu.status !== "approved") {
                        lu.status = "approved";
                        lu.role = cu.role;
                    }
                    // Sync display name if cloud has it
                    if (cu.displayName) {
                        lu.displayName = cu.displayName;
                        if (state.currentUser && state.currentUser.email.toLowerCase() === lu.email.toLowerCase()) {
                            state.currentUser.displayName = cu.displayName;
                        }
                    }
                    // Smart bidirectional merge for tests (preserves completed tests)
                    const localTests = Array.isArray(lu.tests) ? lu.tests : [];
                    const cloudTests = Array.isArray(cu.tests) ? cu.tests : [];
                    if (cloudTests.length > 0 && localTests.length === 0) {
                        lu.tests = cloudTests;
                    } else if (cloudTests.length > 0 && localTests.length > 0) {
                        const testMap = new Map();
                        localTests.forEach(t => testMap.set(t.id, t));
                        cloudTests.forEach(t => {
                            if (!testMap.has(t.id) || (t.timeRemaining !== undefined && t.isCompleted)) {
                                testMap.set(t.id, t);
                            }
                        });
                        lu.tests = Array.from(testMap.values());
                    }

                    // Smart merge for report task progress
                    lu.reportTaskProgress = Object.assign({}, cu.reportTaskProgress || {}, lu.reportTaskProgress || {});

                    // Smart merge for notebook notes
                    if (Array.isArray(cu.notebookNotes) && cu.notebookNotes.length > 0 && (!lu.notebookNotes || lu.notebookNotes.length === 0)) {
                        lu.notebookNotes = cu.notebookNotes;
                    }

                    // Smart merge for flashcards
                    if (Array.isArray(cu.flashcards) && cu.flashcards.length > 0 && (!lu.flashcards || lu.flashcards.length === 0)) {
                        lu.flashcards = cu.flashcards;
                    }

                    // Smart Progress Sync: If cloud has answered questions, merge them!
                    const cloudHasAnswers = hasAnsweredQuestions(cu.questions);
                    const localHasAnswers = hasAnsweredQuestions(lu.questions);

                    if (cloudHasAnswers && localHasAnswers) {
                        // Merge question states per ID so neither device loses answers
                        const qMap = new Map();
                        lu.questions.forEach(q => qMap.set(q.id, q));
                        cu.questions.forEach(cq => {
                            const lq = qMap.get(cq.id);
                            if (!lq || lq.status === "unused" || (cq.status !== "unused" && (!lq.userAnswer && cq.userAnswer))) {
                                qMap.set(cq.id, cq);
                            }
                        });
                        lu.questions = Array.from(qMap.values());
                        lu.lastUpdated = Math.max(lu.lastUpdated || 0, cu.lastUpdated || 0);
                    } else if (cloudHasAnswers || (!localHasAnswers && (cu.lastUpdated || 0) >= (lu.lastUpdated || 0))) {
                        lu.questions = cu.questions;
                        lu.lastUpdated = Math.max(lu.lastUpdated || 0, cu.lastUpdated || 0);
                    }
                    
                    // If this is the current logged-in user, also update active state immediately!
                    if (state.currentUser && state.currentUser.email.toLowerCase() === lu.email.toLowerCase()) {
                        state.tests = lu.tests || [];
                        state.notebookNotes = lu.notebookNotes || [];
                        state.flashcards = lu.flashcards || [];
                        if (lu.questions && lu.questions.length > 0) {
                            const templateQuestions = (globalQuestionsCache && globalQuestionsCache.length > 0) ? globalQuestionsCache : getGroupQuestionsSeed();
                            state.questions = mergeQuestionsWithGlobal(lu.questions, templateQuestions);
                        }
                        state.currentUser.lastUpdated = lu.lastUpdated;
                        triggerViewRefresh();
                    }
                } else {
                    state.users.push(cu);
                    if (state.currentUser && state.currentUser.email.toLowerCase() === cu.email.toLowerCase()) {
                        state.tests = Array.isArray(cu.tests) ? cu.tests : [];
                        state.notebookNotes = Array.isArray(cu.notebookNotes) ? cu.notebookNotes : [];
                        state.flashcards = Array.isArray(cu.flashcards) && cu.flashcards.length > 0 ? cu.flashcards : state.flashcards;
                        if (Array.isArray(cu.questions) && cu.questions.length > 0) {
                            const templateQuestions = (globalQuestionsCache && globalQuestionsCache.length > 0) ? globalQuestionsCache : getGroupQuestionsSeed();
                            state.questions = mergeQuestionsWithGlobal(cu.questions, templateQuestions);
                        }
                        state.currentUser.lastUpdated = cu.lastUpdated;
                        triggerViewRefresh();
                    }
                }
            });
        }
    } catch (e) {
        console.warn("[SyncUsers] Cloud fetch error:", e);
    }

    // 3. Determine which users to write back to Supabase
    // ONLY students write their own updated progress row to Supabase.
    // Admin approvals/deletions/toggles are written specifically on admin action.
    let usersToWrite = [];
    if (!isAdmin && targetEmail) {
        const matchingUser = state.users.find(u => u.email.toLowerCase() === targetEmail.toLowerCase());
        if (matchingUser && matchingUser.lastUpdated > 0) {
            usersToWrite = [matchingUser];
        }
    }

    // Upsert records to Supabase in parallel
    const promises = usersToWrite.map(async (user) => {
        const payload = {
            email: user.email.trim().toLowerCase(),
            group_name: group,
            password_hash: user.password,
            role: user.role || "student",
            status: user.status || "approved",
            date_registered: user.dateRegistered,
            questions: user.questions || [],
            tests: user.tests || [],
            notebook_notes: user.notebookNotes || [],
            flashcards: user.flashcards || [],
            report_task_progress: user.reportTaskProgress || {},
            display_name: user.displayName || "",
            last_updated: user.lastUpdated || Date.now()
        };
        try {
            await supabaseRequest("hawari_users", {
                method: "POST",
                headers: {
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.warn(`[SyncUsers] Direct push failed for ${user.email}, queueing offline sync:`, err);
            enqueuePendingSync({
                entityType: "student_progress",
                id: `progress_${user.email}_${group}_${Date.now()}`,
                email: user.email,
                group: group,
                payload: payload
            });
        }
    });
    await Promise.all(promises);

    // 4. Save to local storage using encrypted local helper
    encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);
}

// ================= AUTHENTICATION FLOW =================
let simulatedCode = null;
let currentAuthenticatingEmail = null;

function initAuthFlow() {
    const btnSendCode = document.getElementById("btn-send-code");
    const btnCheckStatus = document.getElementById("btn-check-status");
    const btnLogout = document.getElementById("btn-logout");
    const emailInput = document.getElementById("auth-email");
    
    // New controls
    const btnLoginSubmit = document.getElementById("btn-login-submit");
    const btnRegisterSubmit = document.getElementById("btn-register-submit");
    const passwordLoginInput = document.getElementById("auth-login-password");
    const passwordRegInput = document.getElementById("auth-reg-password");
    const passwordRegConfirmInput = document.getElementById("auth-reg-confirm");

    const backToEmail1 = document.getElementById("btn-back-to-email-1");
    const backToEmail2 = document.getElementById("btn-back-to-email-2");
    const backToEmail3 = document.getElementById("btn-back-to-email-3");

    // Enter Key Listeners for form submission
    if (emailInput) {
        emailInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                btnSendCode.click();
            }
        });
    }

    if (passwordLoginInput) {
        passwordLoginInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                btnLoginSubmit.click();
            }
        });
    }

    if (passwordRegConfirmInput) {
        passwordRegConfirmInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                btnRegisterSubmit.click();
            }
        });
    }

    // Email Step Continue
    if (btnSendCode) {
        btnSendCode.addEventListener("click", async () => {
            let email = emailInput.value.trim().toLowerCase();
            console.log("[Auth] Continue button clicked. Input email value:", email);
            if (!email) {
                showToast("Email Required", "Please enter an email address", "danger");
                return;
            }
            if (!email.includes("@")) {
                email += "@gmail.com";
                emailInput.value = email;
                console.log("[Auth] Automatically appended domain. Email is now:", email);
            }
            if (!email.endsWith("@gmail.com")) {
                showToast("Gmail Only", "Only Gmail email accounts are allowed on this portal.", "warning");
                return;
            }

            // Show loading spinner on button
            btnSendCode.disabled = true;
            btnSendCode.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking...`;

            try {
                // Sync with cloud to get latest approvals/registrations
                await syncUsersWithCloud();
            } catch (e) {
                console.error("Cloud check failed:", e);
            }

            btnSendCode.disabled = false;
            btnSendCode.innerHTML = `Continue <i class="fa-solid fa-arrow-right"></i>`;

            currentAuthenticatingEmail = email;

            // Check database
            console.log("[Auth] Checking users list in state:", state.users);
            const user = state.users.find(u => u.email === email);
            if (user) {
                console.log("[Auth] Found user in database:", user);
                if (user.status === "approved") {
                    // Go to password login step
                    showAuthStep("auth-password-step");
                    document.getElementById("login-email-display").innerText = email;
                    passwordLoginInput.value = "";
                    passwordLoginInput.focus();
                } else {
                    // Pending approval
                    showAuthStep("auth-pending-step");
                    document.getElementById("pending-email-display").innerText = email;
                }
            } else {
                console.log("[Auth] User not found. Directing to password setup step.");
                // Go to registration password setup step
                showAuthStep("auth-register-step");
                document.getElementById("register-email-display").innerText = email;
                passwordRegInput.value = "";
                passwordRegConfirmInput.value = "";
                passwordRegInput.focus();
            }
        });
    }

    function checkLoginLockout(email) {
        const lockoutTime = sessionStorage.getItem("lockout_" + email);
        if (lockoutTime) {
            const remaining = parseInt(lockoutTime) - Date.now();
            if (remaining > 0) {
                return Math.ceil(remaining / 1000);
            }
        }
        return 0;
    }

    function setLoginLockout(email) {
        const lockoutUntil = Date.now() + 5 * 60 * 1000;
        sessionStorage.setItem("lockout_" + email, lockoutUntil.toString());
    }

    // Submit Password Login
    if (btnLoginSubmit) {
        btnLoginSubmit.addEventListener("click", async () => {
            const password = passwordLoginInput.value;
            console.log("[Auth] Login button clicked. currentAuthenticatingEmail:", currentAuthenticatingEmail);
            if (!password) {
                showToast("Password Required", "Please enter your password.", "danger");
                return;
            }

            const lockoutSec = checkLoginLockout(currentAuthenticatingEmail);
            if (lockoutSec > 0) {
                showToast("Locked Out", `Too many failed attempts. Try again in ${Math.ceil(lockoutSec / 60)} minute(s).`, "danger");
                return;
            }

            console.log("[Auth] Searching user records in database for:", currentAuthenticatingEmail);
            const user = state.users.find(u => u.email === currentAuthenticatingEmail);
            const hashedInput = sha256Sync(password);
            
            if (user && user.password === hashedInput) {
                // Show loading spinner
                btnLoginSubmit.disabled = true;
                btnLoginSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Logging in...`;

                sessionStorage.removeItem("attempts_" + currentAuthenticatingEmail);
                sessionStorage.removeItem("lockout_" + currentAuthenticatingEmail);
                console.log("[AUTH-TRACE] custom login success");
                state.currentUser = user;
                await loginToSupabaseAuth(currentAuthenticatingEmail, password);

                try {
                    // Force sync cloud progress to avoid overwriting newer progress from other devices
                    await syncUsersWithCloud();
                } catch (e) {
                    console.error("Login sync failed:", e);
                }

                loadUserSpecificProgress(user.email);
                saveStateToStorage(true); // Skip cloud sync because syncUsersWithCloud() was just run and awaited above
                
                btnLoginSubmit.disabled = false;
                btnLoginSubmit.innerHTML = `Log In <i class="fa-solid fa-right-to-bracket"></i>`;

                showToast("Login Success", `Welcome to Hawari Course study engine!`, "success");
                enterWorkspace();
            } else {
                let attempts = parseInt(sessionStorage.getItem("attempts_" + currentAuthenticatingEmail) || "0") + 1;
                sessionStorage.setItem("attempts_" + currentAuthenticatingEmail, attempts.toString());
                if (attempts >= 5) {
                    setLoginLockout(currentAuthenticatingEmail);
                    showToast("Account Locked", "Too many failed attempts. You are locked out for 5 minutes.", "danger");
                } else {
                    showToast("Invalid Password", `The password you entered is incorrect. (${5 - attempts} attempts remaining)`, "danger");
                }
                passwordLoginInput.value = "";
                passwordLoginInput.focus();
            }
        });
    }

    // Submit New Registration Request
    if (btnRegisterSubmit) {
        btnRegisterSubmit.addEventListener("click", async () => {
            const nameInput = document.getElementById("auth-reg-name");
            const name = nameInput ? nameInput.value.trim() : "";
            const password = passwordRegInput.value;
            const confirm = passwordRegConfirmInput.value;

            if (!name) {
                showToast("Name Required", "Please enter your full name.", "danger");
                return;
            }

            if (!password || password.length < 6) {
                showToast("Weak Password", "Password must be at least 6 characters long.", "danger");
                return;
            }

            if (password !== confirm) {
                showToast("Mismatch", "Passwords do not match.", "danger");
                return;
            }

            // Create pending account awaiting admin approval
            const newUser = {
                email: currentAuthenticatingEmail,
                password: sha256Sync(password),
                displayName: name,
                status: "pending",
                role: "student",
                dateRegistered: new Date().toLocaleDateString(),
                questions: [],
                tests: [],
                notebookNotes: [],
                flashcards: [],
                reportTaskProgress: {},
                lastUpdated: Date.now()
            };
            state.users.push(newUser);
            
            // Sync registry with cloud so admin can see and approve the user immediately
            syncUsersWithCloud();

            showToast("طلب التسجيل قيد الانتظار", "تم إرسال طلب تسجيلك بنجاح وهو الآن في انتظار موافقة المشرف.", "info");
            showAuthStep("auth-pending-step");
            document.getElementById("pending-email-display").innerText = currentAuthenticatingEmail;
        });
    }

    // Checking status on pending page
    if (btnCheckStatus) {
        btnCheckStatus.addEventListener("click", async () => {
            // Load latest approvals from cloud
            await syncUsersWithCloud();

            const user = state.users.find(u => u.email === currentAuthenticatingEmail);
            if (user && user.status === "approved") {
                showToast("Approved!", "Your registration request has been approved by the Admin.", "success");
                showAuthStep("auth-password-step");
                document.getElementById("login-email-display").innerText = currentAuthenticatingEmail;
                passwordLoginInput.value = "";
                passwordLoginInput.focus();
            } else {
                showToast("Still Pending", "Your request is still awaiting admin approval.", "info");
            }
        });
    }

    // Back Buttons
    if (backToEmail1) backToEmail1.addEventListener("click", () => showAuthStep("auth-email-step"));
    if (backToEmail2) backToEmail2.addEventListener("click", () => showAuthStep("auth-email-step"));
    if (backToEmail3) backToEmail3.addEventListener("click", () => showAuthStep("auth-email-step"));

    // Landing Page CTA Triggers
    const btnLandingLogin = document.getElementById("btn-landing-login");
    const btnLandingRegister = document.getElementById("btn-landing-register");
    const btnAuthBackLanding = document.getElementById("btn-auth-back-landing");
    const btnLandingBackSelector = document.getElementById("btn-landing-back-selector");

    if (btnLandingLogin) {
        btnLandingLogin.addEventListener("click", () => {
            showAuthOverlay();
        });
    }

    if (btnLandingRegister) {
        btnLandingRegister.addEventListener("click", () => {
            showAuthOverlay();
        });
    }

    if (btnAuthBackLanding) {
        btnAuthBackLanding.addEventListener("click", () => {
            showLandingPage();
        });
    }

    if (btnLandingBackSelector) {
        btnLandingBackSelector.addEventListener("click", () => {
            switchCourseTrack();
        });
    }

    // Logout
    if (btnLogout) {
        btnLogout.addEventListener("click", () => {
            showToast("Logged Out", "You have successfully logged out.", "info");
            
            // Save state before clearing user session
            saveStateToStorage();

            const currentTrack = state.activeGroup || "infection";

            // Clear user session for the current group while keeping the course track isolated
            const activeGroupKey = state.activeGroup ? getGroupKey(STORAGE_KEYS.CURRENT_USER) : null;
            state.currentUser = null;
            if (activeGroupKey) {
                encryptLocal(activeGroupKey, null);
            }
            localStorage.removeItem(`hawari_jwt_${currentTrack}`);
            localStorage.removeItem("hawari_jwt_token");

            // Reset auth input fields
            if (emailInput) emailInput.value = "";
            if (passwordLoginInput) passwordLoginInput.value = "";
            if (passwordRegInput) passwordRegInput.value = "";
            if (passwordRegConfirmInput) passwordRegConfirmInput.value = "";
            showAuthStep("auth-email-step");

            // Return to this specific course's landing page (e.g. Welcome to Hawari Infection)
            showLandingPage();
            window.location.hash = `#${currentTrack}`;
        });
    }
}

function showAuthStep(stepId) {
    document.querySelectorAll(".auth-step").forEach(step => {
        step.classList.remove("active");
    });
    const targetStep = document.getElementById(stepId);
    if (targetStep) targetStep.classList.add("active");
}

function showLandingPage() {
    const selectorPage = document.getElementById("course-selector-page");
    if (selectorPage) selectorPage.classList.add("hidden");

    const appLayout = document.getElementById("app-layout");
    if (appLayout) appLayout.classList.add("hidden");

    const authOverlay = document.getElementById("auth-overlay");
    if (authOverlay) authOverlay.classList.add("hidden");

    const landingPage = document.getElementById("landing-page");
    if (landingPage) landingPage.classList.remove("hidden");
}

function showAuthOverlay() {
    if (!state.activeGroup) {
        switchCourseTrack();
        return;
    }
    document.getElementById("app-layout").classList.add("hidden");
    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-overlay").classList.remove("hidden");
    showAuthStep("auth-email-step");
}

function enterWorkspace() {
    if (!state.activeGroup) {
        switchCourseTrack();
        return;
    }
    // Load progress for this specific logged-in user
    loadUserSpecificProgress(state.currentUser.email);

    // Check if reload happened during active quiz session (Anti-cheat)
    const activeQuizSession = localStorage.getItem("active_quiz_session");
    if (activeQuizSession) {
        submitQuizCheatZero(activeQuizSession, state.currentUser.email);
    }

    document.getElementById("landing-page").classList.add("hidden");
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("app-layout").classList.remove("hidden");
    
    // Set Profile UI elements
    document.getElementById("user-display-name").innerText = state.currentUser.email;
    document.getElementById("welcome-user-name").innerText = state.currentUser.email.split("@")[0];
    
    // Set roles
    const roleBadge = document.getElementById("current-user-role");
    const adminNav = document.getElementById("nav-admin-panel");
    
    if (state.currentUser.role === "admin") {
        roleBadge.innerText = "Admin";
        roleBadge.style.backgroundColor = "var(--color-danger-soft)";
        roleBadge.style.color = "var(--color-danger)";
        adminNav.classList.remove("hidden");
    } else {
        roleBadge.innerText = "Student";
        roleBadge.style.backgroundColor = "var(--primary-color-soft)";
        roleBadge.style.color = "var(--primary-color)";
        adminNav.classList.add("hidden");
    }

    // Default route
    if (!window.location.hash) {
        window.location.hash = "#dashboard";
    } else {
        switchView(window.location.hash.substring(1));
    }
}

// ================= VIEW: DASHBOARD =================
let doughnutChart = null;

function renderDashboard() {
    // 1. Gather statistics
    const totalQCount = state.questions.length;
    const incorrectQCount = state.questions.filter(q => q.status === "incorrect").length;
    const markedQCount = state.questions.filter(q => q.marked === true).length;
    const unusedQCount = state.questions.filter(q => q.status === "unused").length;
    const correctQCount = state.questions.filter(q => q.status === "correct").length;
    
    document.getElementById("stat-correct-questions").innerText = correctQCount;
    document.getElementById("stat-incorrect-questions").innerText = incorrectQCount;
    document.getElementById("stat-marked-questions").innerText = markedQCount;
    document.getElementById("stat-unused-questions").innerText = unusedQCount;

    // Completed tests
    const completedTests = state.tests.filter(t => t.isCompleted);
    document.getElementById("stat-total-tests").innerText = completedTests.length;
    
    // Average score calculation
    let avgScore = 0;
    if (completedTests.length > 0) {
        const sum = completedTests.reduce((acc, curr) => acc + curr.score, 0);
        avgScore = Math.round(sum / completedTests.length);
    }
    document.getElementById("stat-avg-score").innerText = `${avgScore}%`;
    document.getElementById("stat-total-notes").innerText = state.notebookNotes.length;

    // 2. Render doughnut chart
    const ctx = document.getElementById("progress-doughnut-chart");
    if (ctx) {
        if (doughnutChart) {
            doughnutChart.destroy();
        }
        
        // Check if all zero
        const datasetsData = [correctQCount, incorrectQCount, unusedQCount];
        const isAllZero = datasetsData.every(v => v === 0);
        
        const chartData = {
            labels: ["Correct", "Incorrect", "Unused"],
            datasets: [{
                data: isAllZero ? [0, 0, 1] : datasetsData,
                backgroundColor: isAllZero ? ["#cbd5e1"] : ["#10b981", "#ef4444", "#3b82f6"],
                borderWidth: 0,
                hoverOffset: 4
            }]
        };

        doughnutChart = new Chart(ctx, {
            type: 'doughnut',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                cutout: "75%"
            }
        });
    }

    // 3. Render legend summary details
    const legendContainer = document.getElementById("chart-legend-details");
    if (legendContainer) {
        legendContainer.innerHTML = `
            <div class="legend-col">
                <span class="lbl"><span class="dot" style="background-color:#10b981"></span> Correct</span>
                <span class="val text-success">${correctQCount}</span>
            </div>
            <div class="legend-col">
                <span class="lbl"><span class="dot" style="background-color:#ef4444"></span> Incorrect</span>
                <span class="val text-danger">${incorrectQCount}</span>
            </div>
            <div class="legend-col">
                <span class="lbl"><span class="dot" style="background-color:#3b82f6"></span> Unused</span>
                <span class="val text-primary">${unusedQCount}</span>
            </div>
        `;
    }

    // Update Mock Exams Dashboard Stats
    updateDashboardStats();

    // Render announcements and public leaderboard
    renderAnnouncementWidget();
    renderPublicLeaderboard();

    // Quick Actions
    const btnQuickGen = document.getElementById("btn-quick-generate");
    if (btnQuickGen) {
        btnQuickGen.onclick = () => window.location.hash = "#generate-test";
    }

    // Reset Progress Button
    const btnResetSite = document.getElementById("btn-reset-site");
    if (btnResetSite) {
        btnResetSite.onclick = () => {
            const confirmReset = confirm("Are you sure you want to reset all your progress, test histories, and notes? This action cannot be undone.");
            if (confirmReset) {
                // Clear tests
                state.tests = [];
                // Reset all questions to unused state
                state.questions.forEach(q => {
                    q.status = "unused";
                    q.marked = false;
                    q.notes = "";
                    q.highlightedHtml = "";
                });
                // Clear notepad notes
                state.notebookNotes = [];
                // Save state to storage
                saveStateToStorage();
                
                showToast("Success", "All progress and site data has been reset.", "success");
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        };
    }
}

function renderPublicLeaderboard() {
    const container = document.getElementById("dashboard-leaderboard-container");
    if (!container) return;

    container.innerHTML = "";

    const leaderboardData = [];

    state.users.forEach(user => {
        if (user.status !== "approved") return;

        const solvedPracticeCount = (user.questions || []).filter(q => q.status === "correct" || q.status === "incorrect").length;

        let quizSolvedCount = 0;
        let quizScoreSum = 0;
        state.quizResults.forEach(res => {
            if (res.email === user.email && res.status === "completed") {
                quizSolvedCount++;
                quizScoreSum += res.score;
            }
        });

        let examSolvedCount = 0;
        let examScoreSum = 0;
        if (user.reportTaskProgress) {
            Object.keys(user.reportTaskProgress).forEach(rtId => {
                const progress = user.reportTaskProgress[rtId];
                if (progress && progress.completed) {
                    examSolvedCount++;
                    examScoreSum += progress.score || 0;
                }
            });
        }

        const totalSolved = solvedPracticeCount + quizSolvedCount + examSolvedCount;
        const totalGradedCount = quizSolvedCount + examSolvedCount;
        const avgGradedScore = totalGradedCount > 0 
            ? Math.round((quizScoreSum + examScoreSum) / totalGradedCount) 
            : 0;

        const rankScore = totalSolved + (avgGradedScore * 10);

        leaderboardData.push({
            email: user.email,
            displayName: user.displayName || "",
            totalSolved: totalSolved,
            avgScore: avgGradedScore,
            rankScore: rankScore
        });
    });

    leaderboardData.sort((a, b) => b.rankScore - a.rankScore);

    const activeList = leaderboardData.filter(item => item.totalSolved > 0);

    if (activeList.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                <i class="fa-solid fa-trophy" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5;"></i>
                <p style="margin: 0; font-size: 0.9rem;">No leaderboard records found yet.</p>
            </div>
        `;
        return;
    }

    activeList.slice(0, 5).forEach((item, index) => {
        const div = document.createElement("div");
        div.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color);";

        let nameToShow = item.displayName;
        if (!nameToShow) {
            const parts = item.email.split("@");
            const first = parts[0];
            if (first.length > 3) {
                nameToShow = first.substring(0, 3) + "***@" + parts[1];
            } else {
                nameToShow = first + "***@" + parts[1];
            }
        }

        let rankBadge = "";
        if (index === 0) {
            rankBadge = `<span style="width:24px; height:24px; border-radius:50%; background:linear-gradient(135deg, #fcd34d, #f59e0b); color:#ffffff; font-weight:800; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem;"><i class="fa-solid fa-crown"></i></span>`;
        } else if (index === 1) {
            rankBadge = `<span style="width:24px; height:24px; border-radius:50%; background:linear-gradient(135deg, #e2e8f0, #cbd5e1); color:#475569; font-weight:800; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem;">2</span>`;
        } else if (index === 2) {
            rankBadge = `<span style="width:24px; height:24px; border-radius:50%; background:linear-gradient(135deg, #ffedd5, #fdba74); color:#c2410c; font-weight:800; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem;">3</span>`;
        } else {
            rankBadge = `<span style="width:24px; height:24px; border-radius:50%; border:1px solid var(--border-color); color:var(--text-muted); font-weight:800; display:inline-flex; align-items:center; justify-content:center; font-size:0.8rem;">${index + 1}</span>`;
        }

        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                ${rankBadge}
                <span style="font-weight:600; color: var(--text-primary); font-size: 0.95rem;">${nameToShow}</span>
            </div>
            <div style="display: flex; gap: 15px; font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">
                <span>Solved: <strong style="color:var(--primary-color);">${item.totalSolved}</strong></span>
                <span>Avg: <strong style="color:var(--color-success);">${item.avgScore}%</strong></span>
            </div>
        `;
        container.appendChild(div);
    });
}

window.downloadStudentNotes = function() {
    if (!state.notebookNotes || state.notebookNotes.length === 0) {
        showToast("No Notes", "لديك قائمة مفكرة فارغة. لا توجد ملاحظات لتحميلها.", "warning");
        return;
    }

    let content = `# Hawari Course Platform - Notebook Export\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;
    content += `Student Email: ${state.currentUser ? state.currentUser.email : "N/A"}\n`;
    content += `Course Track: ${state.activeGroup === "infection" ? "Hawari Infection" : "Hawari Dermatology"}\n`;
    content += `==================================================\n\n`;

    state.notebookNotes.forEach((note, index) => {
        const cleanTitle = (note.title || "Untitled Note").replace(/[<>"]/g, "");
        const cleanBody = (note.content || "").replace(/<[^>]*>/g, ""); // strip HTML tags securely

        content += `Note #${index + 1}: ${cleanTitle}\n`;
        if (note.lastSaved) {
            content += `Last Updated: ${new Date(note.lastSaved).toLocaleString()}\n`;
        }
        content += `--------------------------------------------------\n`;
        content += `${cleanBody}\n`;
        content += `==================================================\n\n`;
    });

    try {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement("a");
        a.href = url;
        a.download = `hawari_notebook_notes_${state.activeGroup}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast("Success", "Notebook notes downloaded successfully.", "success");
    } catch (e) {
        console.error("Failed to download notebook notes:", e);
        showToast("Error", "Failed to compile notebook download.", "danger");
    }
};

// ================= VIEW: GENERATE TEST =================
let selectedSource = "Past Exam";

function renderGenerateTest() {
    // Set question counts in buttons
    const pastExamQCount = state.questions.filter(q => q.source === "Past Exam").length;
    const collegeMCQQCount = state.questions.filter(q => q.source === "College MCQ").length;
    
    document.getElementById("badge-count-past-exam").innerText = `${pastExamQCount} Qs`;
    document.getElementById("badge-count-college-mcq").innerText = `${collegeMCQQCount} Qs`;

    const sourceCards = document.querySelectorAll(".source-card");
    sourceCards.forEach(card => {
        card.onclick = () => {
            sourceCards.forEach(c => c.classList.remove("active"));
            card.classList.add("active");
            selectedSource = card.getAttribute("data-source");
            populateTopicsList();
            updateMatchingQuestionsCount();
        };
    });

    // Populate topics matching selectedSource
    populateTopicsList();

    // Mode Toggle selection
    const modeOptions = document.querySelectorAll(".mode-option");
    const timerWrapper = document.getElementById("custom-timer-wrapper");
    modeOptions.forEach(opt => {
        opt.onclick = () => {
            modeOptions.forEach(o => o.classList.remove("active"));
            opt.classList.add("active");
            
            const mode = opt.getAttribute("data-mode");
            if (mode === "timed") {
                timerWrapper.classList.remove("hidden");
            } else {
                timerWrapper.classList.add("hidden");
            }
            
            updateMatchingQuestionsCount();
        };
    });

    // Input changes listener
    document.getElementById("question-pool").onchange = updateMatchingQuestionsCount;
    document.getElementById("question-count").onchange = updateMatchingQuestionsCount;

    // Start Quiz Action
    document.getElementById("btn-start-test").onclick = startPracticeQuiz;
}

function populateTopicsList() {
    const container = document.getElementById("topics-checkbox-container");
    if (!container) return;

    // Filter questions by selected source and collect unique topics
    const sourceQs = state.questions.filter(q => q.source === selectedSource);
    const uniqueTopics = [...new Set(sourceQs.map(q => q.topic))];

    container.innerHTML = "";
    
    if (uniqueTopics.length === 0) {
        container.innerHTML = `<span class="text-muted" style="font-size:0.85rem">No topics found for this source.</span>`;
        return;
    }

    uniqueTopics.forEach(topic => {
        const item = document.createElement("label");
        item.className = "topic-checkbox-item";
        item.innerHTML = `
            <input type="checkbox" class="topic-chk" value="${topic}" checked>
            <span>${topic}</span>
        `;
        // Recalculate count on change
        item.querySelector("input").onchange = updateMatchingQuestionsCount;
        container.appendChild(item);
    });
    
    updateMatchingQuestionsCount();
}

function getSelectedTopics() {
    const checkboxes = document.querySelectorAll(".topic-chk:checked");
    return Array.from(checkboxes).map(chk => chk.value);
}

function getFilteredQuestions() {
    const pool = document.getElementById("question-pool").value;
    const selectedTopics = getSelectedTopics();
    
    return state.questions.filter(q => {
        // Source match
        if (q.source !== selectedSource) return false;
        
        // Topic match
        if (!selectedTopics.includes(q.topic)) return false;
        
        // Pool status match
        if (pool === "unused" && q.status !== "unused") return false;
        if (pool === "incorrect" && q.status !== "incorrect") return false;
        if (pool === "marked" && q.marked !== true) return false;
        
        return true;
    });
}

function updateMatchingQuestionsCount() {
    const filtered = getFilteredQuestions();
    const countDisplay = document.getElementById("matching-qs-count");
    if (countDisplay) {
        countDisplay.innerText = filtered.length;
    }
}

function startPracticeQuiz() {
    const filtered = getFilteredQuestions();
    if (filtered.length === 0) {
        showToast("No Questions", "No questions matched your selected criteria.", "warning");
        return;
    }

    const testNameInput = document.getElementById("test-name");
    const testName = testNameInput.value.trim() || `Test #${state.tests.length + 1}`;
    
    const countSelect = document.getElementById("question-count").value;
    let limit = countSelect === "all" ? filtered.length : parseInt(countSelect);
    limit = Math.min(limit, filtered.length);

    // Shuffle questions to select random slice
    const shuffled = [...filtered].sort(() => 0.5 - Math.random());
    const selectedQs = shuffled.slice(0, limit);

    // Check mode
    const activeModeOption = document.querySelector(".mode-option.active");
    const mode = activeModeOption.getAttribute("data-mode"); // "tutor" or "timed"

    // Custom Time Settings
    let timeInSecs = selectedQs.length * 60;
    if (mode === "timed") {
        const customMin = parseInt(document.getElementById("test-time-limit").value);
        if (!isNaN(customMin) && customMin > 0) {
            timeInSecs = customMin * 60;
        }
    }

    // Create practice test object
    const testId = "test_" + Date.now();
    const newTest = {
        id: testId,
        name: testName,
        date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        questionIds: selectedQs.map(q => q.id),
        answers: {}, // Maps qId: selectedOption
        flaggedQuestions: [], // List of flagged qIds inside this test
        score: 0,
        mode: mode,
        isCompleted: false,
        timeRemaining: timeInSecs
    };

    state.tests.push(newTest);
    saveStateToStorage();

    // Reset input fields
    testNameInput.value = "";
    
    // Launch active test screen
    launchActiveTestScreen(newTest);
}

// ================= VIEW: ACTIVE TEST SCREEN =================
let testTimerInterval = null;

function launchActiveTestScreen(testObj) {
    state.activeTest = {
        testId: testObj.id,
        currentQuestionIdx: 0,
        selectedAnswers: { ...testObj.answers },
        flaggedQuestions: new Set(testObj.flaggedQuestions),
        questionIds: [...testObj.questionIds],
        mode: testObj.mode,
        timeRemaining: testObj.timeRemaining
    };

    // Show Fullscreen modal
    document.getElementById("active-test-overlay").classList.remove("hidden");
    document.body.style.overflow = "hidden"; // Disable background scrolling

    // UI headers
    document.getElementById("active-test-title-lbl").innerText = testObj.name;
    document.getElementById("active-test-mode-lbl").innerText = `${testObj.mode} Mode`;
    if (testObj.mode === "tutor") {
        document.getElementById("active-test-mode-lbl").style.backgroundColor = "var(--primary-color-soft)";
        document.getElementById("active-test-mode-lbl").style.color = "var(--primary-color)";
    } else {
        document.getElementById("active-test-mode-lbl").style.backgroundColor = "var(--color-warning-soft)";
        document.getElementById("active-test-mode-lbl").style.color = "var(--color-warning)";
    }

    // Set controls
    initTestControls();
    
    // Load first question
    loadTestQuestion(0);

    // Setup timer
    const timerText = document.getElementById("test-timer-text");
    const timerWrapper = document.getElementById("test-timer-wrapper");
    
    if (testObj.mode === "timed") {
        timerWrapper.classList.remove("hidden");
        updateTimerText(state.activeTest.timeRemaining);
        
        if (testTimerInterval) clearInterval(testTimerInterval);
        testTimerInterval = setInterval(() => {
            state.activeTest.timeRemaining--;
            updateTimerText(state.activeTest.timeRemaining);
            
            if (state.activeTest.timeRemaining <= 0) {
                clearInterval(testTimerInterval);
                showToast("Time's Up!", "Your test timer has expired. Submitting the test automatically.", "warning");
                submitActiveTest();
            }
        }, 1000);
    } else {
        // Tutor mode timer acts as count-up timer or we just hide it
        timerWrapper.classList.add("hidden");
    }
}

function updateTimerText(sec) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    
    const display = 
        (hrs < 10 ? "0" + hrs : hrs) + ":" + 
        (mins < 10 ? "0" + mins : mins) + ":" + 
        (secs < 10 ? "0" + secs : secs);
        
    document.getElementById("test-timer-text").innerText = display;
}

function initTestControls() {
    // Toggle notes sidebar visibility for Mock Exams
    const notesSidebar = document.getElementById("test-notes-sidebar");
    const testInterfaceBody = document.getElementById("test-interface-body");
    if (notesSidebar && testInterfaceBody) {
        if (state.activeTest && state.activeTest.isReportTask) {
            notesSidebar.classList.add("hidden");
            testInterfaceBody.classList.add("no-notes-sidebar");
        } else {
            notesSidebar.classList.remove("hidden");
            testInterfaceBody.classList.remove("no-notes-sidebar");
        }
    }

    // Questions Sidebar toggler
    const btnToggleQuestions = document.getElementById("btn-toggle-test-questions-sidebar");
    if (btnToggleQuestions && testInterfaceBody) {
        testInterfaceBody.classList.remove("hide-left-sidebar");
        btnToggleQuestions.classList.remove("active");
        btnToggleQuestions.onclick = () => {
            testInterfaceBody.classList.toggle("hide-left-sidebar");
            if (testInterfaceBody.classList.contains("hide-left-sidebar")) {
                btnToggleQuestions.classList.add("active");
            } else {
                btnToggleQuestions.classList.remove("active");
            }
        };
    }

    // Highlighter mode toggler
    const btnHighlighter = document.getElementById("btn-test-highlighter");
    let highlighterActive = false;
    
    btnHighlighter.classList.remove("active");
    btnHighlighter.onclick = () => {
        highlighterActive = !highlighterActive;
        if (highlighterActive) {
            btnHighlighter.classList.add("active");
            showToast("Highlighter Enabled", "Select any text in the question card to apply yellow highlight.", "info");
        } else {
            btnHighlighter.classList.remove("active");
        }
    };

    // Handle mouseup selection inside the question prompt for highlighting
    const promptCard = document.getElementById("active-question-prompt");
    promptCard.onmouseup = () => {
        if (!highlighterActive) return;
        
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;
        
        const range = selection.getRangeAt(0);
        
        // Ensure range is inside promptCard
        let parent = range.commonAncestorContainer;
        if (parent.nodeType === 3) parent = parent.parentNode;
        
        if (promptCard.contains(parent)) {
            const span = document.createElement("span");
            span.className = "text-highlight";
            try {
                range.surroundContents(span);
                
                // Save highlighted HTML to active question object in state
                const activeQId = state.activeTest.questionIds[state.activeTest.currentQuestionIdx];
                const stateQ = (state.activeTest.isReportTask && state.activeTest.rtQuestions) ?
                               state.activeTest.rtQuestions.find(q => q.id === activeQId) :
                               state.questions.find(q => q.id === activeQId);
                if (stateQ) {
                    stateQ.highlightedHtml = promptCard.innerHTML;
                    saveStateToStorage();
                }
            } catch (err) {
                console.log("Highlighter cannot span complex HTML boundaries.");
            }
            selection.removeAllRanges();
        }
    };

    // Flag active question
    const btnFlag = document.getElementById("btn-flag-active-question");
    btnFlag.onclick = () => {
        const qId = state.activeTest.questionIds[state.activeTest.currentQuestionIdx];
        const stateQ = (state.activeTest.isReportTask && state.activeTest.rtQuestions) ?
                       state.activeTest.rtQuestions.find(q => q.id === qId) :
                       state.questions.find(q => q.id === qId);
        
        if (state.activeTest.flaggedQuestions.has(qId)) {
            state.activeTest.flaggedQuestions.delete(qId);
            if (stateQ) stateQ.marked = false;
            btnFlag.classList.remove("flagged");
            btnFlag.innerHTML = `<i class="fa-regular fa-flag"></i> Flag Question`;
        } else {
            state.activeTest.flaggedQuestions.add(qId);
            if (stateQ) stateQ.marked = true;
            btnFlag.classList.add("flagged");
            btnFlag.innerHTML = `<i class="fa-solid fa-flag"></i> Flagged`;
        }
        
        saveStateToStorage();
        renderTestQuestionGrid();
    };

    // Notepad text area auto-save on input
    const notepadInput = document.getElementById("question-notepad-input");
    const notepadStatus = document.getElementById("lbl-notepad-status");
    let debounceSaveTimeout = null;

    notepadInput.oninput = () => {
        notepadStatus.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin"></i> Saving...`;
        
        if (debounceSaveTimeout) clearTimeout(debounceSaveTimeout);
        debounceSaveTimeout = setTimeout(() => {
            const qId = state.activeTest.questionIds[state.activeTest.currentQuestionIdx];
            const content = notepadInput.value.trim();
            
            // 1. Update question notes
            const stateQ = (state.activeTest.isReportTask && state.activeTest.rtQuestions) ?
                           state.activeTest.rtQuestions.find(q => q.id === qId) :
                           state.questions.find(q => q.id === qId);
            if (stateQ) {
                stateQ.notes = content;
            }

            // 2. Synchronize to global Notebook notes (only if not a report task mock exam)
            if (!state.activeTest.isReportTask) {
                const testObj = state.tests.find(t => t.id === state.activeTest.testId);
                const noteTitle = `Question #${qId.substring(1)} Note (Test: ${testObj ? testObj.name : "Exam"})`;
                
                let existingNote = state.notebookNotes.find(n => n.qId === qId);
                if (existingNote) {
                    if (content === "") {
                        // Remove if empty
                        state.notebookNotes = state.notebookNotes.filter(n => n.qId !== qId);
                    } else {
                        existingNote.content = sanitizeHTML(content);
                        existingNote.timestamp = new Date().toLocaleDateString();
                    }
                } else if (content !== "") {
                    const newNote = {
                        id: "note_" + Date.now(),
                        title: noteTitle,
                        content: sanitizeHTML(content),
                        timestamp: new Date().toLocaleDateString(),
                        qId: qId,
                        type: "Question Note"
                    };
                    state.notebookNotes.push(newNote);
                }
            }

            saveStateToStorage();
            notepadStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved`;
        }, 800);
    };

    // Submitting test
    document.getElementById("btn-submit-active-test").onclick = () => {
        const unansweredCount = state.activeTest.questionIds.length - Object.keys(state.activeTest.selectedAnswers).length;
        let confirmMsg = "Are you sure you want to submit this test?";
        if (unansweredCount > 0) {
            confirmMsg = `You have ${unansweredCount} unanswered questions. Are you sure you want to submit?`;
        }
        
        if (confirm(confirmMsg)) {
            submitActiveTest();
        }
    };

    // Suspend test (save progress & close)
    document.getElementById("btn-suspend-active-test").onclick = () => {
        suspendActiveTest();
    };
}

function loadTestQuestion(index) {
    state.activeTest.currentQuestionIdx = index;
    
    const qId = state.activeTest.questionIds[index];
    const qObj = (state.activeTest.isReportTask && state.activeTest.rtQuestions) ?
                 state.activeTest.rtQuestions.find(q => q.id === qId) :
                 state.questions.find(q => q.id === qId);
    
    // Update active indicators
    document.getElementById("lbl-question-current-idx").innerText = index + 1;
    document.getElementById("lbl-question-total-count").innerText = state.activeTest.questionIds.length;

    // Render Question prompt text
    const promptCard = document.getElementById("active-question-prompt");
    // If it has saved highlights, restore them. Else use original text.
    promptCard.innerHTML = qObj.highlightedHtml || qObj.text;

    // Set Flag State
    const btnFlag = document.getElementById("btn-flag-active-question");
    if (state.activeTest.flaggedQuestions.has(qId)) {
        btnFlag.classList.add("flagged");
        btnFlag.innerHTML = `<i class="fa-solid fa-flag"></i> Flagged`;
    } else {
        btnFlag.classList.remove("flagged");
        btnFlag.innerHTML = `<i class="fa-regular fa-flag"></i> Flag Question`;
    }

    // Load question specific notes in textarea
    document.getElementById("question-notepad-input").value = qObj.notes || "";
    document.getElementById("lbl-notepad-status").innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved`;

    // Render Option Choices
    const choicesList = document.getElementById("active-question-choices");
    choicesList.innerHTML = "";

    const savedAns = state.activeTest.selectedAnswers[qId];
    
    // Check if answered (tutor explanation block shows if in Tutor Mode and selected)
    const isAnswered = savedAns !== undefined;
    const explanationPanel = document.getElementById("active-question-explanation");
    
    if (isAnswered && state.activeTest.mode === "tutor") {
        explanationPanel.classList.remove("hidden");
        document.getElementById("lbl-explanation-text").innerText = qObj.explanation;
    } else {
        explanationPanel.classList.add("hidden");
    }

    Object.entries(qObj.options).forEach(([letter, val]) => {
        const choiceBtn = document.createElement("button");
        choiceBtn.className = "choice-btn";
        
        let displayClass = "";
        
        if (isAnswered) {
            if (state.activeTest.mode === "tutor" || state.activeTest.isCompletedReview) {
                // Tutor Mode immediate styling
                if (letter === qObj.correctOption) {
                    displayClass = "correct-choice";
                } else if (letter === savedAns) {
                    displayClass = "incorrect-choice";
                }
            } else {
                // Timed mode selection styling (simple blue indicator)
                if (letter === savedAns) {
                    displayClass = "selected";
                }
            }
        } else if (state.activeTest.isCompletedReview && letter === qObj.correctOption) {
            // Show correct answer even if not answered during review
            displayClass = "correct-choice";
        }

        if (displayClass) choiceBtn.classList.add(displayClass);

        choiceBtn.innerHTML = `
            <span class="choice-letter">${letter}</span>
            <span class="choice-text">${val}</span>
        `;

        choiceBtn.onclick = () => {
            // Lock options in review mode
            if (state.activeTest.isCompletedReview) return;
            // If already answered in tutor mode, locked.
            if (state.activeTest.mode === "tutor" && state.activeTest.selectedAnswers[qId]) return;
            
            selectQuestionAnswer(qId, letter);
        };

        choicesList.appendChild(choiceBtn);
    });

    // Previous/Next buttons setup
    const btnPrev = document.getElementById("btn-prev-question");
    const btnNext = document.getElementById("btn-next-question");
    const totalQs = state.activeTest.questionIds.length;

    if (btnPrev && btnNext) {
        // Previous Button
        if (index === 0) {
            btnPrev.setAttribute("disabled", "true");
            btnPrev.style.opacity = "0.5";
            btnPrev.style.cursor = "not-allowed";
        } else {
            btnPrev.removeAttribute("disabled");
            btnPrev.style.opacity = "1";
            btnPrev.style.cursor = "pointer";
        }
        btnPrev.onclick = () => {
            if (index > 0) {
                loadTestQuestion(index - 1);
            }
        };

        // Next Button
        if (index === totalQs - 1) {
            btnNext.setAttribute("disabled", "true");
            btnNext.style.opacity = "0.5";
            btnNext.style.cursor = "not-allowed";
        } else {
            btnNext.removeAttribute("disabled");
            btnNext.style.opacity = "1";
            btnNext.style.cursor = "pointer";
        }
        btnNext.onclick = () => {
            if (index < totalQs - 1) {
                loadTestQuestion(index + 1);
            }
        };
    }

    renderTestQuestionGrid();
}

function renderTestQuestionGrid() {
    const grid = document.getElementById("test-questions-grid");
    if (!grid) return;

    grid.innerHTML = "";
    
    state.activeTest.questionIds.forEach((qId, idx) => {
        const navBtn = document.createElement("button");
        navBtn.className = "test-nav-btn";
        navBtn.innerText = idx + 1;

        // Current status
        if (state.activeTest.currentQuestionIdx === idx) {
            navBtn.classList.add("current");
        } else if (state.activeTest.selectedAnswers[qId] !== undefined) {
            navBtn.classList.add("answered");
        }

        // Flag status
        if (state.activeTest.flaggedQuestions.has(qId)) {
            navBtn.classList.add("flagged");
        }

        navBtn.onclick = () => {
            loadTestQuestion(idx);
        };

        grid.appendChild(navBtn);
    });
}

function selectQuestionAnswer(qId, option) {
    state.activeTest.selectedAnswers[qId] = option;
    
    // Save to local storage
    if (state.activeTest.isReportTask) {
        const rtId = state.activeTest.rtId;
        const userRecord = state.users.find(u => u.email === state.currentUser.email);
        if (userRecord && userRecord.reportTaskProgress && userRecord.reportTaskProgress[rtId]) {
            userRecord.reportTaskProgress[rtId].answers = { ...state.activeTest.selectedAnswers };
        }
        saveStateToStorage();
    } else {
        const testObj = state.tests.find(t => t.id === state.activeTest.testId);
        if (testObj) {
            testObj.answers = { ...state.activeTest.selectedAnswers };
            saveStateToStorage();
        }
    }

    // Refresh display
    loadTestQuestion(state.activeTest.currentQuestionIdx);
}

async function submitActiveTest() {
    if (testTimerInterval) clearInterval(testTimerInterval);
    
    const activeTest = state.activeTest;
    if (!activeTest) return;

    const group = state.activeGroup || "infection";
    const userEmail = (state.currentUser && state.currentUser.email) ? state.currentUser.email : "";

    // 1. Submit answers to Server-Side Grading RPC
    let gradeData = null;
    try {
        const gradeRes = await supabaseRequest(`rpc/submit_and_grade_exam`, {
            method: "POST",
            body: JSON.stringify({
                p_group: group,
                p_exam_id: activeTest.isReportTask ? activeTest.rtId : activeTest.testId,
                p_answers: activeTest.selectedAnswers || {},
                p_email: userEmail
            })
        });
        if (gradeRes && (gradeRes.success || gradeRes.score !== undefined)) {
            gradeData = gradeRes;
        }
    } catch (e) {
        console.warn("[Grading] Server-side grading fallback:", e);
    }

    if (activeTest.isReportTask) {
        const rtId = activeTest.rtId;
        const rtQuestions = activeTest.rtQuestions || [];
        
        let score = 0;
        if (gradeData && gradeData.score !== undefined) {
            score = gradeData.score;
            if (Array.isArray(gradeData.results)) {
                gradeData.results.forEach(res => {
                    const q = rtQuestions.find(rq => rq.id === res.questionId);
                    if (q) {
                        q.correctOption = res.correctOption;
                        q.explanation = res.explanation;
                    }
                });
            }
        } else {
            let correctCount = 0;
            rtQuestions.forEach(q => {
                const userAns = activeTest.selectedAnswers[q.id];
                if (q.correctOption && userAns === q.correctOption) {
                    correctCount++;
                }
            });
            score = rtQuestions.length > 0 ? Math.round((correctCount / rtQuestions.length) * 100) : 0;
        }
        
        // Save to user progress record
        const userRecord = state.users.find(u => u.email === userEmail);
        if (userRecord) {
            if (!userRecord.reportTaskProgress) userRecord.reportTaskProgress = {};
            userRecord.reportTaskProgress[rtId] = {
                answers: { ...activeTest.selectedAnswers },
                flaggedQuestions: Array.from(activeTest.flaggedQuestions),
                timeSpent: activeTest.rtDuration * 60 - activeTest.timeRemaining,
                score: score,
                completed: true
            };
        }
        
        state.activeTest = null;
        saveStateToStorage();
        syncUsersWithCloud().catch(err => console.warn("[Sync] Test submit cloud sync deferred:", err));
        
        document.getElementById("active-test-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";
        
        showToast("Mock Exam Submitted", `You finished the exam with a score of ${score}%!`, "success");
        
        updateDashboardStats();
        window.location.hash = "#report-task";
        renderReportTaskStudentView();
        return;
    }
    
    const testObj = state.tests.find(t => t.id === activeTest.testId);
    if (testObj) {
        let score = 0;
        if (gradeData && gradeData.score !== undefined) {
            score = gradeData.score;
            if (Array.isArray(gradeData.results)) {
                gradeData.results.forEach(res => {
                    const qObj = state.questions.find(q => q.id === res.questionId);
                    if (qObj) {
                        qObj.correctOption = res.correctOption;
                        qObj.explanation = res.explanation;
                        qObj.status = res.isCorrect ? "correct" : (res.userAns ? "incorrect" : "unused");
                    }
                });
            }
        } else {
            let correctCount = 0;
            testObj.questionIds.forEach(qId => {
                const qObj = state.questions.find(q => q.id === qId);
                const userAns = activeTest.selectedAnswers[qId];
                if (qObj && qObj.correctOption) {
                    if (userAns === qObj.correctOption) {
                        correctCount++;
                        qObj.status = "correct";
                    } else if (userAns !== undefined) {
                        qObj.status = "incorrect";
                    } else {
                        qObj.status = "unused";
                    }
                }
            });
            score = testObj.questionIds.length > 0 ? Math.round((correctCount / testObj.questionIds.length) * 100) : 0;
        }

        testObj.score = score;
        testObj.answers = { ...activeTest.selectedAnswers };
        testObj.flaggedQuestions = Array.from(activeTest.flaggedQuestions);
        testObj.isCompleted = true;
        testObj.timeRemaining = activeTest.timeRemaining;

        state.activeTest = null;
        saveStateToStorage();
        syncUsersWithCloud().catch(err => console.warn("[Sync] Test submit cloud sync deferred:", err));

        document.getElementById("active-test-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";

        showToast("Test Submitted", `You finished "${testObj.name}" with a score of ${testObj.score}%!`, "success");
        
        window.location.hash = "#my-tests";
    }
}

function suspendActiveTest() {
    if (testTimerInterval) clearInterval(testTimerInterval);
    
    if (state.activeTest.isReportTask) {
        const rtId = state.activeTest.rtId;
        
        // Save progress in user progress record
        const userRecord = state.users.find(u => u.email === state.currentUser.email);
        if (userRecord) {
            if (!userRecord.reportTaskProgress) userRecord.reportTaskProgress = {};
            userRecord.reportTaskProgress[rtId] = {
                answers: { ...state.activeTest.selectedAnswers },
                flaggedQuestions: Array.from(state.activeTest.flaggedQuestions),
                timeRemaining: state.activeTest.timeRemaining,
                rtDuration: state.activeTest.rtDuration,
                completed: false
            };
        }
        
        state.activeTest = null;
        saveStateToStorage();
        
        document.getElementById("active-test-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";
        
        showToast("Exam Suspended", "Your progress on this mock exam has been saved. You can resume it anytime.", "info");
        
        updateDashboardStats();
        window.location.hash = "#report-task";
        renderReportTaskStudentView();
        return;
    }
    
    const testObj = state.tests.find(t => t.id === state.activeTest.testId);
    if (testObj) {
        testObj.answers = { ...state.activeTest.selectedAnswers };
        testObj.flaggedQuestions = Array.from(state.activeTest.flaggedQuestions);
        testObj.timeRemaining = state.activeTest.timeRemaining;
        testObj.isCompleted = false; // Remains incomplete for resume

        state.activeTest = null;
        saveStateToStorage();

        document.getElementById("active-test-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";

        showToast("Test Suspended", `Practice test "${testObj.name}" has been paused. Resume it anytime under My Tests.`, "info");
        window.location.hash = "#my-tests";
    }
}

// ================= VIEW: MY TESTS HISTORY =================
function renderMyTests() {
    const tableBody = document.getElementById("my-tests-table-body");
    const noTestsAlert = document.getElementById("no-tests-alert");
    
    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (state.tests.length === 0) {
        noTestsAlert.classList.remove("hidden");
        return;
    } else {
        noTestsAlert.classList.add("hidden");
    }

    // Sort by date/timestamp descending
    const sortedTests = [...state.tests].reverse();

    sortedTests.forEach(test => {
        const tr = document.createElement("tr");
        
        let scoreLabel = "";
        let actionBtn = "";
        
        if (test.isCompleted) {
            scoreLabel = `<span class="badge ${test.score >= 70 ? 'badge-success' : 'badge-warning'}">${test.score}%</span>`;
            actionBtn = `<button class="btn btn-secondary btn-sm" onclick="reviewCompletedTest('${test.id}')"><i class="fa-solid fa-magnifying-glass"></i> Review</button>`;
        } else {
            scoreLabel = `<span class="badge" style="background-color:var(--primary-color-soft);color:var(--primary-color)">Suspended</span>`;
            actionBtn = `<button class="btn btn-primary btn-sm" onclick="resumePracticeTest('${test.id}')"><i class="fa-solid fa-play"></i> Resume</button>`;
        }

        // Questions Answered metrics
        const answeredQs = Object.keys(test.answers).length;
        const totalQs = test.questionIds.length;
        const progressPercent = Math.round((answeredQs / totalQs) * 100);

        tr.innerHTML = `
            <td>${test.date}</td>
            <td><strong>${test.name}</strong></td>
            <td style="text-transform: capitalize;">${test.mode}</td>
            <td>${scoreLabel}</td>
            <td>
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:2px">${answeredQs}/${totalQs} solved (${progressPercent}%)</div>
                <div style="width:100px;height:6px;background:var(--border-color);border-radius:3px;overflow:hidden">
                    <div style="width:${progressPercent}%;height:100%;background:var(--primary-color)"></div>
                </div>
            </td>
            <td class="text-right">
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    ${actionBtn}
                    <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem" onclick="deletePracticeTest('${test.id}')" title="Delete test log & recycle questions">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// Global scope window methods for table action calls
window.resumePracticeTest = function(testId) {
    const test = state.tests.find(t => t.id === testId);
    if (test) {
        launchActiveTestScreen(test);
    }
};

window.reviewCompletedTest = function(testId) {
    const test = state.tests.find(t => t.id === testId);
    if (test) {
        // We open the test overlay in complete mode. Locked questions, answers visible.
        state.activeTest = {
            testId: test.id,
            currentQuestionIdx: 0,
            selectedAnswers: { ...test.answers },
            flaggedQuestions: new Set(test.flaggedQuestions),
            questionIds: [...test.questionIds],
            mode: "tutor", // Force tutor display (explanations visible)
            timeRemaining: test.timeRemaining,
            isCompletedReview: true
        };

        document.getElementById("active-test-overlay").classList.remove("hidden");
        document.body.style.overflow = "hidden";
        
        document.getElementById("active-test-title-lbl").innerText = `${test.name} (Review)`;
        document.getElementById("active-test-mode-lbl").innerText = "Review Mode";
        document.getElementById("active-test-mode-lbl").style.backgroundColor = "var(--color-success-soft)";
        document.getElementById("active-test-mode-lbl").style.color = "var(--color-success)";

        initTestControls();
        
        // Hide submitting options in review
        document.getElementById("btn-submit-active-test").classList.add("hidden");
        document.getElementById("btn-suspend-active-test").innerHTML = `Exit Review <i class="fa-solid fa-right-from-bracket"></i>`;
        document.getElementById("btn-suspend-active-test").className = "btn btn-secondary";
        
        document.getElementById("btn-suspend-active-test").onclick = () => {
            state.activeTest = null;
            document.getElementById("active-test-overlay").classList.add("hidden");
            document.body.style.overflow = "auto";
            
            // Restore button functions
            document.getElementById("btn-submit-active-test").classList.remove("hidden");
            document.getElementById("btn-suspend-active-test").innerHTML = `Suspend <i class="fa-solid fa-pause"></i>`;
            document.getElementById("btn-suspend-active-test").className = "btn btn-secondary";
            
            renderMyTests();
        };

        // Load first question
        loadTestQuestion(0);
    }
};

window.deletePracticeTest = function(testId) {
    if (confirm("Are you sure you want to delete this test? All questions in this test will return to being unsolved ('Unused'), and stats will be recycled.")) {
        const testIndex = state.tests.findIndex(t => t.id === testId);
        if (testIndex > -1) {
            const testObj = state.tests[testIndex];
            
            // Recyle questions: Set status back to 'unused'
            testObj.questionIds.forEach(qId => {
                const qObj = state.questions.find(q => q.id === qId);
                if (qObj) {
                    qObj.status = "unused";
                    // Keep marks or clear highlights if desired, user said reset unsolved state
                    qObj.highlightedHtml = "";
                }
            });

            // Delete test note mappings as well if desired
            state.notebookNotes = state.notebookNotes.filter(n => !(n.type === "Question Note" && testObj.questionIds.includes(n.qId)));

            // Remove test
            state.tests.splice(testIndex, 1);
            saveStateToStorage();
            
            showToast("Test Deleted", "Practice test deleted. Questions recycled to pool.", "success");
            renderMyTests();
        }
    }
};

// ================= VIEW: NOTEBOOK =================
let activeNoteId = null;

function renderNotebook() {
    const listContainer = document.getElementById("notes-list-container");
    const editorActiveState = document.getElementById("editor-active-state");
    const editorEmptyState = document.getElementById("editor-empty-state");
    const noteTitleInput = document.getElementById("note-title-input");
    const noteBodyArea = document.getElementById("note-editor-textarea");
    const searchInput = document.getElementById("notebook-search");

    if (!listContainer) return;

    // Filters notes based on search query
    const searchQuery = searchInput.value.toLowerCase();
    const filteredNotes = state.notebookNotes.filter(note => 
        note.title.toLowerCase().includes(searchQuery) || 
        note.content.toLowerCase().includes(searchQuery)
    );

    // List rendering
    listContainer.innerHTML = "";
    
    if (filteredNotes.length === 0) {
        listContainer.innerHTML = `<span class="text-muted" style="text-align:center;font-size:0.8rem;margin-top:20px">No notes found.</span>`;
    }

    filteredNotes.forEach(note => {
        const noteItem = document.createElement("div");
        noteItem.className = `note-item ${activeNoteId === note.id ? 'active' : ''}`;
        
        // Strip tags for summary content
        const cleanContent = note.content.replace(/<[^>]*>/g, '');
        
        noteItem.innerHTML = `
            <h4>${note.title || 'Untitled Note'}</h4>
            <p>${cleanContent || 'No content yet...'}</p>
            <div class="note-meta">
                <span class="note-date">${note.timestamp}</span>
                <span class="note-type-badge">${note.type || 'General'}</span>
            </div>
        `;

        noteItem.onclick = () => {
            selectNotebookNote(note.id);
        };

        listContainer.appendChild(noteItem);
    });

    // Handle Editor state visibility
    if (activeNoteId) {
        const activeNote = state.notebookNotes.find(n => n.id === activeNoteId);
        if (activeNote) {
            editorActiveState.classList.add("active");
            editorEmptyState.style.display = "none";
            
            // Set inputs (prevent infinite resetting loops while typing)
            if (document.activeElement !== noteTitleInput) {
                noteTitleInput.value = activeNote.title;
            }
            if (document.activeElement !== noteBodyArea) {
                noteBodyArea.innerHTML = activeNote.content;
            }
        }
    } else {
        editorActiveState.classList.remove("active");
        editorEmptyState.style.display = "flex";
    }

    // Set Search Listener
    searchInput.oninput = renderNotebook;

    // Set Creation Listener
    document.getElementById("btn-create-note").onclick = () => {
        const newNote = {
            id: "note_" + Date.now(),
            title: "New Note",
            content: "Start writing here...",
            timestamp: new Date().toLocaleDateString(),
            type: "General"
        };
        state.notebookNotes.push(newNote);
        activeNoteId = newNote.id;
        saveStateToStorage();
        renderNotebook();
        document.getElementById("note-editor-textarea").focus();
    };

    // Editor Auto-saving Listeners
    let autoSaveTimer = null;
    const triggerAutoSave = () => {
        if (!activeNoteId) return;
        const activeNote = state.notebookNotes.find(n => n.id === activeNoteId);
        if (activeNote) {
            activeNote.title = sanitizeHTML(noteTitleInput.value.trim()) || "Untitled Note";
            activeNote.content = sanitizeRichHTML(noteBodyArea.innerHTML);
            activeNote.timestamp = new Date().toLocaleDateString();
            
            saveStateToStorage();
            
            // Throttle updating note list on the left to avoid input lags
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                // Refresh list display silently
                renderNotebookListOnly();
            }, 1000);
        }
    };

    noteTitleInput.oninput = triggerAutoSave;
    noteBodyArea.oninput = triggerAutoSave;

    // Editor Toolbar Executions
    initEditorToolbarActions(noteBodyArea, triggerAutoSave);

    // Delete Note Event Listener
    const btnDeleteNote = document.getElementById("btn-delete-note");
    if (btnDeleteNote) {
        btnDeleteNote.onclick = () => {
            if (!activeNoteId) return;
            const confirmDelete = confirm("Are you sure you want to delete this note?");
            if (confirmDelete) {
                state.notebookNotes = state.notebookNotes.filter(n => n.id !== activeNoteId);
                activeNoteId = null;
                saveStateToStorage();
                renderNotebook();
                showToast("Note Deleted", "The note has been successfully deleted.", "info");
            }
        };
    }
}

function renderNotebookListOnly() {
    const listContainer = document.getElementById("notes-list-container");
    const searchInput = document.getElementById("notebook-search");
    if (!listContainer) return;

    const searchQuery = searchInput.value.toLowerCase();
    const filteredNotes = state.notebookNotes.filter(note => 
        note.title.toLowerCase().includes(searchQuery) || 
        note.content.toLowerCase().includes(searchQuery)
    );

    listContainer.innerHTML = "";
    filteredNotes.forEach(note => {
        const noteItem = document.createElement("div");
        noteItem.className = `note-item ${activeNoteId === note.id ? 'active' : ''}`;
        const cleanContent = note.content.replace(/<[^>]*>/g, '');
        noteItem.innerHTML = `
            <h4>${note.title || 'Untitled Note'}</h4>
            <p>${cleanContent || 'No content yet...'}</p>
            <div class="note-meta">
                <span class="note-date">${note.timestamp}</span>
                <span class="note-type-badge">${note.type || 'General'}</span>
            </div>
        `;
        noteItem.onclick = () => selectNotebookNote(note.id);
        listContainer.appendChild(noteItem);
    });
}

function selectNotebookNote(noteId) {
    activeNoteId = noteId;
    renderNotebook();
    if (window.innerWidth <= 768) {
        const editor = document.querySelector(".notebook-editor");
        if (editor) {
            editor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
}

function initEditorToolbarActions(editorEl, saveCallback) {
    const toolBtns = document.querySelectorAll(".editor-toolbar .tool-btn");
    
    toolBtns.forEach(btn => {
        const cmd = btn.getAttribute("data-cmd");
        if (cmd) {
            btn.onclick = () => {
                document.execCommand(cmd, false, null);
                editorEl.focus();
                saveCallback();
            };
        }
    });

    // Highlighter trigger palette toggle
    const highlightTrigger = document.querySelector(".highlight-trigger");
    const palette = document.querySelector(".highlight-palette");
    
    if (highlightTrigger && palette) {
        highlightTrigger.onclick = (e) => {
            e.stopPropagation();
            palette.classList.toggle("show");
        };

        // Click outside closes palette
        document.addEventListener("click", () => {
            palette.classList.remove("show");
        });

        // Color selector click
        const colorOptions = document.querySelectorAll(".palette-color");
        colorOptions.forEach(opt => {
            opt.onclick = () => {
                const color = opt.getAttribute("data-color");
                
                if (color === "transparent") {
                    document.execCommand("removeFormat", false, null);
                } else {
                    let className = "highlight-yellow";
                    if (opt.classList.contains("color-blue")) className = "highlight-blue";
                    if (opt.classList.contains("color-green")) className = "highlight-green";

                    // Use standard HTML formatting tags
                    const selection = window.getSelection();
                    if (selection.rangeCount && !selection.isCollapsed) {
                        const range = selection.getRangeAt(0);
                        const mark = document.createElement("mark");
                        mark.className = className;
                        
                        try {
                            range.surroundContents(mark);
                        } catch (err) {
                            // Fallback standard highlights
                            document.execCommand("backColor", false, color);
                        }
                    }
                }
                
                editorEl.focus();
                saveCallback();
                palette.classList.remove("show");
            };
        });
    }
}

// ================= VIEW: ADMIN PANEL =================
function renderAdminPanel() {
    // Setup tab toggling
    const tabBtns = document.querySelectorAll(".admin-tab-btn");
    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const target = btn.getAttribute("data-target");
            state.adminActiveTab = target;
            
            document.querySelectorAll(".admin-tab-content").forEach(content => {
                content.classList.remove("active");
            });
            document.getElementById(target).classList.add("active");
            const mainContainer = document.querySelector(".main-content");
            if (mainContainer) mainContainer.scrollTop = 0;

            // Sync with cloud users list if entering approvals tab
            if (target === "admin-approvals-tab") {
                syncUsersWithCloud().then(() => {
                    renderAdminApprovalsTab();
                });
            } else if (target === "admin-quizzes-tab") {
                Promise.all([
                    fetchCourseQuizzes(state.activeGroup),
                    fetchQuizResults(state.activeGroup)
                ]).then(() => {
                    renderAdminQuizzesTab();
                });
            } else if (target === "admin-announcements-tab") {
                fetchAnnouncement(state.activeGroup).then(() => {
                    const txt = document.getElementById("admin-announcement-text");
                    if (txt) txt.value = state.announcement || "";
                });
            }
        };
    });

    // Setup dynamic Source toggle
    const selectSource = document.getElementById("admin-q-source");
    const sourceWrapper = document.getElementById("admin-custom-source-wrapper");
    if (selectSource && sourceWrapper) {
        selectSource.onchange = () => {
            if (selectSource.value === "CUSTOM") {
                sourceWrapper.classList.remove("hidden");
            } else {
                sourceWrapper.classList.add("hidden");
            }
        };
    }

    // Setup dynamic Topic toggle
    const selectTopic = document.getElementById("admin-q-topic");
    const topicWrapper = document.getElementById("admin-custom-topic-wrapper");
    if (selectTopic && topicWrapper) {
        selectTopic.onchange = () => {
            if (selectTopic.value === "CUSTOM") {
                topicWrapper.classList.remove("hidden");
            } else {
                topicWrapper.classList.add("hidden");
            }
        };
    }

    // Setup Search Event Listener (only bind once)
    const searchInput = document.getElementById("admin-q-search");
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener("input", () => {
            renderAdminQuestionsTab();
        });
    }

    // Setup Flashcards Search Event Listener (only bind once)
    const fcSearchInput = document.getElementById("admin-fc-search");
    if (fcSearchInput && !fcSearchInput.dataset.bound) {
        fcSearchInput.dataset.bound = "true";
        fcSearchInput.addEventListener("input", () => {
            renderAdminFlashcardsTab();
        });
    }

    // Setup Users Registry Search Event Listener (only bind once)
    const usersSearchInput = document.getElementById("admin-users-search");
    if (usersSearchInput && !usersSearchInput.dataset.bound) {
        usersSearchInput.dataset.bound = "true";
        usersSearchInput.addEventListener("input", () => {
            renderAdminApprovalsTab();
        });
    }

    // Setup Direct Add User form submission (only bind once)
    const directUserForm = document.getElementById("admin-direct-user-form");
    if (directUserForm && !directUserForm.dataset.bound) {
        directUserForm.dataset.bound = "true";
        directUserForm.onsubmit = (e) => {
            e.preventDefault();
            const email = document.getElementById("admin-direct-email").value.trim().toLowerCase();
            const password = document.getElementById("admin-direct-password").value;
            const role = document.getElementById("admin-direct-role").value;

            if (!email.endsWith("@gmail.com")) {
                showToast("Gmail Only", "Only Gmail accounts can be registered.", "warning");
                return;
            }

            const existing = state.users.find(u => u.email === email);
            if (existing) {
                showToast("Already Exists", "This email account is already registered in the system.", "danger");
                return;
            }

            const newUser = {
                email: email,
                password: sha256Sync(password),
                role: role,
                status: "approved",
                dateRegistered: new Date().toLocaleDateString(),
                questions: JSON.parse(JSON.stringify(SEED_QUESTIONS)),
                tests: [],
                notebookNotes: [],
                flashcards: []
            };

            state.users.push(newUser);
            saveStateToStorage();

            showToast("User Created", `Directly added approved ${role.toUpperCase()} account.`, "success");
            directUserForm.reset();
            renderAdminApprovalsTab();
        };
    }

    // Render tab specifics
    renderAdminQuestionsTab();
    renderAdminFlashcardsTab();
    renderAdminReportTasksTab();
    renderAdminApprovalsTab();
    renderAdminQuizzesTab();
    renderAdminBookAccessManager();
}

function renderAdminQuestionsTab() {
    const listContainer = document.getElementById("admin-questions-list-container");
    if (!listContainer) return;

    // Populate topic dropdown for create mode
    const qIdInput = document.getElementById("edit-question-id").value;
    if (!qIdInput) {
        populateAdminTopicSelect();
    }

    // Get search term
    const searchInput = document.getElementById("admin-q-search");
    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    listContainer.innerHTML = "";

    // Show questions in reverse order (newest first)
    let sortedQs = [...state.questions].reverse();

    // Filter questions if query is present
    if (query) {
        sortedQs = sortedQs.filter(q => {
            const textMatch = q.text.toLowerCase().includes(query);
            const topicMatch = q.topic.toLowerCase().includes(query);
            const sourceMatch = q.source.toLowerCase().includes(query);
            const explanationMatch = (q.explanation || "").toLowerCase().includes(query);
            
            // Check if any option matches
            const optionsMatch = Object.values(q.options || {}).some(opt => 
                opt.toLowerCase().includes(query)
            );

            return textMatch || topicMatch || sourceMatch || explanationMatch || optionsMatch;
        });
    }

    if (sortedQs.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state" style="padding: 24px; text-align: center; color: var(--text-muted);">
                <i class="fa-solid fa-magnifying-glass empty-icon" style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5;"></i>
                <h3>No Matching Questions Found</h3>
                <p>Try searching for a different keyword or topic.</p>
            </div>
        `;
    }

    sortedQs.forEach(q => {
        const qItem = document.createElement("div");
        qItem.className = "admin-q-item";
        qItem.innerHTML = `
            <div class="admin-q-content">
                <h4>${q.text}</h4>
                <div class="admin-q-meta">
                    <span class="badge">${q.source}</span>
                    <span class="badge" style="background-color:var(--primary-color-soft);color:var(--primary-color)">${q.topic}</span>
                    <span class="badge badge-success">Ans: ${q.correctOption}</span>
                </div>
            </div>
            <div class="admin-q-actions">
                <button class="btn btn-secondary" style="padding:6px 12px;font-size:0.8rem" onclick="editQuestionAdmin('${q.id}')">
                    <i class="fa-regular fa-edit"></i> Edit
                </button>
                <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem" onclick="deleteQuestionAdmin('${q.id}')">
                    <i class="fa-regular fa-trash-can"></i> Delete
                </button>
            </div>
        `;
        listContainer.appendChild(qItem);
    });

    // Form submission action setup
    const form = document.getElementById("admin-question-form");
    form.onsubmit = (e) => {
        e.preventDefault();
        
        const qIdInput = document.getElementById("edit-question-id").value;
        
        let sourceVal = document.getElementById("admin-q-source").value;
        if (sourceVal === "CUSTOM") {
            sourceVal = document.getElementById("admin-q-custom-source").value.trim();
            if (!sourceVal) {
                showToast("Source Required", "Please type a custom source name.", "danger");
                return;
            }
        }

        let topicVal = document.getElementById("admin-q-topic").value;
        if (topicVal === "CUSTOM") {
            topicVal = document.getElementById("admin-q-custom-topic").value.trim();
            if (!topicVal) {
                showToast("Topic Required", "Please type a custom topic name.", "danger");
                return;
            }
        }

        const textVal = document.getElementById("admin-q-text").value.trim();
        const optA = document.getElementById("admin-q-optA").value.trim();
        const optB = document.getElementById("admin-q-optB").value.trim();
        const optC = document.getElementById("admin-q-optC").value.trim();
        const optD = document.getElementById("admin-q-optD").value.trim();
        const optE = document.getElementById("admin-q-optE").value.trim();
        const correctOpt = document.getElementById("admin-q-correct").value;
        const explanationVal = document.getElementById("admin-q-explanation").value.trim();

        // Build options object dynamically (only include E if provided)
        const choicesObj = { A: optA, B: optB, C: optC, D: optD };
        if (optE) {
            choicesObj.E = optE;
        }

        if (qIdInput) {
            // EDIT MODE
            const existingQ = state.questions.find(q => q.id === qIdInput);
            if (existingQ) {
                existingQ.source = sourceVal;
                existingQ.topic = topicVal;
                existingQ.text = textVal;
                existingQ.options = choicesObj;
                existingQ.correctOption = correctOpt;
                existingQ.explanation = explanationVal;
                
                showToast("Question Updated", "Question was updated successfully in the bank database.", "success");
            }
        } else {
            // CREATE MODE
            const newQ = {
                id: "q_" + Date.now(),
                source: sourceVal,
                topic: topicVal,
                text: textVal,
                options: choicesObj,
                correctOption: correctOpt,
                explanation: explanationVal,
                status: "unused",
                marked: false,
                notes: "",
                highlightedHtml: ""
            };
            state.questions.push(newQ);
            showToast("Question Created", "New question added successfully to the bank database.", "success");
        }

        saveStateToStorage();
        resetAdminForm();
        renderAdminQuestionsTab();
    };

    // Cancel edit button setup
    const cancelEditBtn = document.getElementById("btn-cancel-edit-question");
    cancelEditBtn.onclick = () => {
        resetAdminForm();
    };
}

function resetAdminForm() {
    document.getElementById("admin-question-form").reset();
    document.getElementById("edit-question-id").value = "";
    document.getElementById("admin-custom-source-wrapper").classList.add("hidden");
    document.getElementById("admin-custom-topic-wrapper").classList.add("hidden");
    document.getElementById("admin-form-title").innerText = "Create New Question";
    document.getElementById("btn-save-question").innerText = "Save Question";
    document.getElementById("btn-cancel-edit-question").classList.add("hidden");
}

window.editQuestionAdmin = function(qId) {
    const q = state.questions.find(q => q.id === qId);
    if (q) {
        document.getElementById("edit-question-id").value = q.id;
        
        // Populate Source selection
        const selectSource = document.getElementById("admin-q-source");
        const customSourceWrapper = document.getElementById("admin-custom-source-wrapper");
        if (q.source === "Past Exam" || q.source === "College MCQ") {
            selectSource.value = q.source;
            customSourceWrapper.classList.add("hidden");
            document.getElementById("admin-q-custom-source").value = "";
        } else {
            selectSource.value = "CUSTOM";
            customSourceWrapper.classList.remove("hidden");
            document.getElementById("admin-q-custom-source").value = q.source;
        }

        // Populate Topic selection
        populateAdminTopicSelect(q.topic);

        document.getElementById("admin-q-text").value = q.text;
        document.getElementById("admin-q-optA").value = q.options.A;
        document.getElementById("admin-q-optB").value = q.options.B;
        document.getElementById("admin-q-optC").value = q.options.C;
        document.getElementById("admin-q-optD").value = q.options.D;
        document.getElementById("admin-q-optE").value = q.options.E || "";
        document.getElementById("admin-q-correct").value = q.correctOption;
        document.getElementById("admin-q-explanation").value = q.explanation;

        document.getElementById("admin-form-title").innerText = "Edit Question Details";
        document.getElementById("btn-save-question").innerText = "Update Question";
        document.getElementById("btn-cancel-edit-question").classList.remove("hidden");
        
        // Scroll to form
        document.getElementById("admin-question-form").scrollIntoView({ behavior: 'smooth' });
    }
};

window.deleteQuestionAdmin = function(qId) {
    if (confirm("Are you sure you want to delete this question? It will be removed permanently from the database.")) {
        const index = state.questions.findIndex(q => q.id === qId);
        if (index > -1) {
            state.questions.splice(index, 1);
            saveStateToStorage();
            showToast("Question Deleted", "Question removed successfully.", "success");
            renderAdminQuestionsTab();
        }
    }
};

function renderAdminApprovalsTab() {
    const pendingBody = document.getElementById("admin-pending-users-table-body");
    const approvedBody = document.getElementById("admin-approved-users-table-body");
    
    const noPendingAlert = document.getElementById("no-pending-users-alert");
    const noApprovedAlert = document.getElementById("no-approved-users-alert");
    
    const pendingBadge = document.getElementById("admin-pending-badge");
    
    if (!pendingBody || !approvedBody) return;

    // Search query
    const searchInput = document.getElementById("admin-users-search");
    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    // Clear contents
    pendingBody.innerHTML = "";
    approvedBody.innerHTML = "";

    // 1. Pending Approvals
    let pendingUsers = state.users.filter(u => u.status === "pending");
    if (pendingBadge) pendingBadge.innerText = pendingUsers.length;

    if (query) {
        pendingUsers = pendingUsers.filter(u => u.email.toLowerCase().includes(query));
    }

    if (pendingUsers.length === 0) {
        noPendingAlert.classList.remove("hidden");
        pendingBody.parentElement.classList.add("hidden");
    } else {
        noPendingAlert.classList.add("hidden");
        pendingBody.parentElement.classList.remove("hidden");
        
        pendingUsers.forEach(user => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${user.email}</strong></td>
                <td>${user.dateRegistered || 'N/A'}</td>
                <td class="text-right">
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:0.8rem;background-color:#10b981;border-color:#10b981;" onclick="approveUserAdmin('${user.email}', 'user')">
                            <i class="fa-solid fa-user-check"></i> Approve (User)
                        </button>
                        <button class="btn btn-primary" style="padding:6px 12px;font-size:0.8rem;background-color:#3b82f6;border-color:#3b82f6;" onclick="approveUserAdmin('${user.email}', 'admin')">
                            <i class="fa-solid fa-user-shield"></i> Approve (Admin)
                        </button>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem;" onclick="rejectUserAdmin('${user.email}')">
                            <i class="fa-solid fa-xmark"></i> Refuse
                        </button>
                    </div>
                </td>
            `;
            pendingBody.appendChild(tr);
        });
    }

    // 2. Approved Users
    let approvedUsers = state.users.filter(u => u.status === "approved");
    
    if (query) {
        approvedUsers = approvedUsers.filter(u => u.email.toLowerCase().includes(query));
    }

    if (approvedUsers.length === 0) {
        noApprovedAlert.classList.remove("hidden");
        approvedBody.parentElement.classList.add("hidden");
    } else {
        noApprovedAlert.classList.add("hidden");
        approvedBody.parentElement.classList.remove("hidden");

        approvedUsers.forEach(user => {
            const isSelf = state.currentUser && state.currentUser.email === user.email;
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${user.email}</strong> ${isSelf ? '<span class="text-muted" style="font-size:0.8rem">(You)</span>' : ''}</td>
                <td>
                    <input type="text" value="${user.displayName || ''}" placeholder="Set nickname..." 
                           style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 0.85rem; width: 140px; box-sizing: border-box;" 
                           onchange="updateUserDisplayName('${user.email}', this.value)" />
                </td>
                <td>
                    <span class="badge ${user.role === 'admin' ? 'badge-danger' : 'badge-primary'}" style="text-transform: capitalize; padding: 4px 8px; border-radius: 4px;">
                        ${user.role === 'admin' ? 'Admin' : 'Student'}
                    </span>
                </td>
                <td>${user.dateRegistered || 'N/A'}</td>
                <td class="text-right">
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button class="btn btn-secondary" style="padding:6px 12px;font-size:0.8rem" onclick="toggleUserRoleAdmin('${user.email}')" ${isSelf ? 'disabled' : ''}>
                            <i class="fa-solid fa-arrows-spin"></i> Toggle Role
                        </button>
                        <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem" onclick="deleteUserAdmin('${user.email}')" ${isSelf ? 'disabled' : ''}>
                            <i class="fa-regular fa-trash-can"></i> Delete
                        </button>
                    </div>
                </td>
            `;
            approvedBody.appendChild(tr);
        });
    }
}

window.updateUserDisplayName = async function(email, newName) {
    const user = state.users.find(u => u.email === email);
    if (!user) return;
    newName = (newName || "").trim();
    if (user.displayName === newName) return;

    user.displayName = newName;
    user.lastUpdated = Date.now();

    encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);

    const payload = [{
        email: user.email,
        group_name: state.activeGroup,
        password_hash: user.password || user.password_hash || "google_auth_user",
        role: user.role || 'user',
        status: user.status || 'approved',
        display_name: user.displayName,
        last_updated: new Date(user.lastUpdated).toISOString()
    }];

    try {
        await supabaseRequest("hawari_users?on_conflict=email,group_name", {
            method: "POST",
            headers: {
                "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(payload)
        });
        showToast("Name Updated", `Set display name for ${email} to "${newName || email}"`, "success");
    } catch (e) {
        console.error("Direct Supabase display_name update failed, queuing offline:", e);
        enqueueOfflineSync("hawari_users", "UPSERT", payload);
        showToast("Name Saved Offline", `Display name saved locally and queued for cloud sync.`, "info");
    }

    renderAdminApprovalsTab();
};

window.approveUserAdmin = async function(email, role = 'user') {
    const btn = (typeof event !== "undefined" && event) ? event.currentTarget : null;
    let originalHtml = "";
    if (btn) {
        btn.disabled = true;
        originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    const user = state.users.find(u => u.email === email);
    if (user) {
        user.status = "approved";
        user.role = role;
        if (!user.questions || user.questions.length === 0) {
            user.questions = JSON.parse(JSON.stringify(getGroupQuestionsSeed()));
        }
        if (!user.tests) user.tests = [];
        if (!user.notebookNotes) user.notebookNotes = [];
        if (!user.flashcards) user.flashcards = [];
        user.lastUpdated = Date.now();
        
        encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);

        const payload = [{
            email: user.email,
            group_name: state.activeGroup,
            password_hash: user.password || user.password_hash || "google_auth_user",
            role: user.role,
            status: user.status,
            display_name: user.displayName || user.email.split('@')[0],
            questions: user.questions,
            tests: user.tests,
            notebook_notes: user.notebookNotes,
            flashcards: user.flashcards,
            report_task_progress: user.reportTaskProgress || {},
            last_updated: new Date(user.lastUpdated).toISOString()
        }];
        
        try {
            await supabaseRequest("hawari_users?on_conflict=email,group_name", {
                method: "POST",
                headers: {
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify(payload)
            });
            showToast("User Approved", `Gmail account ${email} is now approved as ${role.toUpperCase()}.`, "success");
        } catch (e) {
            console.error("Direct cloud approval sync failed, queuing offline:", e);
            enqueueOfflineSync("hawari_users", "UPSERT", payload);
            showToast("Sync Warning", "Approved locally and queued for cloud sync.", "warning");
        }
        
        renderAdminApprovalsTab();
    }
};

window.rejectUserAdmin = async function(email) {
    if (confirm(`Are you sure you want to reject and remove registration request for ${email}?`)) {
        const btn = (typeof event !== "undefined" && event) ? event.currentTarget : null;
        let originalHtml = "";
        if (btn) {
            btn.disabled = true;
            originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Rejecting...`;
        }

        state.users = state.users.filter(u => u.email !== email);
        encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);
        
        try {
            // Delete record directly from Supabase with URL-encoded parameters
            await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(email)}&group_name=eq.${encodeURIComponent(state.activeGroup)}`, {
                method: "DELETE"
            });
            showToast("Request Rejected", `Registration request for ${email} has been rejected and deleted.`, "warning");
        } catch (e) {
            console.error("Cloud deletion failed, queuing offline:", e);
            enqueueOfflineSync("hawari_users", "DELETE", { email: email, group_name: state.activeGroup });
            showToast("Deletion Warning", "Deleted locally, and queued for cloud sync.", "warning");
        }

        renderAdminApprovalsTab();
    }
};

window.toggleUserRoleAdmin = async function(email, event) {
    const btn = (typeof event !== "undefined" && event) ? event.currentTarget : null;
    let originalHtml = "";
    if (btn) {
        btn.disabled = true;
        originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;
    }

    const user = state.users.find(u => u.email === email);
    if (user) {
        user.role = user.role === "admin" ? "user" : "admin";
        user.lastUpdated = Date.now();
        encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);

        const payload = [{
            email: user.email,
            group_name: state.activeGroup,
            password_hash: user.password || user.password_hash || "google_auth_user",
            role: user.role,
            status: user.status || 'approved',
            display_name: user.displayName || user.email.split('@')[0],
            last_updated: new Date(user.lastUpdated).toISOString()
        }];
        
        try {
            await supabaseRequest("hawari_users?on_conflict=email,group_name", {
                method: "POST",
                headers: {
                    "Prefer": "resolution=merge-duplicates"
                },
                body: JSON.stringify(payload)
            });
            showToast("Role Updated", `Role for ${email} has been changed to ${user.role.toUpperCase()}.`, "success");
        } catch (e) {
            console.error("Direct cloud role sync failed, queuing offline:", e);
            enqueueOfflineSync("hawari_users", "UPSERT", payload);
            showToast("Sync Warning", "Role updated locally and queued for cloud sync.", "warning");
        }
        
        renderAdminApprovalsTab();
    }
};

window.deleteUserAdmin = async function(email, event) {
    if (confirm(`CRITICAL WARNING: Are you sure you want to delete the user account for ${email}? All their test progress, notebooks, and flashcard records will be permanently erased!`)) {
        const btn = (typeof event !== "undefined" && event) ? event.currentTarget : null;
        let originalHtml = "";
        if (btn) {
            btn.disabled = true;
            originalHtml = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Deleting...`;
        }

        state.users = state.users.filter(u => u.email !== email);
        encryptLocal(getGroupKey(STORAGE_KEYS.USERS), state.users);
        
        try {
            // Delete record directly from Supabase with URL-encoded parameters
            await supabaseRequest(`hawari_users?email=eq.${encodeURIComponent(email)}&group_name=eq.${encodeURIComponent(state.activeGroup)}`, {
                method: "DELETE"
            });
            showToast("Account Deleted", `User account ${email} has been permanently deleted from registry.`, "danger");
        } catch (e) {
            console.error("Cloud deletion failed, queuing offline:", e);
            enqueueOfflineSync("hawari_users", "DELETE", { email: email, group_name: state.activeGroup });
            showToast("Deletion Warning", "Deleted locally and queued for cloud sync.", "warning");
        }
        
        renderAdminApprovalsTab();
    }
};

function initSidebarCollapse() {
    const btnCollapse = document.getElementById("btn-sidebar-collapse");
    const btnExpand = document.getElementById("btn-sidebar-expand");
    const appLayout = document.getElementById("app-layout");

    if (btnCollapse && btnExpand && appLayout) {
        // Auto-collapse sidebar on mobile/tablet viewports
        if (window.innerWidth <= 768) {
            appLayout.classList.add("sidebar-collapsed");
        }

        btnCollapse.addEventListener("click", () => {
            appLayout.classList.add("sidebar-collapsed");
        });

        btnExpand.addEventListener("click", () => {
            appLayout.classList.remove("sidebar-collapsed");
        });
    }
}

function initSecurityProtections() {
    // Helper to check if current logged in user is admin/developer
    const isDev = () => {
        return Boolean(state.currentUser && state.currentUser.role === "admin");
    };

    // 1. Prevent iframe embedding (Clickjacking protection)
    if (window.self !== window.top) {
        window.top.location = window.self.location;
    }

    // 2. Disable right-click globally
    document.addEventListener("contextmenu", (e) => {
        if (isDev()) return;
        if (e.target.closest("[contenteditable='true']") || e.target.closest("input") || e.target.closest("textarea")) {
            return;
        }
        e.preventDefault();
        showToast("Protected Content", "Right-click is disabled to protect proprietary questions.", "warning");
    });

    // 3. Disable copy globally
    document.addEventListener("copy", (e) => {
        if (isDev() || state.activeView === "notebook") return;
        
        e.preventDefault();
        showToast("Protected Content", "Copying content is disabled to protect database.", "warning");
    });

    // 4. Disable developer hotkeys (F12, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J, Ctrl+U)
    document.addEventListener("keydown", (e) => {
        if (isDev()) return;

        const isControl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;
        
        // F12
        if (e.key === "F12" || e.keyCode === 123) {
            e.preventDefault();
            showToast("Developer Tools", "Access to Developer Tools is restricted.", "danger");
            return;
        }

        // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
        if (isControl && isShift && (e.key === "I" || e.key === "J" || e.key === "C" || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
            e.preventDefault();
            showToast("Developer Tools", "Access to Developer Tools is restricted.", "danger");
            return;
        }

        // Ctrl+U (View Source)
        if (isControl && (e.key === "u" || e.key === "U" || e.keyCode === 85)) {
            e.preventDefault();
            showToast("Source Code", "Viewing page source code is restricted.", "danger");
            return;
        }
    });

    // 5. Anti-Debugging Protection (Pauses execution if DevTools is opened, bypassed for Developer)
    setInterval(() => {
        if (isDev()) return;
        
        (function() {
            const before = new Date().getTime();
            debugger;
            const after = new Date().getTime();
            if (after - before > 100) {
                document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#ffffff;font-family:'Inter',sans-serif;text-align:center;padding:24px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size:3.5rem;color:#ef4444;margin-bottom:20px;"></i>
                    <h1 style="font-size:1.8rem;font-weight:700;margin-bottom:10px;">Developer Tools Detected</h1>
                    <p style="color:#94a3b8;max-width:400px;line-height:1.5;margin-bottom:20px;">Access to the exam platform is restricted when developer tools are active to protect intellectual questions.</p>
                    <button class="btn btn-primary" onclick="window.location.reload()">Reload Page</button>
                </div>`;
            }
        })();
    }, 2000);
}

function populateAdminTopicSelect(selectedTopic) {
    const selectTopic = document.getElementById("admin-q-topic");
    if (!selectTopic) return;
    
    // Gather all unique topics in state.questions
    const uniqueTopics = new Set();
    state.questions.forEach(q => {
        if (q.topic) uniqueTopics.add(q.topic);
    });

    selectTopic.innerHTML = "";
    
    // Sort and append options
    Array.from(uniqueTopics).sort().forEach(topic => {
        const opt = document.createElement("option");
        opt.value = topic;
        opt.innerText = topic;
        selectTopic.appendChild(opt);
    });

    // Add CUSTOM option
    const customOpt = document.createElement("option");
    customOpt.value = "CUSTOM";
    customOpt.innerText = "+ Add Custom Topic";
    selectTopic.appendChild(customOpt);

    const topicWrapper = document.getElementById("admin-custom-topic-wrapper");

    // Select the topic if passed
    if (selectedTopic) {
        if (uniqueTopics.has(selectedTopic)) {
            selectTopic.value = selectedTopic;
            topicWrapper.classList.add("hidden");
        } else {
            selectTopic.value = "CUSTOM";
            topicWrapper.classList.remove("hidden");
            document.getElementById("admin-q-custom-topic").value = selectedTopic;
        }
    } else {
        topicWrapper.classList.add("hidden");
        document.getElementById("admin-q-custom-topic").value = "";
    }
}

// ================= ANKI / SM-2 SPACED REPETITION ENGINE & DECK SYSTEM =================

let activeFlashcardIdx = 0;
let activeFlashcardTab = "official"; // "official" | "personal"
let activeFlashcardDeck = "all"; // "all" | specific deck name
let _isFlashcardKeybound = false;

function normalizeSm2Card(card) {
    if (!card) return card;
    if (typeof card !== "object") return card;
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
    // grade: 1 = Again (Failed), 2 = Hard (Effort), 3 = Good (Correct), 4 = Easy (Instant)
    normalizeSm2Card(card);
    let repetitions = card.repetitions || 0;
    let interval = card.interval || 0;
    let easeFactor = card.easeFactor || 2.5;
    let nextReviewDate = Date.now();
    let state = card.state || "new";

    if (grade === 1) { // AGAIN (< 10m)
        repetitions = 0;
        interval = 0;
        nextReviewDate = Date.now() + 10 * 60 * 1000; // 10 minutes
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        state = "learning";
    } else if (grade === 2) { // HARD (1d or interval * 1.2)
        if (repetitions === 0) {
            interval = 1;
        } else {
            interval = Math.max(1, Math.round(interval * 1.2));
        }
        repetitions += 1;
        nextReviewDate = Date.now() + interval * 86400000;
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        state = repetitions >= 3 ? "mastered" : "learning";
    } else if (grade === 3) { // GOOD (1d -> 3d -> interval * EF)
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
    } else if (grade === 4) { // EASY (4d -> 7d -> interval * EF * 1.3)
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
    const goodDays = rep === 0 ? 1 : (rep === 1 ? 3 : Math.max(1, Math.round(curInt * ef)));
    const easyDays = rep === 0 ? 4 : (rep === 1 ? 7 : Math.max(1, Math.round(curInt * ef * 1.3)));

    return {
        againLabel,
        hardLabel: `${hardDays}d`,
        goodLabel: `${goodDays}d`,
        easyLabel: `${easyDays}d`
    };
}

function renderFlashcardsView() {
    // Bind Tab Switchers
    const btnOfficial = document.getElementById("btn-tab-fc-official");
    const btnPersonal = document.getElementById("btn-tab-fc-personal");
    const btnCreate = document.getElementById("btn-create-personal-flashcard");

    if (btnOfficial && !btnOfficial.dataset.bound) {
        btnOfficial.dataset.bound = "true";
        btnOfficial.onclick = () => {
            activeFlashcardTab = "official";
            btnOfficial.classList.add("active");
            if (btnPersonal) btnPersonal.classList.remove("active");
            activeFlashcardDeck = "all";
            activeFlashcardIdx = 0;
            renderFlashcardsView();
        };
    }

    if (btnPersonal && !btnPersonal.dataset.bound) {
        btnPersonal.dataset.bound = "true";
        btnPersonal.onclick = () => {
            activeFlashcardTab = "personal";
            btnPersonal.classList.add("active");
            if (btnOfficial) btnOfficial.classList.remove("active");
            activeFlashcardDeck = "all";
            activeFlashcardIdx = 0;
            renderFlashcardsView();
        };
    }

    if (btnCreate && !btnCreate.dataset.bound) {
        btnCreate.dataset.bound = "true";
        btnCreate.onclick = () => {
            const modal = document.getElementById("modal-create-flashcard");
            if (modal) modal.classList.remove("hidden");
        };
    }

    // Bind Create Personal Flashcard Form
    const createForm = document.getElementById("form-create-personal-flashcard");
    if (createForm && !createForm.dataset.bound) {
        createForm.dataset.bound = "true";
        createForm.onsubmit = (e) => {
            e.preventDefault();
            const cat = document.getElementById("fc-new-category").value.trim();
            const front = document.getElementById("fc-new-front").value.trim();
            const back = document.getElementById("fc-new-back").value.trim();

            if (!front || !back) {
                showToast("Required Fields", "Please enter both front question and back answer.", "warning");
                return;
            }

            const deckName = cat || "Personal Notes";
            const newCard = {
                id: "fc_pers_" + Date.now() + Math.random().toString(36).substring(2, 6),
                category: deckName,
                deck: deckName,
                front: front,
                back: back,
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: false,
                authorEmail: state.currentUser ? state.currentUser.email : "guest"
            };

            if (!state.flashcards) state.flashcards = [];
            state.flashcards.unshift(newCard);
            saveStateToStorage();

            showToast("Flashcard Added", `Created new card in deck "${deckName}"!`, "success");
            createForm.reset();
            const modal = document.getElementById("modal-create-flashcard");
            if (modal) modal.classList.add("hidden");

            // Auto-switch to personal tab
            activeFlashcardTab = "personal";
            if (btnPersonal) btnPersonal.classList.add("active");
            if (btnOfficial) btnOfficial.classList.remove("active");
            activeFlashcardDeck = "all";
            activeFlashcardIdx = 0;
            renderFlashcardsView();
        };
    }

    // Normalize all flashcards in state
    if (!state.flashcards) state.flashcards = [];
    state.flashcards.forEach(c => normalizeSm2Card(c));

    // Filter Flashcards according to active tab
    const allCards = state.flashcards || [];
    let tabCards = [];
    if (activeFlashcardTab === "official") {
        tabCards = allCards.filter(c => c.isOfficial !== false);
    } else {
        const userEmail = state.currentUser ? state.currentUser.email : "";
        tabCards = allCards.filter(c => c.isOfficial === false && (!c.authorEmail || c.authorEmail === userEmail));
    }

    // Extract unique Decks and build Deck Chips
    const deckChipsContainer = document.getElementById("flashcard-deck-chips");
    const deckCountLbl = document.getElementById("flashcard-deck-count-lbl");
    if (deckChipsContainer) {
        deckChipsContainer.innerHTML = "";
        const decksMap = {};
        tabCards.forEach(c => {
            const d = c.deck || c.category || "General";
            decksMap[d] = (decksMap[d] || 0) + 1;
        });

        const uniqueDecks = Object.keys(decksMap).sort();

        // "All Decks" chip
        const allChip = document.createElement("button");
        allChip.className = `anki-deck-chip ${activeFlashcardDeck === "all" ? "active" : ""}`;
        allChip.innerHTML = `<i class="fa-solid fa-layer-group"></i> All Decks (${tabCards.length})`;
        allChip.onclick = () => {
            activeFlashcardDeck = "all";
            activeFlashcardIdx = 0;
            renderFlashcardsView();
        };
        deckChipsContainer.appendChild(allChip);

        // Individual Deck chips
        uniqueDecks.forEach(d => {
            const chip = document.createElement("button");
            chip.className = `anki-deck-chip ${activeFlashcardDeck === d ? "active" : ""}`;
            chip.innerHTML = `<i class="fa-regular fa-folder"></i> ${d} (${decksMap[d]})`;
            chip.onclick = () => {
                activeFlashcardDeck = d;
                activeFlashcardIdx = 0;
                renderFlashcardsView();
            };
            deckChipsContainer.appendChild(chip);
        });

        if (deckCountLbl) {
            deckCountLbl.innerText = activeFlashcardDeck === "all" ? `Showing All (${uniqueDecks.length} Decks)` : `Deck: ${activeFlashcardDeck}`;
        }
    }

    // Filter cards by selected Deck
    let list = tabCards;
    if (activeFlashcardDeck !== "all") {
        list = tabCards.filter(c => (c.deck || c.category || "General") === activeFlashcardDeck);
    }

    // Stats calculations
    const dueLbl = document.getElementById("flashcard-stat-due");
    const learningLbl = document.getElementById("flashcard-stat-learning");
    const masteredLbl = document.getElementById("flashcard-stat-mastered");
    const totalLbl = document.getElementById("flashcard-stat-total");

    const emptyState = document.getElementById("flashcards-empty-state");
    const playLayout = document.getElementById("flashcards-play-layout");
    const sessionCompleteEl = document.getElementById("flashcards-session-complete");

    const dueCount = list.filter(c => isCardDueForReview(c)).length;
    const learningCount = list.filter(c => c.state === "learning" || (c.repetitions > 0 && c.repetitions < 3)).length;
    const masteredCount = list.filter(c => c.status === "mastered" || c.state === "mastered").length;

    if (dueLbl) dueLbl.innerText = dueCount;
    if (learningLbl) learningLbl.innerText = learningCount;
    if (masteredLbl) masteredLbl.innerText = masteredCount;
    if (totalLbl) totalLbl.innerText = list.length;

    // Handle Empty State
    if (list.length === 0) {
        if (emptyState) emptyState.classList.remove("hidden");
        if (playLayout) playLayout.classList.add("hidden");
        if (sessionCompleteEl) sessionCompleteEl.classList.add("hidden");
        return;
    } else {
        if (emptyState) emptyState.classList.add("hidden");
        if (sessionCompleteEl) sessionCompleteEl.classList.add("hidden");
        if (playLayout) playLayout.classList.remove("hidden");
    }

    // Bounds check index
    if (activeFlashcardIdx >= list.length) {
        activeFlashcardIdx = 0;
    }
    if (activeFlashcardIdx < 0) {
        activeFlashcardIdx = list.length - 1;
    }

    const activeCard = list[activeFlashcardIdx];
    normalizeSm2Card(activeCard);

    // Reset card flip view (make sure front is shown initially)
    const cardBox = document.getElementById("active-flashcard-box");
    if (cardBox) {
        cardBox.classList.remove("flipped");
        cardBox.onclick = () => {
            cardBox.classList.toggle("flipped");
        };
    }

    // Populate Front
    const fCat = document.getElementById("card-front-category");
    const fTxt = document.getElementById("card-front-text");
    const fSm2Badge = document.getElementById("card-front-sm2-badge");
    const deckName = activeCard.deck || activeCard.category || "General";

    if (fCat) fCat.innerText = deckName;
    if (fTxt) fTxt.innerText = activeCard.front;
    if (fSm2Badge) {
        const isDue = isCardDueForReview(activeCard);
        if (isDue) {
            fSm2Badge.className = "badge badge-danger";
            fSm2Badge.innerText = "Due for Review";
        } else if (activeCard.state === "mastered") {
            fSm2Badge.className = "badge badge-success";
            fSm2Badge.innerText = `Mastered (${activeCard.interval}d)`;
        } else {
            fSm2Badge.className = "badge badge-warning";
            fSm2Badge.innerText = `Learning (${activeCard.interval}d)`;
        }
    }

    // Populate Back
    const bCat = document.getElementById("card-back-category");
    const bTxt = document.getElementById("card-back-text");
    const bSm2Badge = document.getElementById("card-back-sm2-badge");
    if (bCat) bCat.innerText = deckName;
    if (bTxt) bTxt.innerText = activeCard.back;
    if (bSm2Badge) {
        bSm2Badge.innerText = `EF: ${activeCard.easeFactor || 2.5} • Reps: ${activeCard.repetitions || 0}`;
    }

    // Navigation progress indicator
    const prog = document.getElementById("flashcard-progress-indicator");
    if (prog) prog.innerText = `Card ${activeFlashcardIdx + 1} of ${list.length}`;

    // Update dynamic Anki button intervals
    const btnLabels = getSm2ButtonLabels(activeCard);
    const intAgain = document.getElementById("anki-interval-again");
    const intHard = document.getElementById("anki-interval-hard");
    const intGood = document.getElementById("anki-interval-good");
    const intEasy = document.getElementById("anki-interval-easy");

    if (intAgain) intAgain.innerText = btnLabels.againLabel;
    if (intHard) intHard.innerText = btnLabels.hardLabel;
    if (intGood) intGood.innerText = btnLabels.goodLabel;
    if (intEasy) intEasy.innerText = btnLabels.easyLabel;

    // Helper to process SM-2 rating
    function rateCurrentCard(grade) {
        const update = calculateSm2Interval(activeCard, grade);
        Object.assign(activeCard, update);
        saveStateToStorage();

        const toastMsgs = {
            1: { title: "Again (< 10m)", text: "Card will be reviewed again in this session.", type: "danger" },
            2: { title: `Hard (${update.interval}d)`, text: `Next review scheduled in ${update.interval} day(s).`, type: "warning" },
            3: { title: `Good (${update.interval}d)`, text: `Next review scheduled in ${update.interval} day(s).`, type: "info" },
            4: { title: `Easy (${update.interval}d)`, text: `Mastered! Next review in ${update.interval} day(s).`, type: "success" }
        };

        const msg = toastMsgs[grade] || { title: "Reviewed", text: "Flashcard updated.", type: "success" };
        showToast(msg.title, msg.text, msg.type);

        setTimeout(() => {
            activeFlashcardIdx++;
            renderFlashcardsView();
        }, 250);
    }

    // Bind Anki SM-2 4 Rating Buttons
    const btnAgain = document.getElementById("btn-anki-again");
    const btnHard = document.getElementById("btn-anki-hard");
    const btnGood = document.getElementById("btn-anki-good");
    const btnEasy = document.getElementById("btn-anki-easy");

    if (btnAgain) btnAgain.onclick = (e) => { e.stopPropagation(); rateCurrentCard(1); };
    if (btnHard) btnHard.onclick = (e) => { e.stopPropagation(); rateCurrentCard(2); };
    if (btnGood) btnGood.onclick = (e) => { e.stopPropagation(); rateCurrentCard(3); };
    if (btnEasy) btnEasy.onclick = (e) => { e.stopPropagation(); rateCurrentCard(4); };

    // Navigation Controls
    const btnPrev = document.getElementById("btn-fc-prev");
    const btnNext = document.getElementById("btn-fc-next");
    if (btnPrev) {
        btnPrev.onclick = () => {
            activeFlashcardIdx--;
            renderFlashcardsView();
        };
    }
    if (btnNext) {
        btnNext.onclick = () => {
            activeFlashcardIdx++;
            renderFlashcardsView();
        };
    }

    // Restart study session button
    const btnRestartStudy = document.getElementById("btn-restart-deck-study");
    if (btnRestartStudy) {
        btnRestartStudy.onclick = () => {
            activeFlashcardIdx = 0;
            renderFlashcardsView();
        };
    }

    // Keyboard Hotkeys binding (Space = Flip, 1 = Again, 2 = Hard, 3 = Good, 4 = Easy)
    if (!_isFlashcardKeybound) {
        _isFlashcardKeybound = true;
        document.addEventListener("keydown", (e) => {
            if (state.activeView !== "flashcards") return;
            const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select") return;

            const box = document.getElementById("active-flashcard-box");
            if (!box) return;

            if (e.code === "Space") {
                e.preventDefault();
                box.classList.toggle("flipped");
            } else if (e.key === "1") {
                e.preventDefault();
                const b = document.getElementById("btn-anki-again");
                if (b) b.click();
            } else if (e.key === "2") {
                e.preventDefault();
                const b = document.getElementById("btn-anki-hard");
                if (b) b.click();
            } else if (e.key === "3") {
                e.preventDefault();
                const b = document.getElementById("btn-anki-good");
                if (b) b.click();
            } else if (e.key === "4") {
                e.preventDefault();
                const b = document.getElementById("btn-anki-easy");
                if (b) b.click();
            }
        });
    }
}

let editFlashcardId = "";

function renderAdminFlashcardsTab() {
    const listContainer = document.getElementById("admin-flashcards-list-container");
    if (!listContainer) return;

    if (!state.flashcards) state.flashcards = [];
    state.flashcards.forEach(c => normalizeSm2Card(c));

    // Populate Datalist with existing Decks for smart autocomplete
    const datalist = document.getElementById("admin-fc-category-list");
    const deckFilterSelect = document.getElementById("admin-fc-deck-filter");
    const totalBadge = document.getElementById("admin-fc-total-badge");

    const decksMap = {};
    state.flashcards.forEach(c => {
        const d = c.deck || c.category || "General";
        decksMap[d] = (decksMap[d] || 0) + 1;
    });
    const uniqueDecks = Object.keys(decksMap).sort();

    if (datalist) {
        datalist.innerHTML = uniqueDecks.map(d => `<option value="${d}">`).join("");
    }

    // Populate Deck Filter dropdown in Admin List
    if (deckFilterSelect && !deckFilterSelect.dataset.bound) {
        deckFilterSelect.dataset.bound = "true";
        deckFilterSelect.onchange = () => {
            renderAdminFlashcardsTab();
        };
    }

    if (deckFilterSelect) {
        const currentVal = deckFilterSelect.value || "all";
        deckFilterSelect.innerHTML = `<option value="all">📁 All Decks (${state.flashcards.length})</option>` +
            uniqueDecks.map(d => `<option value="${d}" ${currentVal === d ? "selected" : ""}>📁 ${d} (${decksMap[d]})</option>`).join("");
    }

    if (totalBadge) {
        totalBadge.innerText = `${state.flashcards.length} Cards across ${uniqueDecks.length} Decks`;
    }

    // Search query & Deck filter
    const searchInput = document.getElementById("admin-fc-search");
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.oninput = () => {
            renderAdminFlashcardsTab();
        };
    }
    const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const selectedDeck = deckFilterSelect ? deckFilterSelect.value : "all";

    listContainer.innerHTML = "";

    let filteredCards = [...state.flashcards].reverse();

    if (selectedDeck !== "all") {
        filteredCards = filteredCards.filter(c => (c.deck || c.category || "General") === selectedDeck);
    }

    if (query) {
        filteredCards = filteredCards.filter(c => 
            (c.deck && c.deck.toLowerCase().includes(query)) ||
            (c.category && c.category.toLowerCase().includes(query)) || 
            (c.front && c.front.toLowerCase().includes(query)) || 
            (c.back && c.back.toLowerCase().includes(query))
        );
    }

    if (filteredCards.length === 0) {
        listContainer.innerHTML = `<span class="text-muted" style="padding:20px;display:block;text-align:center">No flashcards found. Create your first card on the left.</span>`;
        return;
    }

    // Group cards by Deck
    const grouped = {};
    filteredCards.forEach(c => {
        const d = c.deck || c.category || "General";
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(c);
    });

    Object.keys(grouped).sort().forEach(deckName => {
        const deckCards = grouped[deckName];

        // Deck Section Header
        const header = document.createElement("div");
        header.className = "admin-deck-group-header";
        header.innerHTML = `
            <span><i class="fa-solid fa-folder-open" style="color:var(--primary-color);margin-right:6px"></i> Deck: <strong>${deckName}</strong></span>
            <span class="badge" style="background:var(--primary-color-soft);color:var(--primary-color);font-size:0.75rem">${deckCards.length} Card(s)</span>
        `;
        listContainer.appendChild(header);

        // Deck Cards
        deckCards.forEach(c => {
            const item = document.createElement("div");
            item.className = "admin-q-item";
            item.innerHTML = `
                <div class="admin-q-content">
                    <h4>Q: ${c.front}</h4>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:6px">A: ${c.back}</p>
                    <div class="admin-q-meta" style="margin-top:8px;gap:8px;display:flex;flex-wrap:wrap;align-items:center;">
                        <span class="badge" style="background-color:var(--primary-color-soft);color:var(--primary-color)">📁 ${c.deck || c.category}</span>
                        <span class="badge ${c.status === 'mastered' ? 'badge-success' : 'badge-warning'}">${c.status === 'mastered' ? 'Mastered' : 'Review'}</span>
                        <span style="font-size:0.75rem;color:var(--text-muted);">Interval: <strong>${c.interval || 0}d</strong></span>
                        <span style="font-size:0.75rem;color:var(--text-muted);">EF: <strong>${c.easeFactor || 2.5}</strong></span>
                        <span style="font-size:0.75rem;color:var(--text-muted);">Reps: <strong>${c.repetitions || 0}</strong></span>
                    </div>
                </div>
                <div class="admin-q-actions">
                    <button class="btn btn-secondary" style="padding:6px 12px;font-size:0.8rem" onclick="editFlashcardAdmin('${c.id}')">
                        <i class="fa-regular fa-edit"></i> Edit
                    </button>
                    <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem" onclick="deleteFlashcardAdmin('${c.id}')">
                        <i class="fa-regular fa-trash-can"></i> Delete
                    </button>
                </div>
            `;
            listContainer.appendChild(item);
        });
    });

    // Form submit listener
    const form = document.getElementById("admin-flashcard-form");
    form.onsubmit = (e) => {
        e.preventDefault();
        const fcIdInput = document.getElementById("edit-flashcard-id").value;
        const categoryVal = sanitizeHTML(document.getElementById("admin-fc-category").value.trim());
        const frontVal = sanitizeHTML(document.getElementById("admin-fc-front").value.trim());
        const backVal = sanitizeHTML(document.getElementById("admin-fc-back").value.trim());

        if (!categoryVal || !frontVal || !backVal) {
            showToast("Missing Info", "Please fill out deck name, front text, and back text.", "warning");
            return;
        }

        if (fcIdInput) {
            // EDIT
            const existing = state.flashcards.find(c => c.id === fcIdInput);
            if (existing) {
                existing.category = categoryVal;
                existing.deck = categoryVal;
                existing.front = frontVal;
                existing.back = backVal;
                showToast("Flashcard Updated", `Card updated in deck "${categoryVal}".`, "success");
            }
        } else {
            // CREATE
            const newFC = {
                id: "fc_" + Date.now(),
                category: categoryVal,
                deck: categoryVal,
                front: frontVal,
                back: backVal,
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            };
            state.flashcards.push(newFC);
            showToast("Flashcard Created", `New card added to deck "${categoryVal}".`, "success");
        }

        saveStateToStorage();
        resetAdminFlashcardForm();
        renderAdminFlashcardsTab();
        
        // Refresh flashcards view if open
        if (state.activeView === "flashcards") {
            renderFlashcardsView();
        }
    };
}

function resetAdminFlashcardForm() {
    document.getElementById("admin-flashcard-form").reset();
    document.getElementById("edit-flashcard-id").value = "";
    document.getElementById("admin-fc-form-title").innerText = "Create New Flashcard";
    document.getElementById("btn-save-flashcard").innerText = "Save Flashcard";
    const cancelEditBtn = document.getElementById("btn-cancel-fc-edit");
    if (cancelEditBtn) cancelEditBtn.classList.add("hidden");
}

window.editFlashcardAdmin = function(fcId) {
    const card = state.flashcards.find(c => c.id === fcId);
    if (card) {
        document.getElementById("edit-flashcard-id").value = card.id;
        document.getElementById("admin-fc-category").value = card.deck || card.category || "";
        document.getElementById("admin-fc-front").value = card.front;
        document.getElementById("admin-fc-back").value = card.back;

        document.getElementById("admin-fc-form-title").innerText = "Edit Flashcard";
        document.getElementById("btn-save-flashcard").innerText = "Update Flashcard";
        
        const cancelEditBtn = document.getElementById("btn-cancel-fc-edit");
        if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");

        document.getElementById("admin-flashcard-form").scrollIntoView({ behavior: 'smooth' });
    }
};

window.deleteFlashcardAdmin = function(fcId) {
    if (confirm("Are you sure you want to delete this flashcard?")) {
        state.flashcards = state.flashcards.filter(c => c.id !== fcId);
        saveStateToStorage();
        showToast("Flashcard Deleted", "Flashcard was deleted successfully.", "warning");
        renderAdminFlashcardsTab();
        
        // Refresh flashcards view if open
        if (state.activeView === "flashcards") {
            renderFlashcardsView();
        }
    }
};

function renderAdminReportTasksTab() {
    const questionsListContainer = document.getElementById("admin-rt-questions-list");
    const reportTasksListContainer = document.getElementById("admin-report-tasks-list");
    const checkedCountEl = document.getElementById("admin-rt-checked-count");
    if (!questionsListContainer || !reportTasksListContainer) return;

    if (!window.rtManualQuestions) {
        window.rtManualQuestions = [];
    }

    function updateCheckedCountDisplay() {
        const dbCount = window.rtSelectedQuestionIds ? window.rtSelectedQuestionIds.size : 0;
        const manCount = window.rtManualQuestions ? window.rtManualQuestions.length : 0;
        if (checkedCountEl) {
            checkedCountEl.innerText = `${dbCount} database + ${manCount} manual`;
        }
    }

    function renderManualQuestionsPreview() {
        const previewSection = document.getElementById("admin-rt-manual-preview-section");
        const previewList = document.getElementById("admin-rt-manual-preview-list");
        const countEl = document.getElementById("admin-rt-manual-count");
        
        if (!previewSection || !previewList || !countEl) return;
        const list = window.rtManualQuestions || [];
        countEl.innerText = list.length;

        if (list.length === 0) {
            previewSection.classList.add("hidden");
            return;
        }
        previewSection.classList.remove("hidden");
        previewList.innerHTML = "";

        list.forEach((q, idx) => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary); border:1px solid var(--border-color); padding:8px 12px; border-radius:6px; font-size:0.85rem;";
            div.innerHTML = `
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:230px; color:var(--text-primary); text-align:left;">
                    <strong>Q${idx+1}:</strong> ${q.text}
                </span>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteManualQuestion(${idx})" style="padding: 2px 6px; font-size:0.75rem; height:auto; margin-left:10px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            previewList.appendChild(div);
        });
    }

    window.deleteManualQuestion = function(idx) {
        if (window.rtManualQuestions && window.rtManualQuestions[idx]) {
            window.rtManualQuestions.splice(idx, 1);
            renderManualQuestionsPreview();
            updateCheckedCountDisplay();
        }
    };

    renderManualQuestionsPreview();

    // Bind manual add question button click
    const btnAddManual = document.getElementById("btn-admin-rt-add-manual");
    if (btnAddManual && !btnAddManual.dataset.bound) {
        btnAddManual.dataset.bound = "true";
        btnAddManual.onclick = () => {
            const promptText = document.getElementById("admin-rt-manual-text").value.trim();
            const optA = document.getElementById("admin-rt-manual-a").value.trim();
            const optB = document.getElementById("admin-rt-manual-b").value.trim();
            const optC = document.getElementById("admin-rt-manual-c").value.trim();
            const optD = document.getElementById("admin-rt-manual-d").value.trim();
            const optE = document.getElementById("admin-rt-manual-e").value.trim();
            const correctOption = document.getElementById("admin-rt-manual-correct").value;
            const explanation = document.getElementById("admin-rt-manual-explanation").value.trim();

            if (!promptText || !optA || !optB || !optC || !optD) {
                showToast("Missing Fields", "Please fill in the question prompt and Options A-D.", "warning");
                return;
            }

            const qObj = {
                id: "manual_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
                text: sanitizeHTML(promptText),
                options: { 
                    A: sanitizeHTML(optA), 
                    B: sanitizeHTML(optB), 
                    C: sanitizeHTML(optC), 
                    D: sanitizeHTML(optD) 
                },
                correctOption: correctOption,
                explanation: sanitizeHTML(explanation) || "Correct answer confirmed.",
                status: "unused",
                marked: false,
                notes: "",
                highlightedHtml: ""
            };
            if (optE) qObj.options.E = sanitizeHTML(optE);

            window.rtManualQuestions.push(qObj);

            // Clear form inputs
            document.getElementById("admin-rt-manual-text").value = "";
            document.getElementById("admin-rt-manual-a").value = "";
            document.getElementById("admin-rt-manual-b").value = "";
            document.getElementById("admin-rt-manual-c").value = "";
            document.getElementById("admin-rt-manual-d").value = "";
            document.getElementById("admin-rt-manual-e").value = "";
            document.getElementById("admin-rt-manual-explanation").value = "";

            showToast("Question Added", "Question successfully added to current mock exam draft.", "success");
            renderManualQuestionsPreview();
            updateCheckedCountDisplay();
        };
    }

    // 1. Render Questions Scroller with Checkboxes
    const searchQueryInput = document.getElementById("admin-rt-q-search");
    const query = searchQueryInput ? searchQueryInput.value.trim().toLowerCase() : "";

    // Group active group questions by topic
    const sourceQuestions = getGroupQuestionsSeed();
    const topicsMap = {};
    sourceQuestions.forEach(q => {
        if (!topicsMap[q.topic]) {
            topicsMap[q.topic] = [];
        }
        topicsMap[q.topic].push(q);
    });

    questionsListContainer.innerHTML = "";
    
    // Sort topics alphabetically or keep them sorted
    const topics = Object.keys(topicsMap).sort();
    let totalRenderedQuestions = 0;

    // Track checked state between search/re-renders
    if (!window.rtSelectedQuestionIds) {
        window.rtSelectedQuestionIds = new Set();
    }

    topics.forEach(topicName => {
        let topicQuestions = topicsMap[topicName];
        if (query) {
            topicQuestions = topicQuestions.filter(q => 
                q.text.toLowerCase().includes(query) || 
                Object.values(q.options).some(opt => opt.toLowerCase().includes(query))
            );
        }

        if (topicQuestions.length === 0) return;

        const topicGroup = document.createElement("div");
        topicGroup.className = "rt-topic-group";

        const header = document.createElement("div");
        header.className = "rt-topic-group-header";
        
        // Count checked questions in this topic
        const checkedInTopic = topicQuestions.filter(q => window.rtSelectedQuestionIds.has(q.id)).length;
        const selectAllText = checkedInTopic === topicQuestions.length ? "Deselect All" : "Select All";
        
        header.innerHTML = `
            <span>${topicName} (${topicQuestions.length} Qs)</span>
            <button type="button" class="rt-topic-select-all-btn" data-topic="${topicName}">${selectAllText}</button>
        `;

        const scrollerContent = document.createElement("div");
        
        topicQuestions.forEach(q => {
            totalRenderedQuestions++;
            const isChecked = window.rtSelectedQuestionIds.has(q.id) ? "checked" : "";
            const checkboxItem = document.createElement("label");
            checkboxItem.className = "rt-question-checkbox-item";
            checkboxItem.innerHTML = `
                <input type="checkbox" data-id="${q.id}" ${isChecked}>
                <span>${q.text.substring(0, 100)}${q.text.length > 100 ? "..." : ""}</span>
            `;

            // Listen to checkbox changes
            const checkbox = checkboxItem.querySelector('input[type="checkbox"]');
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    window.rtSelectedQuestionIds.add(q.id);
                } else {
                    window.rtSelectedQuestionIds.delete(q.id);
                }
                updateCheckedCountDisplay();
                
                // Update topic header button
                const updatedCheckedInTopic = topicQuestions.filter(q => window.rtSelectedQuestionIds.has(q.id)).length;
                header.querySelector(".rt-topic-select-all-btn").innerText = 
                    updatedCheckedInTopic === topicQuestions.length ? "Deselect All" : "Select All";
            });

            scrollerContent.appendChild(checkboxItem);
        });

        // Setup Select/Deselect All listener
        const selectAllBtn = header.querySelector(".rt-topic-select-all-btn");
        selectAllBtn.onclick = () => {
            const currentCheckedInTopic = topicQuestions.filter(q => window.rtSelectedQuestionIds.has(q.id)).length;
            if (currentCheckedInTopic === topicQuestions.length) {
                // Deselect all
                topicQuestions.forEach(q => window.rtSelectedQuestionIds.delete(q.id));
            } else {
                // Select all
                topicQuestions.forEach(q => window.rtSelectedQuestionIds.add(q.id));
            }
            // Re-render scroller to reflect correct check states
            renderAdminReportTasksTab();
        };

        topicGroup.appendChild(header);
        topicGroup.appendChild(scrollerContent);
        questionsListContainer.appendChild(topicGroup);
    });

    if (totalRenderedQuestions === 0) {
        questionsListContainer.innerHTML = `<span class="text-muted" style="padding:15px;display:block;text-align:center">No matching questions found.</span>`;
    }

    updateCheckedCountDisplay();

    // 2. Render Existing Report Tasks
    reportTasksListContainer.innerHTML = "";
    const publishedTasks = state.reportTasks;

    if (publishedTasks.length === 0) {
        reportTasksListContainer.innerHTML = `<span class="text-muted" style="padding:15px;display:block;text-align:center">No mock exams published yet.</span>`;
    }

    publishedTasks.forEach(rt => {
        const item = document.createElement("div");
        item.className = "admin-q-item";
        item.innerHTML = `
            <div class="admin-q-content">
                <h4 style="color:var(--text-primary); font-weight:700;">${rt.title}</h4>
                <div class="rt-card-meta" style="margin-top:6px; margin-bottom:0;">
                    <span class="rt-meta-badge"><i class="fa-regular fa-clock"></i> ${rt.duration} Min</span>
                    <span class="rt-meta-badge"><i class="fa-solid fa-list-check"></i> ${rt.questions.length} Questions</span>
                    <span class="rt-meta-badge"><i class="fa-regular fa-calendar"></i> ${rt.dateCreated}</span>
                </div>
            </div>
            <div class="admin-q-actions">
                <button class="btn btn-danger" style="padding:6px 12px;font-size:0.8rem" onclick="deleteReportTaskAdmin('${rt.id}')">
                    <i class="fa-regular fa-trash-can"></i> Delete
                </button>
            </div>
        `;
        reportTasksListContainer.appendChild(item);
    });

    // Form submit listener
    const form = document.getElementById("admin-report-task-form");
    if (form && !form.dataset.bound) {
        form.dataset.bound = "true";
        form.onsubmit = (e) => {
            e.preventDefault();
            const title = document.getElementById("admin-rt-title").value.trim();
            const duration = document.getElementById("admin-rt-duration").value;
            
            if (!title) {
                showToast("Title Required", "Please enter an exam title.", "danger");
                return;
            }
            if (!duration || duration <= 0) {
                showToast("Invalid Duration", "Please enter a valid exam duration in minutes.", "danger");
                return;
            }
            const dbCount = window.rtSelectedQuestionIds ? window.rtSelectedQuestionIds.size : 0;
            const manualCount = window.rtManualQuestions ? window.rtManualQuestions.length : 0;
            if (dbCount === 0 && manualCount === 0) {
                showToast("No Questions Selected", "Please select at least one database question or add a manual question to build the exam.", "danger");
                return;
            }

            // Collect selected question details from the group's questions seed
            const sourceQuestions = getGroupQuestionsSeed();
            const selectedQs = sourceQuestions.filter(q => window.rtSelectedQuestionIds.has(q.id)).map(q => {
                return {
                    id: q.id,
                    source: q.source,
                    topic: q.topic,
                    text: q.text,
                    options: { ...q.options },
                    correctOption: q.correctOption,
                    explanation: q.explanation || "Correct answer confirmed.",
                    status: "unused",
                    marked: false,
                    notes: "",
                    highlightedHtml: ""
                };
            });

            // Append manually created questions
            if (window.rtManualQuestions && window.rtManualQuestions.length > 0) {
                selectedQs.push(...window.rtManualQuestions);
            }

            const newRt = {
                id: "rt_" + Date.now(),
                title: title,
                duration: parseInt(duration),
                questions: selectedQs,
                dateCreated: new Date().toLocaleDateString()
            };

            state.reportTasks.push(newRt);
            saveStateToStorage();
            
            // Sync report task to Supabase cloud
            saveReportTaskToCloud(newRt);

            showToast("Mock Exam Published", `Successfully created "${title}" with ${selectedQs.length} questions.`, "success");
            
            // Reset state
            form.reset();
            window.rtSelectedQuestionIds = new Set();
            window.rtManualQuestions = [];
            
            // Re-render
            renderAdminReportTasksTab();
            
            // Update student and dashboard widgets
            updateDashboardStats();
            if (state.activeView === "report-task") {
                renderReportTaskStudentView();
            }
        };
    }

    const searchInput = document.getElementById("admin-rt-q-search");
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener("input", () => {
            renderAdminReportTasksTab();
        });
    }
}

window.deleteReportTaskAdmin = async function(id) {
    if (confirm("Are you sure you want to delete this mock exam?")) {
        state.reportTasks = state.reportTasks.filter(rt => rt.id !== id);
        saveStateToStorage();
        
        // Delete mock exam from Supabase cloud
        await deleteReportTaskFromCloud(id);
        
        showToast("Mock Exam Deleted", "The mock exam has been deleted.", "warning");
        renderAdminReportTasksTab();
        updateDashboardStats();
        if (state.activeView === "report-task") {
            renderReportTaskStudentView();
        }
    }
};

function loadUserSpecificProgress(email) {
    const user = state.users.find(u => u.email === email);
    if (!user) return;

    // Load base questions and merge with global template or seed for the active course
    const rawUserQuestions = Array.isArray(user.questions) ? user.questions : [];
    state.questions = mergeQuestionsWithGlobal(rawUserQuestions, globalQuestionsCache, state.activeGroup);

    // Load or initialize tests
    state.tests = Array.isArray(user.tests) ? user.tests : [];

    // Load or initialize notebook notes
    state.notebookNotes = Array.isArray(user.notebookNotes) ? user.notebookNotes : [];

    // Load or initialize flashcards (course isolated seed)
    if (Array.isArray(user.flashcards) && user.flashcards.length > 0) {
        state.flashcards = user.flashcards.map(c => normalizeSm2Card(c));
    } else {
        const isDerma = (state.activeGroup || "").toLowerCase() === "dermatology";
        const seedCards = isDerma ? [
            {
                id: "fc_derma_1",
                deck: "Papulosquamous Disorders",
                category: "Papulosquamous Disorders",
                front: "What is the Auspitz sign in Psoriasis?",
                back: "Pinpoint bleeding after the removal of psoriatic scales due to thinned suprapapillary plates over dilated capillaries.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_derma_2",
                deck: "Infectious Dermatology",
                category: "Infectious Dermatology",
                front: "What is the pathognomonic clinical feature of Scabies?",
                back: "Intensely pruritic, serpiginous burrows in web spaces of fingers, wrists, and genitalia, worse at night.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_derma_3",
                deck: "Autoimmune Bullous",
                category: "Autoimmune Bullous",
                front: "How do Pemphigus Vulgaris and Bullous Pemphigoid differ regarding Nikolsky's sign?",
                back: "Pemphigus Vulgaris is Nikolsky-positive (intraepidermal blister); Bullous Pemphigoid is Nikolsky-negative (subepidermal blister).",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_derma_4",
                deck: "Dermatological Oncology",
                category: "Dermatological Oncology",
                front: "What are the ABCDE criteria for Melanoma evaluation?",
                back: "Asymmetry, Border irregularity, Color variegation, Diameter (>6mm), Evolution/Enlargement over time.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_derma_5",
                deck: "Drug Eruptions",
                category: "Drug Eruptions",
                front: "What distinguishes Stevens-Johnson Syndrome (SJS) from Toxic Epidermal Necrolysis (TEN)?",
                back: "Body surface area (BSA) epidermal detachment: SJS < 10%, SJS/TEN overlap 10-30%, TEN > 30%.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            }
        ] : [
            {
                id: "fc_1",
                deck: "Virology",
                category: "Virology",
                front: "What is the primary mode of transmission of Rift Valley Fever virus to humans?",
                back: "Direct contact with blood/body fluids of infected animals (e.g. during slaughtering or veterinary procedures), or mosquito bites.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_2",
                deck: "Bacteriology",
                category: "Bacteriology",
                front: "What is the recommended antibiotic combination for treating Brucellosis?",
                back: "Doxycycline + Rifampicin (or Streptomycin/Gentamicin).",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_3",
                deck: "Meningitis",
                category: "Meningitis",
                front: "What CSF profile findings suggest Tuberculous Meningitis?",
                back: "Cloudy appearance, elevated opening pressure, raised protein count, extremely low glucose level, and lymphocyte predominance (e.g. 70-98% lymphocytes).",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_4",
                deck: "Pharmacology",
                category: "Pharmacology",
                front: "What is the drug of choice for treating invasive Aspergillosis?",
                back: "Voriconazole.",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            },
            {
                id: "fc_5",
                deck: "Infection Control",
                category: "Infection Control",
                front: "What type of hand hygiene is required for contact with Clostridium difficile spores?",
                back: "Washing hands with soap and water (alcohol-based hand rubs are ineffective against C. difficile spores).",
                status: "review",
                state: "new",
                repetitions: 0,
                interval: 0,
                easeFactor: 2.5,
                nextReviewDate: 0,
                lastReviewDate: null,
                isOfficial: true
            }
        ];
        state.flashcards = seedCards.map(c => normalizeSm2Card(c));
    }

    // Load or initialize report task progress
    if (!user.reportTaskProgress || typeof user.reportTaskProgress !== "object") {
        user.reportTaskProgress = {};
    }

    state.isUserProgressLoaded = true;
}

function initBackupRestoreFlow() {
    const btnExport = document.getElementById("btn-export-backup");
    const btnImport = document.getElementById("btn-import-backup");
    const fileInput = document.getElementById("input-import-backup-file");

    if (btnExport) {
        btnExport.onclick = () => {
            if (!state.currentUser) return;
            
            // Build package object
            const packageObj = {
                email: state.currentUser.email,
                questions: state.questions,
                tests: state.tests,
                notebookNotes: state.notebookNotes,
                flashcards: state.flashcards,
                timestamp: Date.now()
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(packageObj, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            
            const sanitizedEmail = state.currentUser.email.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            downloadAnchor.setAttribute("download", `hawari_progress_${sanitizedEmail}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();

            showToast("Backup Created", "Your progress backup JSON file has been downloaded successfully.", "success");
        };
    }

    if (btnImport && fileInput) {
        btnImport.onclick = () => {
            fileInput.click();
        };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    
                    // Simple verification
                    if (!parsed.email || !Array.isArray(parsed.questions)) {
                        showToast("Invalid Backup File", "This JSON file is not a valid Hawari Course progress backup.", "danger");
                        return;
                    }

                    if (parsed.email !== state.currentUser.email) {
                        if (!confirm(`Warning: This backup belongs to another user (${parsed.email}). Do you want to overwrite your progress (${state.currentUser.email}) with their data?`)) {
                            return;
                        }
                    }

                    // Restore
                    state.questions = parsed.questions;
                    state.tests = parsed.tests || [];
                    state.notebookNotes = parsed.notebookNotes || [];
                    state.flashcards = parsed.flashcards || [];

                    saveStateToStorage();
                    showToast("Restore Success", "Your progress and notebook notes have been restored successfully!", "success");

                    // Reload page views
                    setTimeout(() => {
                        window.location.reload();
                    }, 800);
                } catch (err) {
                    showToast("Error Parsing File", "Could not parse backup file.", "danger");
                }
            };
            reader.readAsText(file);
        };
    }
}

function renderReportTaskStudentView() {
    initStudentReportTabs();
    const container = document.getElementById("student-report-tasks-container");
    if (!container) return;

    container.innerHTML = "";
    
    // Merge standard report tasks and archived quizzes
    const now = new Date().getTime();
    const archivedQuizzes = state.courseQuizzes.filter(qz => {
        const end = new Date(qz.endTime).getTime();
        return qz.status === 'moved_to_reports' || now > end;
    }).map(qz => {
        return {
            id: qz.id,
            title: `[Quiz] ${qz.title}`,
            duration: qz.duration,
            questions: qz.questions,
            isQuizArchive: true
        };
    });

    const publishedTasks = [...state.reportTasks, ...archivedQuizzes];

    if (publishedTasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center; background: var(--bg-secondary); border-radius: 16px; border: 1px solid var(--border-color);">
                <i class="fa-solid fa-file-signature" style="font-size: 3rem; color: var(--text-muted); margin-bottom: 15px;"></i>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">No active mock exams published</h3>
                <p class="text-muted">Your coordinator has not posted any report tasks or practice quizzes for this track yet.</p>
            </div>
        `;
        return;
    }

    publishedTasks.forEach(rt => {
        let statusHtml = "";
        let scoreHtml = "";
        let buttonHtml = "";

        if (rt.isQuizArchive) {
            // Find quiz results
            const result = state.quizResults.find(r => r.quiz_id === rt.id && r.email === state.currentUser.email);
            if (result) {
                const isFailed = result.status === 'failed';
                statusHtml = isFailed
                    ? `<div class="rt-status-indicator rt-status-inprogress" style="background-color: var(--color-danger-soft); color: var(--color-danger);"><i class="fa-solid fa-circle-xmark"></i> Failed (Left Quiz)</div>`
                    : `<div class="rt-status-indicator rt-status-completed"><i class="fa-solid fa-circle-check"></i> Solved (Practice)</div>`;
                
                scoreHtml = `<div class="rt-score-display">${result.score}%</div>`;
                buttonHtml = `
                    <div style="display: flex; gap: 8px; flex-direction: column;">
                        <button class="btn btn-secondary btn-block" onclick="reviewCourseQuizStudent('${rt.id}')">
                            <i class="fa-solid fa-chart-pie"></i> Review Results
                        </button>
                        <button class="btn btn-primary btn-block btn-outline" onclick="retakeCourseQuizStudent('${rt.id}')">
                            <i class="fa-solid fa-rotate-right"></i> Retake Quiz
                        </button>
                    </div>
                `;
            } else {
                statusHtml = `<div class="rt-status-indicator rt-status-unsolved"><i class="fa-regular fa-circle"></i> Unsolved Practice</div>`;
                scoreHtml = `<div style="font-size:0.9rem; color:var(--text-muted); margin: 15px 0;">Archived quiz (Practice)</div>`;
                buttonHtml = `
                    <button class="btn btn-primary btn-block" onclick="startCourseQuizStudent('${rt.id}')">
                        <i class="fa-solid fa-play"></i> Start Practice Quiz
                    </button>
                `;
            }
        } else {
            // Look up current user progress for Mock Exams
            const userRecord = state.users.find(u => u.email === state.currentUser.email);
            const progress = (userRecord && userRecord.reportTaskProgress) ? userRecord.reportTaskProgress[rt.id] : null;

            if (progress) {
                if (progress.completed) {
                    statusHtml = `<div class="rt-status-indicator rt-status-completed"><i class="fa-solid fa-circle-check"></i> Solved</div>`;
                    scoreHtml = `<div class="rt-score-display">${progress.score}%</div>`;
                    buttonHtml = `
                        <div style="display: flex; gap: 8px; flex-direction: column;">
                            <button class="btn btn-secondary btn-block" onclick="reviewReportTaskStudent('${rt.id}')">
                                <i class="fa-solid fa-chart-pie"></i> Review Results
                            </button>
                            <button class="btn btn-primary btn-block btn-outline" onclick="retakeReportTaskStudent('${rt.id}')">
                                <i class="fa-solid fa-rotate-right"></i> Retake Exam
                            </button>
                        </div>
                    `;
                } else {
                    statusHtml = `<div class="rt-status-indicator rt-status-inprogress"><i class="fa-solid fa-circle-play"></i> In Progress</div>`;
                    scoreHtml = `<div style="font-size:0.9rem; color:var(--text-secondary); margin: 15px 0;">Suspended with ${Object.keys(progress.answers || {}).length} answered</div>`;
                    buttonHtml = `
                        <button class="btn btn-primary btn-block" onclick="startReportTaskStudent('${rt.id}')">
                            <i class="fa-solid fa-rotate-right"></i> Resume Mock Exam
                        </button>
                    `;
                }
            } else {
                statusHtml = `<div class="rt-status-indicator rt-status-unsolved"><i class="fa-regular fa-circle"></i> Unsolved</div>`;
                scoreHtml = `<div style="font-size:0.9rem; color:var(--text-muted); margin: 15px 0;">Ready to start</div>`;
                buttonHtml = `
                    <button class="btn btn-primary btn-block" onclick="startReportTaskStudent('${rt.id}')">
                        <i class="fa-solid fa-play"></i> Start Mock Exam
                    </button>
                `;
            }
        }

        const card = document.createElement("div");
        card.className = "report-task-card";
        card.innerHTML = `
            <div>
                ${statusHtml}
                <h3 style="color:var(--text-primary); font-weight:700; font-size:1.2rem; margin-top:8px;">${rt.title}</h3>
                <div class="rt-card-meta">
                    <span class="rt-meta-badge"><i class="fa-regular fa-clock"></i> ${rt.duration} Min</span>
                    <span class="rt-meta-badge"><i class="fa-solid fa-list-check"></i> ${rt.questions.length} Questions</span>
                </div>
                ${scoreHtml}
            </div>
            <div style="margin-top: 15px;">
                ${buttonHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

window.retakeReportTaskStudent = function(rtId) {
    if (!confirm("Are you sure you want to retake this exam? This will clear your current score and progress for this mock exam.")) return;
    const userRecord = state.users.find(u => u.email === state.currentUser.email);
    if (userRecord && userRecord.reportTaskProgress) {
        delete userRecord.reportTaskProgress[rtId];
        saveStateToStorage();
        showToast("Exam Reset", "You can now start the exam again.", "success");
        renderReportTaskStudentView();
    }
};

window.retakeCourseQuizStudent = async function(quizId) {
    if (!confirm("Are you sure you want to retake this quiz? This will delete your current score and allow you to re-solve it.")) return;
    
    // Optimistic UI updates: update local state immediately so user sees changes instantly
    state.quizResults = state.quizResults.filter(res => res.quiz_id !== quizId || res.email !== state.currentUser.email);
    renderReportTaskStudentView();
    showToast("Quiz Reset", "You can now start the quiz again.", "success");

    try {
        const id = `${quizId}_${state.currentUser.email}`;
        await supabaseRequest(`hawari_quiz_results?id=eq.${id}`, {
            method: "DELETE"
        });
        await fetchQuizResults(state.activeGroup);
    } catch (e) {
        console.error("Failed to retake course quiz:", e);
    }
};

function initStudentReportTabs() {
    const btnReportTasks = document.getElementById("btn-tab-report-tasks");
    const btnCourseQuizzes = document.getElementById("btn-tab-course-quizzes");
    const subviewReportTasks = document.getElementById("subview-report-tasks");
    const subviewCourseQuizzes = document.getElementById("subview-course-quizzes");

    if (btnReportTasks && btnCourseQuizzes && subviewReportTasks && subviewCourseQuizzes) {
        // Remove existing listener to prevent double binding
        const clone1 = btnReportTasks.cloneNode(true);
        const clone2 = btnCourseQuizzes.cloneNode(true);
        btnReportTasks.parentNode.replaceChild(clone1, btnReportTasks);
        btnCourseQuizzes.parentNode.replaceChild(clone2, btnCourseQuizzes);

        clone1.addEventListener("click", () => {
            clone1.classList.add("active");
            clone2.classList.remove("active");
            subviewReportTasks.classList.remove("hidden");
            subviewCourseQuizzes.classList.add("hidden");
            renderReportTaskStudentView();
        });

        clone2.addEventListener("click", () => {
            clone2.classList.add("active");
            clone1.classList.remove("active");
            subviewCourseQuizzes.classList.remove("hidden");
            subviewReportTasks.classList.add("hidden");
            renderCourseQuizzesStudentView();
        });
    }
}

function renderCourseQuizzesStudentView() {
    const container = document.getElementById("student-course-quizzes-container");
    if (!container) return;

    container.innerHTML = "";
    
    const now = new Date().getTime();
    
    // Filter quizzes that have not expired or been moved to reports yet
    const quizzes = state.courseQuizzes.filter(qz => {
        const end = new Date(qz.endTime).getTime();
        return qz.status !== 'moved_to_reports' && now <= end;
    });

    if (quizzes.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 40px; text-align: center; background: var(--bg-secondary); border-radius: 16px; border: 1px solid var(--border-color);">
                <i class="fa-solid fa-graduation-cap" style="font-size: 3rem; color: var(--text-muted); margin-bottom: 15px;"></i>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">No active or upcoming quizzes</h3>
                <p class="text-muted">There are no course quizzes currently scheduled.</p>
            </div>
        `;
        return;
    }

    quizzes.forEach(qz => {
        const start = new Date(qz.startTime).getTime();
        const result = state.quizResults.find(r => r.quiz_id === qz.id && r.email === state.currentUser.email);

        let statusHtml = "";
        let scoreHtml = "";
        let buttonHtml = "";

        if (result) {
            const isFailed = result.status === 'failed';
            statusHtml = isFailed
                ? `<div class="rt-status-indicator rt-status-inprogress" style="background-color: var(--color-danger-soft); color: var(--color-danger);"><i class="fa-solid fa-circle-xmark"></i> Failed (Left Exam)</div>`
                : `<div class="rt-status-indicator rt-status-completed"><i class="fa-solid fa-circle-check"></i> Submitted</div>`;
            
            scoreHtml = `<div class="rt-score-display">${result.score}%</div>`;
            buttonHtml = `
                <button class="btn btn-secondary btn-block" disabled>
                    <i class="fa-solid fa-lock"></i> Submitted (Locked until Quiz Ends)
                </button>
            `;
        } else if (now < start) {
            // Scheduled/Upcoming Quiz
            statusHtml = `<div class="rt-status-indicator rt-status-unsolved" style="background-color: var(--border-color); color: var(--text-muted);"><i class="fa-regular fa-calendar"></i> Upcoming</div>`;
            scoreHtml = `<div style="font-size:0.9rem; color:var(--text-muted); margin: 15px 0;">Opens: ${new Date(qz.startTime).toLocaleString()}</div>`;
            buttonHtml = `
                <button class="btn btn-secondary btn-block" disabled style="cursor: not-allowed; opacity: 0.6;">
                    <i class="fa-solid fa-lock"></i> Not Active Yet (Opens: ${new Date(qz.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})
                </button>
            `;
        } else {
            // Active Quiz
            statusHtml = `<div class="rt-status-indicator rt-status-unsolved" style="background-color: var(--color-success-soft); color: var(--color-success);"><i class="fa-solid fa-play"></i> Active</div>`;
            scoreHtml = `<div style="font-size:0.9rem; color:var(--text-secondary); margin: 15px 0;">Ends: ${new Date(qz.endTime).toLocaleString()}</div>`;
            buttonHtml = `
                <button class="btn btn-primary btn-block" onclick="startCourseQuizStudent('${qz.id}')">
                    <i class="fa-solid fa-pen-nib"></i> Start Strict Quiz
                </button>
            `;
        }

        const card = document.createElement("div");
        card.className = "report-task-card";
        card.innerHTML = `
            <div>
                ${statusHtml}
                <h3 style="color:var(--text-primary); font-weight:700; font-size:1.2rem; margin-top:8px;">${qz.title}</h3>
                <div class="rt-card-meta">
                    <span class="rt-meta-badge"><i class="fa-regular fa-clock"></i> ${qz.duration} Min</span>
                    <span class="rt-meta-badge"><i class="fa-solid fa-list-check"></i> ${qz.questions.length} Questions</span>
                </div>
                ${scoreHtml}
            </div>
            <div style="margin-top: 15px;">
                ${buttonHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

window.startReportTaskStudent = function(rtId) {
    const rt = state.reportTasks.find(t => t.id === rtId);
    if (!rt) return;

    // Look up current user progress
    const userRecord = state.users.find(u => u.email === state.currentUser.email);
    if (!userRecord) return;
    if (!userRecord.reportTaskProgress) userRecord.reportTaskProgress = {};
    const progress = userRecord.reportTaskProgress[rt.id];

    let testObj = {
        id: rt.id,
        name: rt.title,
        mode: "timed",
        timeRemaining: rt.duration * 60,
        questionIds: rt.questions.map(q => q.id),
        answers: {},
        flaggedQuestions: []
    };

    if (progress) {
        testObj.answers = { ...progress.answers };
        testObj.flaggedQuestions = [...(progress.flaggedQuestions || [])];
        testObj.timeRemaining = progress.timeRemaining !== undefined ? progress.timeRemaining : rt.duration * 60;
    } else {
        // Initialize user progress record
        userRecord.reportTaskProgress[rt.id] = {
            answers: {},
            flaggedQuestions: [],
            timeRemaining: rt.duration * 60,
            completed: false
        };
        saveStateToStorage();
    }

    // Launch active test screen with immutable question snapshot
    state.activeTest = {
        testId: rt.id,
        currentQuestionIdx: 0,
        selectedAnswers: { ...testObj.answers },
        flaggedQuestions: new Set(testObj.flaggedQuestions),
        questionIds: [...testObj.questionIds],
        mode: "timed",
        timeRemaining: testObj.timeRemaining,
        isReportTask: true,
        rtId: rt.id,
        rtQuestions: JSON.parse(JSON.stringify(rt.questions || [])),
        rtDuration: rt.duration
    };

    // Show Fullscreen modal
    document.getElementById("active-test-overlay").classList.remove("hidden");
    document.body.style.overflow = "hidden"; // Disable background scrolling

    // UI headers
    document.getElementById("active-test-title-lbl").innerText = rt.title;
    document.getElementById("active-test-mode-lbl").innerText = "Timed Mode";
    document.getElementById("active-test-mode-lbl").style.backgroundColor = "var(--color-warning-soft)";
    document.getElementById("active-test-mode-lbl").style.color = "var(--color-warning)";

    initTestControls();
    
    // Customize Suspend and Submit buttons for Report Tasks
    document.getElementById("btn-submit-active-test").classList.remove("hidden");
    document.getElementById("btn-suspend-active-test").innerHTML = `Suspend <i class="fa-solid fa-pause"></i>`;
    document.getElementById("btn-suspend-active-test").className = "btn btn-secondary btn-outline";
    document.getElementById("btn-suspend-active-test").onclick = () => {
        suspendActiveTest();
    };

    // Load first question
    loadTestQuestion(0);

    // Setup timer countdown
    const timerText = document.getElementById("test-timer-text");
    const timerWrapper = document.getElementById("test-timer-wrapper");
    timerWrapper.classList.remove("hidden");
    updateTimerText(state.activeTest.timeRemaining);
    
    if (testTimerInterval) clearInterval(testTimerInterval);
    testTimerInterval = setInterval(() => {
        state.activeTest.timeRemaining--;
        updateTimerText(state.activeTest.timeRemaining);
        
        // Save time progress periodically (every 5 seconds) to avoid losing timer state on page reloads
        if (state.activeTest.timeRemaining % 5 === 0) {
            const currentRecord = state.users.find(u => u.email === state.currentUser.email);
            if (currentRecord && currentRecord.reportTaskProgress && currentRecord.reportTaskProgress[rt.id]) {
                currentRecord.reportTaskProgress[rt.id].timeRemaining = state.activeTest.timeRemaining;
                saveStateToStorage();
            }
        }
        
        if (state.activeTest.timeRemaining <= 0) {
            clearInterval(testTimerInterval);
            showToast("Time's Up!", "Your mock exam timer has expired. Submitting automatically.", "warning");
            submitActiveTest();
        }
    }, 1000);
};

window.reviewReportTaskStudent = function(rtId) {
    const rt = state.reportTasks.find(t => t.id === rtId);
    if (!rt) return;

    // Look up current user progress
    const userRecord = state.users.find(u => u.email === state.currentUser.email);
    if (!userRecord || !userRecord.reportTaskProgress) return;
    const progress = userRecord.reportTaskProgress[rt.id];
    if (!progress) return;

    // We open the test overlay in complete mode. Locked questions, answers visible.
    state.activeTest = {
        testId: rt.id,
        currentQuestionIdx: 0,
        selectedAnswers: { ...progress.answers },
        flaggedQuestions: new Set(progress.flaggedQuestions || []),
        questionIds: rt.questions.map(q => q.id),
        mode: "tutor", // Force tutor display (explanations visible)
        timeRemaining: progress.timeRemaining || 0,
        isCompletedReview: true,
        isReportTask: true,
        rtId: rt.id,
        rtQuestions: rt.questions
    };

    document.getElementById("active-test-overlay").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    
    document.getElementById("active-test-title-lbl").innerText = `${rt.title} (Review)`;
    document.getElementById("active-test-mode-lbl").innerText = "Review Mode";
    document.getElementById("active-test-mode-lbl").style.backgroundColor = "var(--color-success-soft)";
    document.getElementById("active-test-mode-lbl").style.color = "var(--color-success)";

    initTestControls();
    
    // Hide submitting options in review
    document.getElementById("btn-submit-active-test").classList.add("hidden");
    document.getElementById("btn-suspend-active-test").innerHTML = `Exit Review <i class="fa-solid fa-right-from-bracket"></i>`;
    document.getElementById("btn-suspend-active-test").className = "btn btn-secondary";
    
    document.getElementById("btn-suspend-active-test").onclick = () => {
        state.activeTest = null;
        document.getElementById("active-test-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";
        
        // Restore button functions
        document.getElementById("btn-submit-active-test").classList.remove("hidden");
        document.getElementById("btn-suspend-active-test").innerHTML = `Suspend <i class="fa-solid fa-pause"></i>`;
        document.getElementById("btn-suspend-active-test").className = "btn btn-secondary btn-outline";
        
        // Return to report task view
        renderReportTaskStudentView();
    };

    // Load first question
    loadTestQuestion(0);
};

function updateDashboardStats() {
    const solvedEl = document.getElementById("stat-rt-solved");
    const unsolvedEl = document.getElementById("stat-rt-unsolved");
    if (!solvedEl || !unsolvedEl) return;

    if (!state.currentUser) {
        solvedEl.innerText = "0";
        unsolvedEl.innerText = "0";
        return;
    }

    const userRecord = state.users.find(u => u.email === state.currentUser.email);
    const progressMap = (userRecord && userRecord.reportTaskProgress) ? userRecord.reportTaskProgress : {};
    
    const publishedTasks = state.reportTasks;
    let solvedCount = 0;
    
    publishedTasks.forEach(rt => {
        const prog = progressMap[rt.id];
        if (prog && prog.completed) {
            solvedCount++;
        }
    });

    const unsolvedCount = publishedTasks.length - solvedCount;

    solvedEl.innerText = solvedCount;
    unsolvedEl.innerText = unsolvedCount;
}

// ================= COURSE QUIZ STRICT WORKSPACE & FLOW =================
let quizTimerInterval = null;

window.startCourseQuizStudent = function(quizId) {
    const qz = state.courseQuizzes.find(q => q.id === quizId);
    if (!qz) return;

    const result = state.quizResults.find(r => r.quiz_id === quizId && r.email === state.currentUser.email);
    if (result) {
        showToast("Error", "You have already submitted this quiz.", "danger");
        return;
    }

    const isPractice = qz.status === "moved_to_reports" || new Date().getTime() > new Date(qz.endTime).getTime();

    if (isPractice) {
        if (!confirm("هل تريد بدء هذا الاختبار كتدريب؟")) return;
    } else {
        if (!confirm("هل أنت مستعد لبدء الاختبار؟ بمجرد البدء، لا يمكنك مغادرة الصفحة أو تحديثها وإلا ستحصل على درجة صفر.")) {
            return;
        }
        localStorage.setItem("active_quiz_session", quizId);
    }

    // Deep immutable snapshot of exam questions to isolate active exam from background cache updates
    state.activeQuiz = {
        quizId: qz.id,
        title: qz.title,
        questions: JSON.parse(JSON.stringify(qz.questions || [])),
        answers: {},
        currentQuestionIdx: 0,
        timeRemaining: qz.duration * 60,
        isPractice: isPractice,
        startedAt: Date.now()
    };

    const overlay = document.getElementById("active-quiz-overlay");
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const sidebar = document.querySelector(".sidebar");
    if (sidebar) sidebar.classList.add("hidden");
    const appLayout = document.getElementById("app-layout");
    if (appLayout) appLayout.style.gridTemplateColumns = "1fr";

    overlay.oncopy = (e) => e.preventDefault();
    overlay.oncut = (e) => e.preventDefault();
    overlay.oncontextmenu = (e) => e.preventDefault();

    document.getElementById("btn-prev-quiz-q").onclick = () => {
        if (state.activeQuiz.currentQuestionIdx > 0) {
            loadQuizQuestion(state.activeQuiz.currentQuestionIdx - 1);
        }
    };

    document.getElementById("btn-next-quiz-q").onclick = () => {
        if (state.activeQuiz.currentQuestionIdx < state.activeQuiz.questions.length - 1) {
            loadQuizQuestion(state.activeQuiz.currentQuestionIdx + 1);
        }
    };

    const submitBtn = document.getElementById("btn-submit-active-quiz");
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Submit Exam`;
    }

    document.getElementById("btn-submit-active-quiz").onclick = () => {
        if (confirm("هل أنت متأكد من تسليم الإجابات وإنهاء الاختبار؟")) {
            submitActiveQuiz();
        }
    };

    const timerText = document.getElementById("quiz-timer-text");
    const updateQuizTimer = () => {
        const m = Math.floor(state.activeQuiz.timeRemaining / 60);
        const s = state.activeQuiz.timeRemaining % 60;
        timerText.innerText = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };
    updateQuizTimer();

    if (quizTimerInterval) clearInterval(quizTimerInterval);
    quizTimerInterval = setInterval(() => {
        state.activeQuiz.timeRemaining--;
        updateQuizTimer();

        if (state.activeQuiz.timeRemaining <= 0) {
            clearInterval(quizTimerInterval);
            showToast("Time's Up", "انتهى الوقت المحدد للاختبار. يتم التسليم تلقائياً.", "warning");
            submitActiveQuiz();
        }
    }, 1000);

    loadQuizQuestion(0);
};

function loadQuizQuestion(idx) {
    if (!state.activeQuiz) return;
    state.activeQuiz.currentQuestionIdx = idx;

    const q = state.activeQuiz.questions[idx];
    const total = state.activeQuiz.questions.length;

    document.getElementById("active-quiz-q-index").innerText = `Question ${idx + 1} of ${total}`;
    document.getElementById("active-quiz-q-body").innerHTML = sanitizeRichHTML(q.text || "");

    const container = document.getElementById("active-quiz-options-container");
    container.innerHTML = "";

    const options = q.options || [];
    options.forEach((optText, optIdx) => {
        const optBtn = document.createElement("button");
        optBtn.className = "choice-btn";
        
        const label = String.fromCharCode(65 + optIdx);
        optBtn.innerHTML = `
            <span class="choice-letter">${label}</span>
            <div class="choice-text">${sanitizeHTML(optText)}</div>
        `;

        if (state.activeQuiz.answers[idx] === optIdx) {
            optBtn.classList.add("selected");
        }

        optBtn.onclick = () => {
            selectQuizOption(idx, optIdx);
        };

        container.appendChild(optBtn);
    });

    const prevBtn = document.getElementById("btn-prev-quiz-q");
    const nextBtn = document.getElementById("btn-next-quiz-q");

    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === total - 1;

    renderQuizSidebarGrid();
}

function selectQuizOption(qIdx, optIdx) {
    if (!state.activeQuiz) return;
    state.activeQuiz.answers[qIdx] = optIdx;
    loadQuizQuestion(qIdx);
}

function renderQuizSidebarGrid() {
    const grid = document.getElementById("active-quiz-questions-grid");
    if (!grid || !state.activeQuiz) return;

    grid.innerHTML = "";

    const questions = state.activeQuiz.questions;
    const answers = state.activeQuiz.answers;
    const currentIdx = state.activeQuiz.currentQuestionIdx;
    const isReview = state.activeQuiz.isReview;

    questions.forEach((q, idx) => {
        const btn = document.createElement("button");
        btn.style.cssText = "width: 35px; height: 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s; box-sizing: border-box; outline: none; border: 1.5px solid transparent; margin: auto;";
        btn.innerText = idx + 1;

        const isAnswered = answers[idx] !== undefined;

        if (isReview) {
            const correctAns = parseInt(q.correctOption);
            const userAns = answers[idx];
            
            if (userAns === undefined) {
                btn.style.borderColor = "var(--color-danger)";
                btn.style.color = "var(--color-danger)";
                btn.style.backgroundColor = "transparent";
            } else if (parseInt(userAns) === correctAns) {
                btn.style.backgroundColor = "var(--color-success)";
                btn.style.borderColor = "var(--color-success)";
                btn.style.color = "#ffffff";
            } else {
                btn.style.backgroundColor = "var(--color-danger)";
                btn.style.borderColor = "var(--color-danger)";
                btn.style.color = "#ffffff";
            }
        } else {
            if (isAnswered) {
                btn.style.backgroundColor = "var(--color-success)";
                btn.style.borderColor = "var(--color-success)";
                btn.style.color = "#ffffff";
            } else {
                btn.style.borderColor = "var(--text-muted)";
                btn.style.color = "var(--text-muted)";
                btn.style.backgroundColor = "transparent";
            }
        }

        if (idx === currentIdx) {
            btn.style.borderWidth = "2px";
            btn.style.borderColor = "var(--primary-color)";
            if (!isAnswered && !isReview) {
                btn.style.color = "var(--primary-color)";
                btn.style.backgroundColor = "var(--primary-color-soft)";
            }
        }

        btn.onclick = (e) => {
            e.preventDefault();
            if (isReview) {
                loadQuizQuestionReview(idx);
            } else {
                loadQuizQuestion(idx);
            }
        };

        grid.appendChild(btn);
    });
}

// Inflight submission lock to prevent spike duplicates
let isQuizSubmitting = false;

async function submitActiveQuiz() {
    if (!state.activeQuiz) return;
    if (isQuizSubmitting) {
        console.warn("[QuizSubmit] Inflight submission active. Ignoring duplicate trigger.");
        return;
    }

    const qzId = state.activeQuiz.quizId;
    const questions = state.activeQuiz.questions;
    const answers = state.activeQuiz.answers;

    const unansweredCount = questions.filter((q, idx) => answers[idx] === undefined).length;
    if (unansweredCount > 0) {
        showToast("Unanswered Questions", `لديك ${unansweredCount} أسئلة لم تقم بالإجابة عليها. يجب حل جميع الأسئلة قبل التسليم.`, "warning");
        return;
    }

    // Lock submission & update button state
    isQuizSubmitting = true;
    const submitBtn = document.getElementById("btn-submit-active-quiz");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري التسليم...`;
    }

    if (quizTimerInterval) clearInterval(quizTimerInterval);

    let correctCount = 0;
    questions.forEach((q, idx) => {
        const userAns = answers[idx];
        if (userAns !== undefined && parseInt(userAns) === parseInt(q.correctOption)) {
            correctCount++;
        }
    });

    const score = Math.round((correctCount / questions.length) * 100);

    const resultObj = {
        id: `${qzId}_${state.currentUser.email}`,
        quiz_id: qzId,
        email: state.currentUser.email,
        score: score,
        total_questions: questions.length,
        answers: answers,
        status: "completed",
        submitted_at: new Date().toISOString()
    };

    const isPractice = state.activeQuiz.isPractice;

    try {
        await saveQuizResultToCloud(resultObj);
        showToast("Success", `لقد أنهيت الاختبار بنجاح بنسبة ${score}%!`, "success");
        
        localStorage.removeItem("active_quiz_session");
        state.activeQuiz = null;

        document.getElementById("active-quiz-overlay").classList.add("hidden");
        document.body.style.overflow = "auto";

        const sidebar = document.querySelector(".sidebar");
        if (sidebar) sidebar.classList.remove("hidden");
        const appLayout = document.getElementById("app-layout");
        if (appLayout) appLayout.style.gridTemplateColumns = "";

        await fetchQuizResults(state.activeGroup);
        if (isPractice) {
            renderReportTaskStudentView();
        } else {
            renderCourseQuizzesStudentView();
        }
    } catch (e) {
        console.error("Failed to submit quiz:", e);
        showToast("Error", "فشلت عملية تسليم الاختبار. حاول مرة أخرى.", "danger");
    } finally {
        isQuizSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Submit Exam`;
        }
    }
}

async function submitQuizCheatZero(quizId, email) {
    const quiz = state.courseQuizzes.find(q => q.id === quizId);
    const title = quiz ? quiz.title : "Course Quiz";
    
    localStorage.removeItem("active_quiz_session");
    
    const resultObj = {
        id: `${quizId}_${email}`,
        quiz_id: quizId,
        email: email,
        score: 0,
        total_questions: quiz ? quiz.questions.length : 0,
        answers: {},
        status: "failed",
        submitted_at: new Date().toISOString()
    };
    
    try {
        await saveQuizResultToCloud(resultObj);
        showToast("Strict Exam Violation", `لقد حصلت على درجة صفر في اختبار "${title}" لمغادرتك الصفحة.`, "danger");
        await fetchQuizResults(state.activeGroup);
        triggerViewRefresh();
    } catch (e) {
        console.error("Failed to submit cheat zero:", e);
    }
}

window.reviewCourseQuizStudent = function(quizId) {
    const qz = state.courseQuizzes.find(q => q.id === quizId);
    if (!qz) return;

    const result = state.quizResults.find(r => r.quiz_id === quizId && r.email === state.currentUser.email);
    if (!result) return;

    state.activeQuiz = {
        quizId: qz.id,
        title: qz.title,
        questions: qz.questions,
        answers: result.answers || {},
        currentQuestionIdx: 0,
        isReview: true
    };

    const overlay = document.getElementById("active-quiz-overlay");
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    document.getElementById("quiz-timer-text").innerText = "Review";
    document.getElementById("btn-submit-active-quiz").onclick = () => {
        exitQuizReview();
    };
    document.getElementById("btn-submit-active-quiz").innerHTML = `Exit Review <i class="fa-solid fa-right-from-bracket"></i>`;
    document.getElementById("btn-submit-active-quiz").className = "btn btn-secondary";

    document.getElementById("btn-prev-quiz-q").onclick = () => {
        if (state.activeQuiz.currentQuestionIdx > 0) {
            loadQuizQuestionReview(state.activeQuiz.currentQuestionIdx - 1);
        }
    };

    document.getElementById("btn-next-quiz-q").onclick = () => {
        if (state.activeQuiz.currentQuestionIdx < state.activeQuiz.questions.length - 1) {
            loadQuizQuestionReview(state.activeQuiz.currentQuestionIdx + 1);
        }
    };

    loadQuizQuestionReview(0);
};

function loadQuizQuestionReview(idx) {
    if (!state.activeQuiz) return;
    state.activeQuiz.currentQuestionIdx = idx;

    const q = state.activeQuiz.questions[idx];
    const total = state.activeQuiz.questions.length;

    document.getElementById("active-quiz-q-index").innerText = `Question ${idx + 1} of ${total}`;
    document.getElementById("active-quiz-q-body").innerHTML = sanitizeRichHTML(q.text || "");

    const container = document.getElementById("active-quiz-options-container");
    container.innerHTML = "";

    const userAns = state.activeQuiz.answers[idx];
    const correctAns = parseInt(q.correctOption);

    const options = q.options || [];
    options.forEach((optText, optIdx) => {
        const optBtn = document.createElement("button");
        optBtn.className = "choice-btn";
        
        const label = String.fromCharCode(65 + optIdx);
        optBtn.innerHTML = `
            <span class="choice-letter">${label}</span>
            <div class="choice-text">${sanitizeHTML(optText)}</div>
        `;

        if (optIdx === correctAns) {
            optBtn.classList.add("correct-choice");
        } else if (userAns !== undefined && parseInt(userAns) === optIdx && parseInt(userAns) !== correctAns) {
            optBtn.classList.add("incorrect-choice");
        }

        container.appendChild(optBtn);
    });

    let expPanel = document.getElementById("active-quiz-explanation");
    if (!expPanel) {
        expPanel = document.createElement("div");
        expPanel.id = "active-quiz-explanation";
        expPanel.className = "question-explanation-panel";
        expPanel.style.marginTop = "25px";
        document.querySelector("#active-quiz-overlay .active-question-card").appendChild(expPanel);
    }
    
    expPanel.innerHTML = `
        <div class="explanation-header">
            <i class="fa-solid fa-circle-info"></i> Explanation
        </div>
        <div class="explanation-body">
            ${sanitizeRichHTML(q.explanation || "No explanation provided.")}
        </div>
    `;

    const prevBtn = document.getElementById("btn-prev-quiz-q");
    const nextBtn = document.getElementById("btn-next-quiz-q");

    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === total - 1;

    renderQuizSidebarGrid();
}

function exitQuizReview() {
    state.activeQuiz = null;
    document.getElementById("active-quiz-overlay").classList.add("hidden");
    document.body.style.overflow = "auto";
    
    const submitBtn = document.getElementById("btn-submit-active-quiz");
    submitBtn.innerHTML = `Submit Exam <i class="fa-solid fa-paper-plane"></i>`;
    submitBtn.className = "btn btn-danger";

    const expPanel = document.getElementById("active-quiz-explanation");
    if (expPanel) expPanel.remove();

    renderReportTaskStudentView();
}

// ================= ADMIN: COURSE QUIZZES & LEADERBOARD =================
let tempQuizQuestions = [];

function renderAdminQuizzesTab() {
    const quizListContainer = document.getElementById("admin-quizzes-list");
    if (!quizListContainer) return;

    quizListContainer.innerHTML = "";

    if (state.courseQuizzes.length === 0) {
        quizListContainer.innerHTML = `
            <div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-muted); width: 100%;">
                <i class="fa-solid fa-graduation-cap" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>No course quizzes created yet.</p>
            </div>
        `;
    } else {
        state.courseQuizzes.forEach(qz => {
            const start = new Date(qz.startTime).toLocaleString();
            const end = new Date(qz.endTime).toLocaleString();
            const now = new Date().getTime();
            const endTimeMs = new Date(qz.endTime).getTime();
            
            let statusLabel = "";
            let actionBtn = "";

            if (qz.status === "moved_to_reports" || now > endTimeMs) {
                statusLabel = `<span class="badge badge-secondary" style="background-color: var(--text-muted); color: #fff; padding: 2px 6px; border-radius: 4px;">Expired / Archived</span>`;
                actionBtn = `<button class="btn btn-secondary btn-sm" disabled style="padding: 4px 8px; font-size: 0.8rem;"><i class="fa-solid fa-circle-check"></i> Already in Reports</button>`;
            } else {
                statusLabel = `<span class="badge badge-success" style="background-color: var(--color-success); color: #fff; padding: 2px 6px; border-radius: 4px;">Active</span>`;
                actionBtn = `<button class="btn btn-warning btn-sm" onclick="moveQuizToReports('${qz.id}')" style="padding: 4px 8px; font-size: 0.8rem;"><i class="fa-solid fa-file-export"></i> Move to Reports</button>`;
            }

            const row = document.createElement("div");
            row.className = "quiz-admin-card";
            row.style.cssText = "background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 15px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; width: 100%; box-sizing: border-box;";
            row.innerHTML = `
                <div>
                    <h4 style="margin: 0 0 5px 0; color: var(--text-primary);">${sanitizeHTML(qz.title)}</h4>
                    <div style="font-size: 0.85rem; color: var(--text-muted); display: flex; gap: 15px; flex-wrap: wrap;">
                        <span><i class="fa-regular fa-clock"></i> ${qz.duration} Min</span>
                        <span><i class="fa-solid fa-list-check"></i> ${qz.questions.length} Qs</span>
                        <span><i class="fa-regular fa-calendar-days"></i> ${start} - ${end}</span>
                        ${statusLabel}
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${actionBtn}
                    <button class="btn btn-primary btn-sm" onclick="viewQuizLeaderboard('${qz.id}')" style="padding: 4px 8px; font-size: 0.8rem;"><i class="fa-solid fa-chart-column"></i> Leaderboard</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteCourseQuiz('${qz.id}')" style="padding: 4px 8px; font-size: 0.8rem;"><i class="fa-solid fa-trash-can"></i> Delete</button>
                </div>
            `;
            quizListContainer.appendChild(row);
        });
    }

    populateQuizLeaderboardFilter();
    renderQuizLeaderboard();

    // Bind Add Question button click
    const addQBtn = document.getElementById("btn-admin-quiz-add-q");
    if (addQBtn && !addQBtn.dataset.bound) {
        addQBtn.dataset.bound = "true";
        addQBtn.onclick = (e) => {
            e.preventDefault();
            addTempQuestionToQuiz();
        };
    }

    // Bind Form submit button
    const quizForm = document.getElementById("admin-quiz-form");
    if (quizForm && !quizForm.dataset.bound) {
        quizForm.dataset.bound = "true";
        quizForm.onsubmit = (e) => {
            e.preventDefault();
            publishCourseQuiz();
        };
    }

    // Bind Leaderboard dropdown selection change
    const leaderboardSelect = document.getElementById("admin-quiz-select-dropdown");
    if (leaderboardSelect && !leaderboardSelect.dataset.bound) {
        leaderboardSelect.dataset.bound = "true";
        leaderboardSelect.onchange = () => {
            renderQuizLeaderboard();
        };
    }
}

window.moveQuizToReports = async function(quizId) {
    const qz = state.courseQuizzes.find(q => q.id === quizId);
    if (!qz) return;
    if (!confirm(`Are you sure you want to move "${qz.title}" to reports immediately? This will end the active strict window.`)) return;

    qz.status = "moved_to_reports";
    await saveCourseQuizToCloud(qz);
    showToast("Quiz Moved", "Quiz has been successfully transferred to practice report tasks.", "success");
    renderAdminQuizzesTab();
};

window.deleteCourseQuiz = async function(quizId) {
    if (!confirm("Are you sure you want to delete this course quiz? This cannot be undone.")) return;
    
    state.courseQuizzes = state.courseQuizzes.filter(q => q.id !== quizId);
    state.quizResults = state.quizResults.filter(r => r.quiz_id !== quizId);

    try {
        await deleteCourseQuizFromCloud(quizId);
        await supabaseRequest(`hawari_quiz_results?quiz_id=eq.${quizId}`, {
            method: "DELETE"
        });
        showToast("Deleted", "Course quiz and all associated results deleted.", "success");
        renderAdminQuizzesTab();
    } catch (e) {
        console.error("Failed to delete quiz:", e);
    }
};

window.viewQuizLeaderboard = function(quizId) {
    const select = document.getElementById("admin-quiz-select-dropdown");
    if (select) {
        select.value = quizId;
        renderQuizLeaderboard();
    }
};

function populateQuizLeaderboardFilter() {
    const select = document.getElementById("admin-quiz-select-dropdown");
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Choose Quiz --</option>';

    state.courseQuizzes.forEach(qz => {
        const opt = document.createElement("option");
        opt.value = qz.id;
        opt.innerText = qz.title;
        select.appendChild(opt);
    });

    if (currentVal && state.courseQuizzes.some(q => q.id === currentVal)) {
        select.value = currentVal;
    }
}

function renderQuizLeaderboard() {
    const container = document.getElementById("admin-quiz-leaderboard-tbody");
    if (!container) return;

    container.innerHTML = "";
    
    const select = document.getElementById("admin-quiz-select-dropdown");
    const quizId = select ? select.value : "";

    if (!quizId) {
        container.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    Select a quiz above to view submissions
                </td>
            </tr>
        `;
        return;
    }

    const filteredResults = state.quizResults.filter(r => r.quiz_id === quizId);

    if (filteredResults.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    No student submissions found for this quiz.
                </td>
            </tr>
        `;
        return;
    }

    filteredResults.sort((a, b) => b.score - a.score || new Date(a.submitted_at) - new Date(b.submitted_at));

    filteredResults.forEach((res, index) => {
        const row = document.createElement("tr");
        const statusBadge = res.status === "failed"
            ? `<span class="badge badge-danger" style="background-color: var(--color-danger); color: #fff; padding: 2px 6px; border-radius: 4px;">Failed (Left Exam)</span>`
            : `<span class="badge badge-success" style="background-color: var(--color-success); color: #fff; padding: 2px 6px; border-radius: 4px;">Completed</span>`;

        row.innerHTML = `
            <td style="padding: 10px; color: var(--text-primary);">${sanitizeHTML(res.email)}</td>
            <td style="padding: 10px; color: var(--text-secondary);">${new Date(res.submitted_at).toLocaleString()}</td>
            <td style="padding: 10px; font-weight: 600; color: var(--text-primary);">${res.score}%</td>
            <td style="padding: 10px;">${statusBadge}</td>
        `;
        container.appendChild(row);
    });
}

window.addTempQuestionToQuiz = function() {
    const textVal = document.getElementById("admin-quiz-q-text").value.trim();
    const optA = document.getElementById("admin-quiz-q-a").value.trim();
    const optB = document.getElementById("admin-quiz-q-b").value.trim();
    const optC = document.getElementById("admin-quiz-q-c").value.trim();
    const optD = document.getElementById("admin-quiz-q-d").value.trim();
    const correct = document.getElementById("admin-quiz-q-correct").value;
    const explanation = document.getElementById("admin-quiz-q-exp").value.trim();

    if (!textVal || !optA || !optB || !optC || !optD) {
        showToast("Missing Fields", "Please fill in the question text and all options A-D.", "warning");
        return;
    }

    const qObj = {
        id: `qz_q_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        text: textVal,
        options: [optA, optB, optC, optD],
        correctOption: parseInt(correct),
        explanation: explanation
    };

    tempQuizQuestions.push(qObj);
    updateTempQuestionsList();

    document.getElementById("admin-quiz-q-text").value = "";
    document.getElementById("admin-quiz-q-a").value = "";
    document.getElementById("admin-quiz-q-b").value = "";
    document.getElementById("admin-quiz-q-c").value = "";
    document.getElementById("admin-quiz-q-d").value = "";
    document.getElementById("admin-quiz-q-correct").value = "0";
    document.getElementById("admin-quiz-q-exp").value = "";

    showToast("Question Added", "Question successfully added to the quiz template.", "success");
};

function updateTempQuestionsList() {
    const container = document.getElementById("admin-quiz-questions-preview-list");
    const countBadge = document.getElementById("admin-quiz-questions-count");
    const previewSection = document.getElementById("admin-quiz-questions-preview-section");

    if (countBadge) {
        countBadge.innerText = tempQuizQuestions.length;
    }

    if (previewSection) {
        if (tempQuizQuestions.length > 0) {
            previewSection.classList.remove("hidden");
        } else {
            previewSection.classList.add("hidden");
        }
    }

    if (!container) return;
    container.innerHTML = "";

    tempQuizQuestions.forEach((q, idx) => {
        const item = document.createElement("div");
        item.style.cssText = "background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;";
        item.innerHTML = `
            <div style="font-size: 0.85rem; max-width: 80%; color: var(--text-primary);">
                <strong>Q${idx + 1}:</strong> ${sanitizeHTML(q.text.substring(0, 100))}${q.text.length > 100 ? "..." : ""}
            </div>
            <button class="btn btn-danger btn-sm" type="button" style="padding: 2px 6px; font-size: 0.75rem;" onclick="removeTempQuestion(${idx})">Remove</button>
        `;
        container.appendChild(item);
    });
}

window.removeTempQuestion = function(idx) {
    tempQuizQuestions.splice(idx, 1);
    updateTempQuestionsList();
};

window.publishCourseQuiz = async function() {
    const title = document.getElementById("admin-quiz-title").value.trim();
    const duration = parseInt(document.getElementById("admin-quiz-duration").value);
    const start = document.getElementById("admin-quiz-start").value;
    const end = document.getElementById("admin-quiz-end").value;

    if (!title || isNaN(duration) || !start || !end) {
        showToast("Missing Fields", "Please complete all quiz metadata fields (Title, Duration, Start/End times).", "warning");
        return;
    }

    if (tempQuizQuestions.length === 0) {
        showToast("No Questions", "Please add at least one question to the quiz.", "warning");
        return;
    }

    const quizObj = {
        id: `qz_${Date.now()}`,
        title: title,
        duration: duration,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        questions: tempQuizQuestions,
        status: "active"
    };

    state.courseQuizzes.push(quizObj);
    await saveCourseQuizToCloud(quizObj);

    showToast("Quiz Published", `Course quiz "${title}" has been successfully published.`, "success");
    
    document.getElementById("admin-quiz-form").reset();
    tempQuizQuestions = [];
    updateTempQuestionsList();
    
    renderAdminQuizzesTab();
}

// ================= VIDEO PORTAL IMPLEMENTATION =================
let vpState = {
    currentUser: null,       // { email, role: 'admin'|'instructor'|'assistant'|'student', course_id }
    courses: [],             // hawari_video_courses
    activeCourse: null,      // active course object in workspace
    videos: [],              // videos of active course
    shorts: [],              // short videos of active course
    subscriptions: [],       // subscription links of active course
    requests: [],            // subscription requests of active course
    activeTab: 'videos',     // active tab: 'videos'|'shorts'|'subs'|'settings'
    activeSubTab: 'links',   // active subtab: 'links'|'requests'
    studentPlaylistTab: 'videos' // 'videos'|'shorts'
};

const DB_LOCAL_KEYS = {
    COURSES: 'hawari_vp_courses',
    CONTENT: 'hawari_vp_content',
    SUBSCRIPTIONS: 'hawari_vp_subscriptions',
    REQUESTS: 'hawari_vp_requests',
    SECTIONS: 'hawari_vp_sections'
};

function getLocalData(key) {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : [];
}

function saveLocalData(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function getVpLocalKey(table) {
    if (table.includes("courses")) return DB_LOCAL_KEYS.COURSES;
    if (table.includes("content")) return DB_LOCAL_KEYS.CONTENT;
    if (table.includes("subscriptions")) return DB_LOCAL_KEYS.SUBSCRIPTIONS;
    if (table.includes("sections")) return DB_LOCAL_KEYS.SECTIONS;
    return DB_LOCAL_KEYS.REQUESTS;
}

// Database query helpers with local emulated storage fallbacks
async function dbGet(table, queryParams = "") {
    try {
        const records = await supabaseRequest(`${table}${queryParams ? "?" + queryParams : ""}`);
        if (records !== null) return records;
    } catch (e) {
        console.warn(`Supabase DB query to ${table} failed, reading local fallback.`, e);
    }
    const localKey = getVpLocalKey(table);
    let localData = getLocalData(localKey);
    if (queryParams) {
        const parts = queryParams.split("&");
        parts.forEach(part => {
            const eqIdx = part.indexOf("=eq.");
            if (eqIdx >= 0) {
                const key = part.substring(0, eqIdx);
                const val = part.substring(eqIdx + 4);
                localData = localData.filter(row => String(row[key]) === String(val));
            }
        });
    }
    return localData;
}

async function dbPost(table, payload) {
    let success = false;
    try {
        const records = await supabaseRequest(table, {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify(payload)
        });
        if (records !== null) success = true;
    } catch (e) {
        console.warn(`Supabase DB post to ${table} failed, writing local fallback.`, e);
    }
    const localKey = getVpLocalKey(table);
    let localData = getLocalData(localKey);
    let idx = -1;
    if (table === "hawari_video_requests" && payload.email && payload.course_id) {
        idx = localData.findIndex(row => String(row.email) === String(payload.email) && String(row.course_id) === String(payload.course_id));
    } else {
        const idKey = payload.id ? 'id' : (payload.email ? 'email' : null);
        if (idKey) {
            idx = localData.findIndex(row => String(row[idKey]) === String(payload[idKey]));
        }
    }
    if (idx >= 0) {
        localData[idx] = payload;
    } else {
        localData.push(payload);
    }
    saveLocalData(localKey, localData);
    return success;
}

async function dbDelete(table, idQuery) {
    let success = false;
    try {
        const res = await supabaseRequest(`${table}?${idQuery}`, {
            method: "DELETE"
        });
        if (res !== null) success = true;
    } catch (e) {
        console.warn(`Supabase DB delete on ${table} failed, deleting local fallback.`, e);
    }
    const localKey = getVpLocalKey(table);
    let localData = getLocalData(localKey);
    const parts = idQuery.split("&");
    const conditions = [];
    parts.forEach(part => {
        const eqIdx = part.indexOf("=eq.");
        if (eqIdx >= 0) {
            conditions.push({
                key: part.substring(0, eqIdx),
                val: part.substring(eqIdx + 4)
            });
        }
    });
    if (conditions.length > 0) {
        localData = localData.filter(row => {
            const allMatch = conditions.every(cond => String(row[cond.key]) === String(cond.val));
            return !allMatch;
        });
    }
    saveLocalData(localKey, localData);
    return success;
}

// Router hook dispatcher for Video Portal hashes
window.handleVideoPortalRouting = async function(hash) {
    const selectorPage = document.getElementById("course-selector-page");
    if (selectorPage) selectorPage.classList.add("hidden");
    const appLayout = document.getElementById("app-layout");
    if (appLayout) appLayout.classList.add("hidden");
    const activeQuizOverlay = document.getElementById("active-quiz-overlay");
    if (activeQuizOverlay) activeQuizOverlay.classList.add("hidden");

    const vpView = document.getElementById("video-portal-view");
    vpView.classList.remove("hidden");

    // Clear sub-panels
    document.getElementById("vp-auth-panel").classList.add("hidden");
    document.getElementById("vp-subscribe-panel").classList.add("hidden");
    document.getElementById("vp-admin-panel").classList.add("hidden");
    document.getElementById("vp-instructor-workspace").classList.add("hidden");
    document.getElementById("vp-student-workspace").classList.add("hidden");

    if (hash.startsWith("video-subscribe")) {
        const courseId = hash.includes("course_id=") ? hash.split("course_id=")[1] : "";
        if (!courseId) {
            showToast("Invalid URL", "Course ID is missing.", "danger");
            window.location.hash = "#video-portal";
            return;
        }



        const courses = await dbGet("hawari_video_courses", `id=eq.${courseId}`);
        if (courses.length === 0) {
            showToast("Course Deleted", "The course associated with this link is deleted.", "danger");
            window.location.hash = "#video-portal";
            return;
        }

        // Hide main header to keep registration link isolated
        const header = document.getElementById("vp-header");
        if (header) header.style.display = "none";

        // Show subscription registration form
        document.getElementById("vp-sub-course-title").innerText = `Subscribe to: ${courses[0].name}`;
        document.getElementById("vp-sub-price-tag").innerText = "Fill out details to request subscription access";
        document.getElementById("vp-subscribe-panel").classList.remove("hidden");
        
        // Save targeted parameter in registration dataset
        document.getElementById("vp-subscribe-form").dataset.courseId = courseId;

    } else if (hash === "video-portal") {
        // Restore header visibility
        const header = document.getElementById("vp-header");
        if (header) header.style.display = "flex";

        if (!vpState.currentUser) {
            document.getElementById("vp-auth-panel").classList.remove("hidden");
            document.getElementById("vp-user-display").innerText = "";
        } else {
            document.getElementById("vp-user-display").innerText = `User: ${vpState.currentUser.email}`;
            if (vpState.currentUser.role === "admin") {
                document.getElementById("vp-admin-panel").classList.remove("hidden");
                renderVpAdminPanel();
            } else if (vpState.currentUser.role === "instructor" || vpState.currentUser.role === "assistant") {
                document.getElementById("vp-instructor-workspace").classList.remove("hidden");
                renderVpInstructorWorkspace();
            } else if (vpState.currentUser.role === "student") {
                document.getElementById("vp-student-workspace").classList.remove("hidden");
                renderVpStudentWorkspace();
            }
        }
    }
};

window.initVideoPortal = function() {
    const bindEvent = (id, event, fn) => {
        const el = document.getElementById(id);
        if (el) el[event] = fn;
    };

    // 1. Exit Portal handler
    bindEvent("btn-vp-exit", "onclick", () => {
        // Log out portal user and redirect to landing page
        vpState.currentUser = null;
        vpState.activeCourse = null;
        stopWatermark();
        stopSessionValidityCheck();
        const player = document.getElementById("vp-main-video-player");
        if (player) player.pause();

        const portalView = document.getElementById("video-portal-view");
        if (portalView) portalView.classList.add("hidden");
        window.location.hash = "";
        const selectorPage = document.getElementById("course-selector-page");
        if (selectorPage) selectorPage.classList.remove("hidden");
    });

    // 1b. Student Course Switcher click handler
    const userDisplay = document.getElementById("vp-user-display");
    if (userDisplay) {
        userDisplay.style.cursor = "pointer";
        userDisplay.title = "Click to switch courses";
        userDisplay.onclick = async () => {
            if (!vpState.currentUser || vpState.currentUser.role !== "student") return;

            // Fetch all approved requests for this student email
            const list = await dbGet("hawari_video_requests", `email=eq.${vpState.currentUser.email}&status=eq.approved`);
            if (list.length <= 1) {
                showToast("No Other Courses", "You are not registered in any other approved courses.", "info");
                return;
            }

            // Fetch all course records
            const courses = await dbGet("hawari_video_courses");
            
            const modal = document.getElementById("vp-student-course-modal");
            const listContainer = document.getElementById("vp-student-modal-courses-list");
            listContainer.innerHTML = "";

            list.forEach(req => {
                const course = courses.find(c => c.id === req.course_id);
                if (!course) return;

                const btn = document.createElement("button");
                btn.className = "btn btn-block btn-secondary";
                btn.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; font-size: 0.9rem; font-weight: 600; border-radius: 12px; margin-bottom: 8px; border: 1px solid var(--border-color); text-align: left; width: 100%; box-sizing: border-box;";
                
                const isActive = course.id === vpState.activeCourse.id;
                if (isActive) {
                    btn.classList.add("btn-primary");
                    btn.classList.remove("btn-secondary");
                    btn.style.borderColor = "var(--primary-color)";
                }

                btn.innerHTML = `
                    <span><i class="fa-solid fa-graduation-cap" style="margin-right: 8px;"></i> ${course.name}</span>
                    ${isActive ? '<span class="badge badge-active" style="font-size: 0.7rem; padding: 2px 6px;">Active</span>' : '<i class="fa-solid fa-chevron-right"></i>'}
                `;

                btn.onclick = async () => {
                    if (isActive) {
                        modal.classList.add("hidden");
                        return;
                    }

                    // Check Course dates before switching
                    const now = Date.now();
                    if (course.start_date && new Date(course.start_date).getTime() > now) {
                        showToast("Course Not Started", `This course begins on: ${course.start_date}.`, "warning");
                        return;
                    }
                    if (course.end_date && new Date(course.end_date).getTime() < now) {
                        showToast("Course Expired", "The access period for this course has ended.", "danger");
                        return;
                    }

                    // Check Device fingerprint for target course
                    let localToken = "";
                    if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceToken === "function") {
                        localToken = window.AndroidBridge.getDeviceToken();
                    } else {
                        localToken = localStorage.getItem(`vp_device_${course.id}`);
                        if (!localToken) {
                            localToken = "dev_" + Math.random().toString(36).substring(2) + Date.now();
                            localStorage.setItem(`vp_device_${course.id}`, localToken);
                        }
                    }

                    if (req.device_token && req.device_token !== localToken) {
                        showToast("Device Mismatch", "Only 1 device is allowed. This account is registered on another device for this course.", "danger");
                        return;
                    }

                    if (!req.device_token) {
                        req.device_token = localToken;
                        await dbPost("hawari_video_requests", req);
                    }

                    // Perform the switch
                    vpState.activeCourse = course;
                    vpState.currentUser.course_id = course.id;
                    vpState.currentUser.student_code = req.student_code;
                    vpState.currentUser.id = req.id;

                    showToast("Switched Course", `Now playing: ${course.name}`, "success");
                    modal.classList.add("hidden");
                    
                    // Re-render student workspace
                    renderVpStudentWorkspace();
                };

                listContainer.appendChild(btn);
            });

            modal.classList.remove("hidden");
        };
    }

    // 2. Auth Flow handler
    document.getElementById("btn-vp-login-submit").onclick = async () => {
        const email = document.getElementById("vp-auth-email").value.trim().toLowerCase();
        const password = document.getElementById("vp-auth-password").value;

        if (!email || !password) {
            showToast("Required Fields", "Please enter both email and password.", "warning");
            return;
        }

        // A. Admin / Instructor Check
        let existingUser = state.users.find(u => u.email === email);
        if (existingUser && (existingUser.role === "admin" || existingUser.role === "instructor")) {
            let authed = false;
            if (existingUser.password && sha256Sync(password) === existingUser.password) {
                authed = true;
            } else {
                const session = await loginToSupabaseAuth(email, password);
                if (session && session.access_token) authed = true;
            }
            if (authed) {
                vpState.currentUser = { email, role: "admin" };
                showToast("Welcome Admin", "Logged in to Video Portal Administrator dashboard.", "success");
                window.location.hash = "#video-portal";
                window.handleVideoPortalRouting("video-portal");
                return;
            }
        }

        // B. Course Instructor / Assistant Check
        const courses = await dbGet("hawari_video_courses");
        const instCourse = courses.find(c => c.instructor_email === email && c.instructor_password === password);
        if (instCourse) {
            vpState.currentUser = { email, role: "instructor", course_id: instCourse.id };
            vpState.activeCourse = instCourse;
            showToast("Welcome Instructor", `Logged in to manage ${instCourse.name}.`, "success");
            window.location.hash = "#video-portal";
            window.handleVideoPortalRouting("video-portal");
            return;
        }

        const asstCourse = courses.find(c => c.assistant_email === email && c.assistant_password === password);
        if (asstCourse) {
            vpState.currentUser = { email, role: "assistant", course_id: asstCourse.id };
            vpState.activeCourse = asstCourse;
            showToast("Welcome Assistant", `Logged in to assist in managing ${asstCourse.name}.`, "success");
            window.location.hash = "#video-portal";
            window.handleVideoPortalRouting("video-portal");
            return;
        }

        // C. Student Request Check
        const requests = await dbGet("hawari_video_requests", `email=eq.${email}`);
        if (requests.length > 0) {
            const hashedInputPassword = sha256Sync(password);
            const req = requests.find(r => r.password_hash === hashedInputPassword);
            if (req) {
                if (req.status === "blocked") {
                    showToast("Blocked Account", "Your access to this course has been blocked.", "danger");
                    return;
                }
                if (req.status !== "approved") {
                    showToast("Pending Approval", "Your registration request is still waiting for approval.", "warning");
                    return;
                }

                // Check Course dates before device fingerprint logic
                const targCourse = courses.find(c => c.id === req.course_id);
                if (targCourse) {
                    const now = Date.now();
                    if (targCourse.start_date && new Date(targCourse.start_date).getTime() > now) {
                        showToast("Course Not Started", `This course begins on: ${targCourse.start_date}.`, "warning");
                        return;
                    }
                    if (targCourse.end_date && new Date(targCourse.end_date).getTime() < now) {
                        showToast("Course Expired", "The access period for this course has ended.", "danger");
                        return;
                    }
                }

                // Single Device fingerprint check
                let localToken = "";
                if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceToken === "function") {
                    localToken = window.AndroidBridge.getDeviceToken();
                } else {
                    localToken = localStorage.getItem(`vp_device_${req.course_id}`);
                    if (!localToken) {
                        localToken = "dev_" + Math.random().toString(36).substring(2) + Date.now();
                        localStorage.setItem(`vp_device_${req.course_id}`, localToken);
                    }
                }

                if (req.device_token && req.device_token !== localToken) {
                    showToast("Device Mismatch", "Only 1 device is allowed. This account is registered on another device.", "danger");
                    return;
                }

                // If device_token was empty, update it in DB
                if (!req.device_token) {
                    req.device_token = localToken;
                    await dbPost("hawari_video_requests", req);
                }
                if (localToken && !localToken.startsWith("dev_")) {
                    // Cache the local token
                    localStorage.setItem(`vp_device_${req.course_id}`, localToken);
                }

                vpState.currentUser = { email, role: "student", course_id: req.course_id, name: req.name, student_code: req.student_code, phone: req.phone, id: req.id };
                vpState.activeCourse = targCourse;

                showToast("Welcome Student", `Logged in to ${targCourse.name}.`, "success");
                window.location.hash = "#video-portal";
                window.handleVideoPortalRouting("video-portal");
                return;
            }
        }

        showToast("Invalid Credentials", "Incorrect email or password.", "danger");
    };

    // 3. Subscription registration form submit handler
    bindEvent("vp-subscribe-form", "onsubmit", async (e) => {
        e.preventDefault();
        const form = e.target;
        const name = document.getElementById("vp-sub-name").value.trim();
        const email = document.getElementById("vp-sub-email").value.trim().toLowerCase();
        const phone = document.getElementById("vp-sub-phone").value.trim();
        const code = document.getElementById("vp-sub-code").value.trim();
        const password = document.getElementById("vp-sub-password").value;

        if (!email.endsWith("@gmail.com")) {
            showToast("Gmail Only", "Registration is restricted to Gmail accounts only.", "warning");
            return;
        }

        // Verify if they are already registered for this course
        const existing = await dbGet("hawari_video_requests", `email=eq.${email}&course_id=eq.${form.dataset.courseId}`);
        if (existing.length > 0) {
            const currentReq = existing[0];
            if (currentReq.status === "approved") {
                showToast("Already Approved", "Your account is already approved for this course. Please log in.", "warning");
                return;
            }
            
            // Allow updating the pending/blocked request by reusing its ID
            const payload = {
                id: currentReq.id,
                course_id: form.dataset.courseId,
                name: name,
                email: email,
                phone: phone,
                student_code: code || "",
                password_hash: sha256Sync(password),
                status: "pending", // Reset to pending for review
                device_token: "", // Clear fingerprint to allow fresh login
                created_at: currentReq.created_at || new Date().toLocaleDateString()
            };
            await dbPost("hawari_video_requests", payload);
            showToast("Success", "Registration details updated. Waiting for admin approval.", "success");
        } else {
            // Create a brand new request
            const payload = {
                id: `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                course_id: form.dataset.courseId,
                name: name,
                email: email,
                phone: phone,
                student_code: code || "",
                password_hash: sha256Sync(password),
                status: "pending",
                device_token: "",
                created_at: new Date().toLocaleDateString()
            };
            await dbPost("hawari_video_requests", payload);
            showToast("Success", "Registration submitted. Waiting for admin approval.", "success");
        }
        
        // Show success block with option to register another student
        const subPanel = document.getElementById("vp-subscribe-panel");
        if (subPanel) {
            subPanel.innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <div style="width: 70px; height: 70px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                        <i class="fa-solid fa-circle-check" style="font-size: 2.2rem; color: var(--color-success);"></i>
                    </div>
                    <h3 style="font-size: 1.4rem; font-weight: 700; color: var(--color-success);">Submission Successful</h3>
                    <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 10px; line-height: 1.5; margin-bottom: 20px;">
                        Your subscription request has been received. You will be able to access the lectures once the instructor approves your request.
                    </p>
                    <button class="btn btn-primary" onclick="window.location.reload();" style="padding: 8px 16px; border-radius: 8px;">
                        Register Another Student
                    </button>
                </div>
            `;
        }
    });

    // 4. Admin Course Form submission handler
    bindEvent("vp-admin-course-form", "onsubmit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("vp-course-name").value.trim();
        const start = document.getElementById("vp-course-start-date").value;
        const end = document.getElementById("vp-course-end-date").value;
        const instEmail = document.getElementById("vp-course-instructor").value.trim().toLowerCase();
        const instPass = document.getElementById("vp-course-password").value;

        const payload = {
            id: `c_${Date.now()}`,
            name: name,
            start_date: start,
            end_date: end,
            instructor_email: instEmail,
            instructor_password: instPass,
            assistant_email: "",
            assistant_password: ""
        };

        await dbPost("hawari_video_courses", payload);
        showToast("Course Created", `Track "${name}" has been successfully added.`, "success");
        e.target.reset();
        const createBox = document.getElementById("vp-admin-create-course-box");
        if (createBox) createBox.classList.add("hidden");
        renderVpAdminPanel();
    });

    bindEvent("btn-vp-show-add-course", "onclick", () => {
        const box = document.getElementById("vp-admin-create-course-box");
        if (box) box.classList.toggle("hidden");
    });
    bindEvent("btn-vp-cancel-add-course", "onclick", () => {
        const box = document.getElementById("vp-admin-create-course-box");
        if (box) box.classList.add("hidden");
    });

    // 5. Workspace Sidebar view navigation
    const wsNavs = ['videos', 'shorts', 'subs', 'settings', 'admin'];
    wsNavs.forEach(tab => {
        const el = document.getElementById(`vp-nav-${tab}`);
        if (el) {
            el.onclick = (e) => {
                e.preventDefault();
                wsNavs.forEach(t => {
                    const navLink = document.getElementById(`vp-nav-${t}`);
                    if (navLink) navLink.classList.remove("active");
                    const pane = document.getElementById(`vp-pane-${t}`);
                    if (pane) pane.classList.add("hidden");
                });
                el.classList.add("active");
                const targetPane = document.getElementById(`vp-pane-${tab}`);
                if (targetPane) targetPane.classList.remove("hidden");
                vpState.activeTab = tab;
                if (tab === "admin") {
                    renderVpAdminControlPanel();
                }
            };
        }
    });

    // Copy Registration Link button
    bindEvent("btn-copy-course-reg-url", "onclick", () => {
        const urlInput = document.getElementById("vp-course-reg-url-display");
        if (urlInput) {
            urlInput.select();
            urlInput.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(urlInput.value);
            showToast("Copied!", "Registration link copied to clipboard.", "success");
        }
    });

    // Admin Control Expiration Bounds Form
    bindEvent("vp-course-bounds-form", "onsubmit", async (e) => {
        e.preventDefault();
        const start = document.getElementById("vp-edit-start-date").value;
        const end = document.getElementById("vp-edit-end-date").value;

        if (!vpState.activeCourse) return;

        const payload = {
            ...vpState.activeCourse,
            start_date: start,
            end_date: end
        };

        await dbPost("hawari_video_courses", payload);
        vpState.activeCourse = payload;
        showToast("Boundaries Updated", "Course start and expiration dates saved successfully.", "success");
        renderVpAdminControlPanel();
    });

    // Admin Control Course Users Credentials Form
    bindEvent("vp-course-users-form", "onsubmit", async (e) => {
        e.preventDefault();
        const instEmail = document.getElementById("vp-edit-inst-email").value.trim().toLowerCase();
        const instPass = document.getElementById("vp-edit-inst-pass").value;
        const asstEmail = document.getElementById("vp-edit-asst-email").value.trim().toLowerCase();
        const asstPass = document.getElementById("vp-edit-asst-pass").value;

        if (!vpState.activeCourse) return;

        const payload = {
            ...vpState.activeCourse,
            instructor_email: instEmail,
            instructor_password: instPass,
            assistant_email: asstEmail,
            assistant_password: asstPass
        };

        await dbPost("hawari_video_courses", payload);
        vpState.activeCourse = payload;
        showToast("Credentials Updated", "Course manager (instructor & assistant) accounts updated.", "success");
        renderVpAdminControlPanel();
    });

    // 6. Subscriptions Tabs (Generate Link / Requests) navigation
    bindEvent("btn-vp-subtab-links", "onclick", () => {
        const btnLinks = document.getElementById("btn-vp-subtab-links");
        const btnReqs = document.getElementById("btn-vp-subtab-requests");
        const paneLinks = document.getElementById("vp-subpane-links");
        const paneReqs = document.getElementById("vp-subpane-requests");
        if (btnLinks) {
            btnLinks.classList.add("active");
            btnLinks.style.borderColor = "var(--primary-color)";
        }
        if (btnReqs) {
            btnReqs.classList.remove("active");
            btnReqs.style.borderColor = "transparent";
        }
        if (paneLinks) paneLinks.classList.remove("hidden");
        if (paneReqs) paneReqs.classList.add("hidden");
        vpState.activeSubTab = "links";
    });

    bindEvent("btn-vp-subtab-requests", "onclick", () => {
        const btnLinks = document.getElementById("btn-vp-subtab-links");
        const btnReqs = document.getElementById("btn-vp-subtab-requests");
        const paneLinks = document.getElementById("vp-subpane-links");
        const paneReqs = document.getElementById("vp-subpane-requests");
        if (btnReqs) {
            btnReqs.classList.add("active");
            btnReqs.style.borderColor = "var(--primary-color)";
        }
        if (btnLinks) {
            btnLinks.classList.remove("active");
            btnLinks.style.borderColor = "transparent";
        }
        if (paneReqs) paneReqs.classList.remove("hidden");
        if (paneLinks) paneLinks.classList.add("hidden");
        vpState.activeSubTab = "requests";
        renderVpRequestsTable(true);
    });

    // Bind Add Section buttons
    bindEvent("btn-vp-add-section-videos", "onclick", () => {
        const name = prompt("Enter Section Name:");
        if (name && name.trim()) {
            addVpSection(name.trim(), "regular");
        }
    });

    bindEvent("btn-vp-add-section-shorts", "onclick", () => {
        const name = prompt("Enter Section Name:");
        if (name && name.trim()) {
            addVpSection(name.trim(), "short");
        }
    });

    // 7. Regular Video File uploading
    bindEvent("vp-add-video-form", "onsubmit", async (e) => {
        e.preventDefault();
        const sectionId = document.getElementById("vp-video-section-id").value;
        const title = document.getElementById("vp-video-title").value.trim();
        const desc = document.getElementById("vp-video-desc").value.trim();
        const fileInput = document.getElementById("vp-video-file");
        const file = fileInput ? fileInput.files[0] : null;

        if (!file) {
            showToast("Required File", "Please select a video file to upload.", "warning");
            return;
        }

        const contentId = `v_${Date.now()}`;
        const progressContainer = document.getElementById("vp-video-progress-container");
        const progressBar = document.getElementById("vp-video-progress-bar");
        const progressText = document.getElementById("vp-video-progress-text");
        
        if (progressContainer) progressContainer.classList.remove("hidden");
        if (progressBar) progressBar.style.width = "0%";
        if (progressText) progressText.innerText = "0%";

        let uploadUrl = "";
        try {
            uploadUrl = await uploadFileToSupabase(file, vpState.activeCourse.id, contentId, (pct) => {
                if (progressBar) progressBar.style.width = pct + "%";
                if (progressText) progressText.innerText = pct + "%";
            });
        } catch (err) {
            console.error("Supabase Storage upload failed:", err);
            if (progressContainer) progressContainer.classList.add("hidden");
            alert(`فشل رفع الفيديو إلى السحابة:\n${err.message}\nيرجى التأكد من صلاحيات المجلد (hawari_videos) وسياسات RLS في لوحة تحكم Supabase.`);
            return;
        }

        const payload = {
            id: contentId,
            course_id: vpState.activeCourse.id,
            section_id: sectionId,
            type: "regular",
            title: title,
            description: desc,
            video_url: uploadUrl,
            created_at: new Date().toLocaleDateString()
        };

        await dbPost("hawari_video_content", payload);
        showToast("Video Added", "Regular course video uploaded successfully.", "success");
        
        if (progressContainer) progressContainer.classList.add("hidden");
        e.target.reset();
        const box = document.getElementById("vp-add-video-box");
        if (box) box.classList.add("hidden");
        loadWorkspaceContent();
    });

    // 8. Short Video File uploading
    bindEvent("vp-add-short-form", "onsubmit", async (e) => {
        e.preventDefault();
        const sectionId = document.getElementById("vp-short-section-id").value;
        const title = document.getElementById("vp-short-title").value.trim();
        const fileInput = document.getElementById("vp-short-file");
        const file = fileInput ? fileInput.files[0] : null;

        if (!file) {
            showToast("Required File", "Please select a short video file to upload.", "warning");
            return;
        }

        const contentId = `s_${Date.now()}`;
        const progressContainer = document.getElementById("vp-short-progress-container");
        const progressBar = document.getElementById("vp-short-progress-bar");
        const progressText = document.getElementById("vp-short-progress-text");
        
        if (progressContainer) progressContainer.classList.remove("hidden");
        if (progressBar) progressBar.style.width = "0%";
        if (progressText) progressText.innerText = "0%";

        let uploadUrl = "";
        try {
            uploadUrl = await uploadFileToSupabase(file, vpState.activeCourse.id, contentId, (pct) => {
                if (progressBar) progressBar.style.width = pct + "%";
                if (progressText) progressText.innerText = pct + "%";
            });
        } catch (err) {
            console.error("Supabase Storage upload failed:", err);
            if (progressContainer) progressContainer.classList.add("hidden");
            alert(`فشل رفع الفيديو إلى السحابة:\n${err.message}\nيرجى التأكد من صلاحيات المجلد (hawari_videos) وسياسات RLS في لوحة تحكم Supabase.`);
            return;
        }

        const payload = {
            id: contentId,
            course_id: vpState.activeCourse.id,
            section_id: sectionId,
            type: "short",
            title: title,
            description: "",
            video_url: uploadUrl,
            created_at: new Date().toLocaleDateString()
        };

        await dbPost("hawari_video_content", payload);
        showToast("Short Added", "Short video uploaded successfully.", "success");
        
        if (progressContainer) progressContainer.classList.add("hidden");
        e.target.reset();
        const box = document.getElementById("vp-add-short-box");
        if (box) box.classList.add("hidden");
        loadWorkspaceContent();
    });

    // 9. Subscription Link Generator
    bindEvent("vp-generate-link-form", "onsubmit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("vp-link-name").value.trim();
        const price = document.getElementById("vp-link-price").value.trim();

        const payload = {
            id: `sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            course_id: vpState.activeCourse.id,
            name: name,
            price: price
        };

        await dbPost("hawari_video_subscriptions", payload);
        showToast("Link Generated", "Registration URL has been added to active list.", "success");
        e.target.reset();
        loadWorkspaceContent();
    });

    // 10. Assistant setup
    bindEvent("vp-invite-assistant-form", "onsubmit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("vp-assistant-email").value.trim().toLowerCase();
        const password = document.getElementById("vp-assistant-password").value;

        vpState.activeCourse.assistant_email = email;
        vpState.activeCourse.assistant_password = password;

        await dbPost("hawari_video_courses", vpState.activeCourse);
        showToast("Assistant Added", "Assistant login credentials successfully saved.", "success");
        e.target.reset();
        renderWorkspaceSettings();
    });

    // 11. Manual Student registration
    bindEvent("vp-manual-student-form", "onsubmit", async (e) => {
        e.preventDefault();
        try {
            const name = document.getElementById("vp-manual-name").value.trim();
            const email = document.getElementById("vp-manual-email").value.trim().toLowerCase();
            const phone = document.getElementById("vp-manual-phone").value.trim();
            const code = document.getElementById("vp-manual-code").value.trim();
            const password = document.getElementById("vp-manual-password").value;

            if (!vpState.activeCourse) {
                showToast("Error", "No active course selected.", "danger");
                return;
            }

            if (!email.endsWith("@gmail.com")) {
                showToast("Gmail Only", "Only Gmail accounts are allowed.", "warning");
                return;
            }

            // Show loading spinner on button
            const submitBtn = e.target.querySelector("button[type='submit']");
            const originalText = submitBtn ? submitBtn.innerHTML : "Add & Activate Student";
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding...`;
            }

            // Check if student exists
            const existing = await dbGet("hawari_video_requests", `email=eq.${email}&course_id=eq.${vpState.activeCourse.id}`);
            if (existing.length > 0) {
                showToast("Duplicate Student", "This student account is already registered for this course.", "warning");
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalText;
                }
                return;
            }

            const payload = {
                id: `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                course_id: vpState.activeCourse.id,
                name: name,
                email: email,
                phone: phone,
                student_code: code,
                password_hash: sha256Sync(password),
                status: "approved",
                device_token: "",
                created_at: new Date().toLocaleDateString()
            };

            // Cache local state optimistically
            if (!vpState.requests) vpState.requests = [];
            vpState.requests.push(payload);

            await dbPost("hawari_video_requests", payload);
            
            showToast("Student Activated", "Account registered and immediately approved.", "success");
            e.target.reset();
            
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }

            // Refresh requests table to show the new student immediately
            renderVpRequestsTable(false);
        } catch (err) {
            console.error("[Manual Student] Error adding student:", err);
            showToast("Error", `Failed to add student: ${err.message}`, "danger");
            const submitBtn = e.target.querySelector("button[type='submit']");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = "Add & Activate Student";
            }
        }
    });

    // 12. Exit Workspace Handler
    const exitWorkspaceBtn = document.getElementById("vp-nav-exit-workspace");
    if (exitWorkspaceBtn) {
        exitWorkspaceBtn.onclick = (e) => {
            e.preventDefault();
            vpState.activeCourse = null;
            document.getElementById("vp-instructor-workspace").classList.add("hidden");
            document.getElementById("vp-admin-panel").classList.remove("hidden");
            renderVpAdminPanel();
        };
    }

    // 12. Requests table filters and search bindings
    bindEvent("vp-requests-search", "oninput", renderVpRequestsTable);
    bindEvent("vp-requests-filter", "onchange", renderVpRequestsTable);

    // 13. Student workspace playlist tab toggling
    bindEvent("btn-vp-stud-tab-videos", "onclick", () => {
        const btnV = document.getElementById("btn-vp-stud-tab-videos");
        const btnS = document.getElementById("btn-vp-stud-tab-shorts");
        if (btnV) btnV.className = "btn btn-primary";
        if (btnS) btnS.className = "btn btn-secondary";
        vpState.studentPlaylistTab = "videos";
        renderStudentPlaylist();
    });

    bindEvent("btn-vp-stud-tab-shorts", "onclick", () => {
        const btnV = document.getElementById("btn-vp-stud-tab-videos");
        const btnS = document.getElementById("btn-vp-stud-tab-shorts");
        if (btnS) btnS.className = "btn btn-primary";
        if (btnV) btnV.className = "btn btn-secondary";
        vpState.studentPlaylistTab = "shorts";
    });

    // 14. Custom Video Player Controls
    const video = document.getElementById("vp-main-video-player");
    const playBtn = document.getElementById("btn-vp-play-pause");
    const progressFill = document.getElementById("vp-progress-bar-fill");
    const progressContainer = document.getElementById("vp-progress-bar-container");
    const timeDisplay = document.getElementById("vp-player-time-display");

    playBtn.onclick = () => {
        if (video.paused) {
            video.play();
            playBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        } else {
            video.pause();
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        }
    };

    video.addEventListener("timeupdate", () => {
        if (!isNaN(video.duration)) {
            const pct = (video.currentTime / video.duration) * 100;
            progressFill.style.width = pct + "%";
            
            // Format time display
            const formatTime = (time) => {
                const mins = Math.floor(time / 60);
                const secs = Math.floor(time % 60);
                return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            };
            timeDisplay.innerText = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
        }
    });

    progressContainer.onclick = (e) => {
        if (!isNaN(video.duration)) {
            const rect = progressContainer.getBoundingClientRect();
            const posPct = (e.clientX - rect.left) / rect.width;
            video.currentTime = posPct * video.duration;
        }
    };

    // Anti-Piracy: Disable context menu right clicks inside player wrapper completely
    document.getElementById("vp-player-wrapper").addEventListener("contextmenu", (e) => {
        e.preventDefault();
        return false;
    });
};

// --- VP Admin Dashboard Rendering ---
async function renderVpAdminPanel() {
    const grid = document.getElementById("vp-admin-courses-grid");
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary-color);"></i><p style="margin-top: 10px;">Loading courses...</p></div>`;

    const courses = await dbGet("hawari_video_courses");
    const requests = await dbGet("hawari_video_requests");
    grid.innerHTML = "";

    if (courses.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; background: rgba(255,255,255,0.01); border-radius: 12px; border: 1px dashed var(--border-color);"><i class="fa-solid fa-folder-open" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 12px;"></i><h4 style="color: var(--text-secondary);">No Video Courses Found</h4><p style="font-size: 0.85rem; margin-top: 5px;">Create a new course using the creation form above.</p></div>`;
        return;
    }

    courses.forEach(course => {
        const approvedCount = requests.filter(r => r.course_id === course.id && r.status === "approved").length;
        const pendingCount = requests.filter(r => r.course_id === course.id && r.status === "pending").length;

        const card = document.createElement("div");
        card.className = "vp-course-card";
        card.innerHTML = `
            <div>
                <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">${sanitizeHTML(course.name)}</h3>
                <span style="font-size: 0.8rem; background: var(--border-color); color: var(--text-secondary); padding: 3px 8px; border-radius: 4px; font-weight: 600;">ID: ${course.id}</span>
                
                <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between;"><span class="text-muted">Instructor:</span> <strong style="color: var(--text-primary);">${sanitizeHTML(course.instructor_email)}</strong></div>
                    <div style="display: flex; justify-content: space-between;"><span class="text-muted">Expiration:</span> <strong style="color: var(--text-primary);">${course.end_date}</strong></div>
                    <div style="display: flex; justify-content: space-between;"><span class="text-muted">Active Users:</span> <strong style="color: var(--color-success);">${approvedCount} Approved</strong></div>
                    ${pendingCount > 0 ? `<div style="display: flex; justify-content: space-between;"><span class="text-muted">Pending Requests:</span> <strong style="color: var(--color-warning);">${pendingCount} Pending</strong></div>` : ''}
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                <button class="btn btn-primary" style="flex: 2; font-size: 0.82rem; padding: 10px;" onclick="enterVpWorkspace('${course.id}')">
                    <i class="fa-solid fa-arrow-right-to-bracket"></i> Enter Workspace
                </button>
                <button class="btn btn-danger" style="flex: 1; font-size: 0.82rem; padding: 10px;" onclick="deleteVpCourse('${course.id}')" title="Delete Course Completely">
                    <i class="fa-solid fa-trash-can"></i> Delete
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.enterVpWorkspace = async function(courseId) {
    const courses = await dbGet("hawari_video_courses", `id=eq.${courseId}`);
    if (courses.length > 0) {
        vpState.activeCourse = courses[0];
        
        // Show superadmin tab if current user role is 'admin'
        if (vpState.currentUser.role === "admin") {
            document.getElementById("vp-nav-superadmin-control").classList.remove("hidden");
        } else {
            document.getElementById("vp-nav-superadmin-control").classList.add("hidden");
        }

        // Set course registration URL
        const regUrl = `${window.location.origin}${window.location.pathname}#/video-subscribe?course_id=${courseId}`;
        document.getElementById("vp-course-reg-url-display").value = regUrl;

        // Instructors and assistant sidebar setup
        document.getElementById("vp-nav-admin-only-settings").classList.remove("hidden");
        document.getElementById("vp-admin-panel").classList.add("hidden");
        document.getElementById("vp-instructor-workspace").classList.remove("hidden");
        
        // Go to default tab
        document.getElementById("vp-nav-videos").click();
        loadWorkspaceContent();
    }
};

window.deleteVpCourse = async function(courseId) {
    if (!confirm("Caution: This will permanently delete this course, all its content videos, and all its active student registration records. Are you sure you want to continue?")) return;
    
    // Wipe course details
    await dbDelete("hawari_video_courses", `id=eq.${courseId}`);
    // Wipe course contents
    await dbDelete("hawari_video_content", `course_id=eq.${courseId}`);
    // Wipe course registration requests
    await dbDelete("hawari_video_requests", `course_id=eq.${courseId}`);
    // Wipe course subscriptions
    await dbDelete("hawari_video_subscriptions", `course_id=eq.${courseId}`);

    showToast("Course Deleted", "Course track and all nested records wiped.", "success");
    renderVpAdminPanel();
};

// --- VP Instructor Workspace Rendering ---
async function loadWorkspaceContent() {
    const course = vpState.activeCourse;
    document.getElementById("vp-active-course-name").innerText = course.name;
    document.getElementById("vp-active-course-expiry").innerText = `Expiration Date: ${course.end_date}`;

    // Hide Settings tab for assistant roles
    if (vpState.currentUser.role === "assistant") {
        document.getElementById("vp-nav-admin-only-settings").classList.add("hidden");
    } else {
        document.getElementById("vp-nav-admin-only-settings").classList.remove("hidden");
    }

    const content = await dbGet("hawari_video_content", `course_id=eq.${course.id}`);
    vpState.videos = content.filter(i => i.type === "regular");
    vpState.shorts = content.filter(i => i.type === "short");

    renderInstructorVideos();
    renderInstructorShorts();
    renderWorkspaceSubscriptions();
    renderWorkspaceSettings();
}

async function addVpSection(name, type) {
    const payload = {
        id: `sec_${Date.now()}`,
        course_id: vpState.activeCourse.id,
        name: name,
        type: type
    };
    await dbPost("hawari_video_sections", payload);
    showToast("Section Added", `Section "${name}" created successfully.`, "success");
    loadWorkspaceContent();
}

async function renderInstructorVideos() {
    const container = document.getElementById("vp-instructor-sections-videos-container");
    container.innerHTML = "";

    const sections = await dbGet("hawari_video_sections", `course_id=eq.${vpState.activeCourse.id}&type=eq.regular`);
    
    if (sections.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.01); border-radius: 12px; border: 1px dashed var(--border-color);"><i class="fa-solid fa-folder-open" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 12px;"></i><h4 style="color: var(--text-secondary);">No Sections Found</h4><p style="font-size: 0.85rem; margin-top: 5px;">Add a section first to start uploading regular videos.</p></div>`;
        return;
    }

    sections.forEach(sec => {
        const sectionVideos = vpState.videos.filter(v => v.section_id === sec.id);
        
        const secDiv = document.createElement("div");
        secDiv.style.cssText = "background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; margin-bottom: 20px;";
        
        let videosHtml = "";
        if (sectionVideos.length === 0) {
            videosHtml = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.85rem; border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px;">No videos uploaded in this section yet.</div>`;
        } else {
            videosHtml = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;">`;
            sectionVideos.forEach(vid => {
                const isLocal = vid.video_url.startsWith("indexeddb://");
                videosHtml += `
                    <div style="background: rgba(30, 41, 59, 0.25); border: 1px solid var(--border-color); border-radius: 12px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">${sanitizeHTML(vid.title)}</h4>
                            <p class="text-muted" style="font-size: 0.8rem; line-height: 1.4; height: 60px; overflow: hidden; margin-bottom: 12px;">${sanitizeHTML(vid.description || "No description provided.")}</p>
                            <div style="font-size: 0.72rem; color: var(--primary-color); word-break: break-all; margin-bottom: 12px;">
                                <i class="fa-solid ${isLocal ? 'fa-mobile-screen' : 'fa-cloud'}"></i> ${isLocal ? 'Offline Local Storage' : 'Cloud Remote URL'}
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 5px;">
                            <span class="text-muted" style="font-size: 0.75rem;">Uploaded: ${vid.created_at}</span>
                            <button class="btn btn-danger btn-sm" onclick="deleteVideoContent('${vid.id}')" style="padding: 5px 10px; border-radius: 6px; font-size: 0.75rem;"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>
                    </div>
                `;
            });
            videosHtml += `</div>`;
        }

        secDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0;">
                    <i class="fa-solid fa-folder-open" style="color: var(--primary-color);"></i>
                    <span>${sanitizeHTML(sec.name)}</span>
                </h3>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm" onclick="renameVpSection('${sec.id}', '${sec.name.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-pencil"></i> Rename
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteVpSection('${sec.id}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-trash"></i> Delete Section
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="showAddVideoForm('${sec.id}', '${sec.name.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-plus"></i> Add Video File
                    </button>
                </div>
            </div>
            ${videosHtml}
        `;
        container.appendChild(secDiv);
    });
}

async function renderInstructorShorts() {
    const container = document.getElementById("vp-instructor-sections-shorts-container");
    container.innerHTML = "";

    const sections = await dbGet("hawari_video_sections", `course_id=eq.${vpState.activeCourse.id}&type=eq.short`);
    
    if (sections.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.01); border-radius: 12px; border: 1px dashed var(--border-color);"><i class="fa-solid fa-folder-open" style="font-size: 2rem; color: var(--text-secondary); margin-bottom: 12px;"></i><h4 style="color: var(--text-secondary);">No Sections Found</h4><p style="font-size: 0.85rem; margin-top: 5px;">Add a section first to start uploading short videos.</p></div>`;
        return;
    }

    sections.forEach(sec => {
        const sectionShorts = vpState.shorts.filter(v => v.section_id === sec.id);
        
        const secDiv = document.createElement("div");
        secDiv.style.cssText = "background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; margin-bottom: 20px;";
        
        let shortsHtml = "";
        if (sectionShorts.length === 0) {
            shortsHtml = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.85rem; border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px;">No short videos uploaded in this section yet.</div>`;
        } else {
            shortsHtml = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;">`;
            sectionShorts.forEach(sh => {
                const isLocal = sh.video_url.startsWith("indexeddb://");
                shortsHtml += `
                    <div style="background: rgba(30, 41, 59, 0.25); border: 1px solid var(--border-color); border-radius: 12px; padding: 15px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>
                            <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px;">${sanitizeHTML(sh.title)}</h4>
                            <div style="font-size: 0.72rem; color: var(--primary-color); word-break: break-all; margin-bottom: 15px;">
                                <i class="fa-solid ${isLocal ? 'fa-mobile-screen' : 'fa-cloud'}"></i> ${isLocal ? 'Offline Local Storage' : 'Cloud Remote URL'}
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 10px;">
                            <span class="text-muted" style="font-size: 0.75rem;">Uploaded: ${sh.created_at}</span>
                            <button class="btn btn-danger btn-sm" onclick="deleteVideoContent('${sh.id}')" style="padding: 5px 10px; border-radius: 6px; font-size: 0.75rem;"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>
                    </div>
                `;
            });
            shortsHtml += `</div>`;
        }

        secDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0;">
                    <i class="fa-solid fa-folder-open" style="color: var(--primary-color);"></i>
                    <span>${sanitizeHTML(sec.name)}</span>
                </h3>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm" onclick="renameVpSection('${sec.id}', '${sec.name.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-pencil"></i> Rename
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteVpSection('${sec.id}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-trash"></i> Delete Section
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="showAddShortForm('${sec.id}', '${sec.name.replace(/'/g, "\\'")}')" style="padding: 4px 8px; font-size: 0.8rem;">
                        <i class="fa-solid fa-plus"></i> Add Short File
                    </button>
                </div>
            </div>
            ${shortsHtml}
        `;
        container.appendChild(secDiv);
    });
}

window.renameVpSection = async function(sectionId, currentName) {
    const newName = prompt("Rename Section:", currentName);
    if (newName && newName.trim()) {
        const sections = await dbGet("hawari_video_sections", `id=eq.${sectionId}`);
        if (sections.length > 0) {
            const sec = sections[0];
            sec.name = newName.trim();
            await dbPost("hawari_video_sections", sec);
            showToast("Section Renamed", "Section name updated successfully.", "success");
            loadWorkspaceContent();
        }
    }
};

window.deleteVpSection = async function(sectionId) {
    if (!confirm("Are you sure you want to delete this section? All videos inside it will be permanently deleted.")) return;
    
    await dbDelete("hawari_video_sections", `id=eq.${sectionId}`);
    const vids = await dbGet("hawari_video_content", `section_id=eq.${sectionId}`);
    for (const vid of vids) {
        await dbDelete("hawari_video_content", `id=eq.${vid.id}`);
        if (vid.video_url.startsWith("indexeddb://")) {
            const blobId = vid.video_url.split("indexeddb://")[1];
            await deleteVideoBlob(blobId);
        }
    }
    
    showToast("Section Deleted", "Section and all nested videos deleted.", "success");
    loadWorkspaceContent();
};

window.showAddVideoForm = function(sectionId, sectionName) {
    document.getElementById("vp-video-section-id").value = sectionId;
    document.getElementById("vp-add-video-title-lbl").innerText = `Add Video to Section: ${sectionName}`;
    document.getElementById("vp-add-video-box").classList.remove("hidden");
    document.getElementById("vp-add-video-box").scrollIntoView({ behavior: 'smooth' });
};

window.showAddShortForm = function(sectionId, sectionName) {
    document.getElementById("vp-short-section-id").value = sectionId;
    document.getElementById("vp-add-short-title-lbl").innerText = `Add Short to Section: ${sectionName}`;
    document.getElementById("vp-add-short-box").classList.remove("hidden");
    document.getElementById("vp-add-short-box").scrollIntoView({ behavior: 'smooth' });
};

window.deleteVideoContent = async function(contentId) {
    if (!confirm("Are you sure you want to delete this video file?")) return;
    
    const items = await dbGet("hawari_video_content", `id=eq.${contentId}`);
    if (items.length > 0) {
        const item = items[0];
        await dbDelete("hawari_video_content", `id=eq.${contentId}`);
        if (item.video_url.startsWith("indexeddb://")) {
            const blobId = item.video_url.split("indexeddb://")[1];
            await deleteVideoBlob(blobId);
        }
        showToast("Content Deleted", "Video file has been successfully removed.", "success");
        loadWorkspaceContent();
    }
};

async function renderWorkspaceSubscriptions() {
    const list = await dbGet("hawari_video_subscriptions", `course_id=eq.${vpState.activeCourse.id}`);
    vpState.subscriptions = list;

    const tbody = document.getElementById("vp-links-table-body");
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 30px; color: var(--text-secondary);">No subscription registration links generated.</td></tr>`;
        return;
    }

    const host = `${window.location.origin}${window.location.pathname}`;

    list.forEach(sub => {
        const regLink = `${host}#/video-subscribe?sub_id=${sub.id}`;
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${sanitizeHTML(sub.name)}</strong></td>
            <td><span style="font-weight: 600; color: var(--primary-color);">${sanitizeHTML(sub.price)}</span></td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="text" readonly value="${regLink}" style="padding: 6px; font-size: 0.78rem; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-secondary); width: 280px;">
                    <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${regLink}'); showToast('Copied', 'Registration URL copied to clipboard.', 'success');"><i class="fa-solid fa-copy"></i> Copy</button>
                </div>
            </td>
            <td class="text-right">
                <button class="btn btn-danger btn-sm" onclick="deleteSubLink('${sub.id}')" style="padding: 6px 12px; border-radius: 6px; font-size: 0.75rem;"><i class="fa-solid fa-trash-can"></i> Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.deleteSubLink = async function(subId) {
    if (!confirm("Are you sure you want to delete this registration link? Students will no longer be able to use it to sign up.")) return;
    await dbDelete("hawari_video_subscriptions", `id=eq.${subId}`);
    showToast("Link Deleted", "Subscription registration link removed.", "success");
    loadWorkspaceContent();
};

async function renderVpAdminControlPanel() {
    if (!vpState.activeCourse) return;

    // Fill form dates
    document.getElementById("vp-edit-start-date").value = vpState.activeCourse.start_date || "";
    document.getElementById("vp-edit-end-date").value = vpState.activeCourse.end_date || "";

    // Fill credentials form values
    document.getElementById("vp-edit-inst-email").value = vpState.activeCourse.instructor_email || "";
    document.getElementById("vp-edit-inst-pass").value = vpState.activeCourse.instructor_password || "";
    document.getElementById("vp-edit-asst-email").value = vpState.activeCourse.assistant_email || "";
    document.getElementById("vp-edit-asst-pass").value = vpState.activeCourse.assistant_password || "";
}

window.renderVpRequestsTable = async function(forceRefresh = false) {
    if (!vpState.activeCourse) return;
    if (forceRefresh || !vpState.requests || vpState.requests.length === 0) {
        const list = await dbGet("hawari_video_requests", `course_id=eq.${vpState.activeCourse.id}`);
        vpState.requests = list || [];
    }

    const tbody = document.getElementById("vp-requests-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const searchInput = document.getElementById("vp-requests-search");
    const filterInput = document.getElementById("vp-requests-filter");

    const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const filterVal = filterInput ? filterInput.value.trim().toLowerCase() : "all";

    let filtered = vpState.requests;

    vpState.requests.forEach(req => {
        const name = req.name || "";
        const email = req.email || "";
        const phone = req.phone || "";
        const code = req.student_code || "";
        
        // Apply search filter
        if (searchVal) {
            const matchName = name.toLowerCase().includes(searchVal);
            const matchEmail = email.toLowerCase().includes(searchVal);
            const matchPhone = phone.toLowerCase().includes(searchVal);
            const matchCode = code.toLowerCase().includes(searchVal);
            if (!matchName && !matchEmail && !matchPhone && !matchCode) return;
        }

        const currentStatus = (req.status || "pending").toLowerCase();
        let statusBadgeClass = "badge-pending";
        if (currentStatus === "approved") statusBadgeClass = "badge-active";
        if (currentStatus === "blocked") statusBadgeClass = "badge-blocked";

        // Apply tab filter
        if (filterVal !== "all" && currentStatus !== filterVal) return;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong style="color:var(--text-primary); font-weight:600;">${sanitizeHTML(name)}</strong></td>
            <td><span style="font-family:monospace; color:var(--text-secondary);">${sanitizeHTML(email)}</span></td>
            <td><span style="color:var(--text-secondary);">${sanitizeHTML(phone)}</span></td>
            <td><span class="badge" style="background:var(--border-color); color:var(--text-secondary); font-weight:600;">${sanitizeHTML(code)}</span></td>
            <td><span class="badge ${statusBadgeClass}">${currentStatus.toUpperCase()}</span></td>
            <td>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace;">
                        ${req.device_token ? req.device_token.substring(0, 10) + "..." : 'No lock'}
                    </span>
                    ${req.device_token ? `
                        <button class="btn btn-secondary btn-sm" onclick="resetDeviceFingerprint('${req.id}')" style="padding: 2px 6px; font-size: 0.7rem; border-radius: 4px;">
                            <i class="fa-solid fa-key"></i> Reset
                        </button>
                    ` : ''}
                </div>
            </td>
            <td class="text-right">
                <div style="display:flex; justify-content:flex-end; gap:6px;">
                    ${currentStatus !== "approved" ? `
                        <button class="btn btn-success btn-sm" onclick="updateRequestStatus('${req.id}', 'approved')" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px;">
                            <i class="fa-solid fa-check"></i> Approve
                        </button>
                    ` : ''}
                    ${currentStatus !== "blocked" ? `
                        <button class="btn btn-danger btn-sm" onclick="updateRequestStatus('${req.id}', 'blocked')" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px;">
                            <i class="fa-solid fa-ban"></i> Block
                        </button>
                    ` : ''}
                    <button class="btn btn-danger btn-sm" onclick="deleteVpRequest('${req.id}', '${req.email}')" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px; background-color: #ef4444; border-color: #ef4444;">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}
window.renderVpRequestsTable = renderVpRequestsTable;

window.updateRequestStatus = async function(id, newStatus) {
    if (!vpState.activeCourse) return;
    const req = vpState.requests.find(r => r.id === id);
    if (req) {
        req.status = newStatus;
        if (newStatus === "blocked") {
            req.device_token = "";
        }
        
        // Optimistically render UI instantly
        renderVpRequestsTable(false);

        // Update database in the background
        await dbPost("hawari_video_requests", req);
        showToast("Request Updated", `Student request status updated to ${newStatus.toUpperCase()}.`, "success");
    }
};

window.deleteVpRequest = async function(id, email) {
    if (!vpState.activeCourse) return;
    if (!confirm(`Are you sure you want to delete registration request for ${email}? They will be able to register again.`)) return;

    // Optimistically update UI instantly
    vpState.requests = vpState.requests.filter(r => r.id !== id);
    renderVpRequestsTable(false);

    // Delete from cloud DB in the background
    await dbDelete("hawari_video_requests", `id=eq.${id}`);
    showToast("Student Deleted", "Registration request deleted successfully.", "success");
};

window.resetDeviceFingerprint = async function(id) {
    if (!vpState.activeCourse) return;
    const req = vpState.requests.find(r => r.id === id);
    if (req) {
        req.device_token = "";
        renderVpRequestsTable(false);
        await dbPost("hawari_video_requests", req);
        showToast("Device Reset", "Student device lock has been cleared. Next login will register a new device.", "success");
    }
};

function renderWorkspaceSettings() {
    const course = vpState.activeCourse;
    const box = document.getElementById("vp-assistant-status-box");
    const label = document.getElementById("vp-assistant-email-lbl");

    if (course.assistant_email) {
        box.classList.remove("hidden");
        label.innerText = course.assistant_email;
    } else {
        box.classList.add("hidden");
        label.innerText = "";
    }
}

// --- VP Student Workspace Rendering ---
async function renderVpStudentWorkspace() {
    document.getElementById("vp-active-course-name").innerText = vpState.activeCourse.name;
    document.getElementById("vp-active-course-expiry").innerText = `Ends: ${vpState.activeCourse.end_date}`;
    
    // Hide administrative setting options for students
    document.getElementById("vp-nav-admin-only-settings").classList.add("hidden");

    // Load regular and shorts playlists
    const content = await dbGet("hawari_video_content", `course_id=eq.${vpState.activeCourse.id}`);
    vpState.videos = content.filter(i => i.type === "regular");
    vpState.shorts = content.filter(i => i.type === "short");

    // Select first tab
    document.getElementById("btn-vp-stud-tab-videos").click();

    // Start background checks for session validity
    startSessionValidityCheck();
}

async function renderStudentPlaylist() {
    const container = document.getElementById("vp-student-playlist");
    container.innerHTML = "";

    const isRegular = vpState.studentPlaylistTab === "videos";
    const type = isRegular ? "regular" : "short";

    const sections = await dbGet("hawari_video_sections", `course_id=eq.${vpState.activeCourse.id}&type=eq.${type}`);
    const playlist = isRegular ? vpState.videos : vpState.shorts;

    if (sections.length === 0) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No sections available.</div>`;
        return;
    }

    sections.forEach(sec => {
        const secVideos = playlist.filter(v => v.section_id === sec.id);
        if (secVideos.length === 0) return; // Skip empty sections

        const secHeader = document.createElement("div");
        secHeader.style.cssText = "font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); margin: 15px 10px 8px 10px; border-left: 3px solid var(--primary-color); padding-left: 8px; letter-spacing: 0.5px;";
        secHeader.innerText = sec.name;
        container.appendChild(secHeader);

        secVideos.forEach(vid => {
            const item = document.createElement("div");
            item.className = "vp-playlist-item";
            item.innerHTML = `
                <i class="fa-solid fa-play" style="font-size: 0.8rem; color: var(--text-secondary);"></i>
                <div style="flex-grow: 1;">
                    <h4 style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary); margin: 0; line-height: 1.3;">${sanitizeHTML(vid.title)}</h4>
                    ${vid.description ? `<p style="font-size: 0.72rem; color: var(--text-secondary); margin: 3px 0 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${sanitizeHTML(vid.description)}</p>` : ''}
                </div>
            `;
            
            item.onclick = async () => {
                const checkReq = await dbGet("hawari_video_requests", `email=eq.${vpState.currentUser.email}&course_id=eq.${vpState.activeCourse.id}`);
                if (checkReq.length === 0 || checkReq[0].status !== "approved") {
                    showToast("Access Revoked", "Your account has been deactivated or blocked.", "danger");
                    document.getElementById("btn-vp-exit").click();
                    return;
                }

                const playlistItems = container.querySelectorAll(".vp-playlist-item");
                playlistItems.forEach(i => i.classList.remove("active"));
                item.classList.add("active");

                playStudentVideo(vid);
            };

            container.appendChild(item);
        });
    });
}

function playStudentVideo(vid) {
    const video = document.getElementById("vp-main-video-player");
    
    // Revoke previous objectUrl if set
    if (video.dataset.objectUrl) {
        URL.revokeObjectURL(video.dataset.objectUrl);
        delete video.dataset.objectUrl;
    }

    if (vid.video_url.startsWith("indexeddb://")) {
        const id = vid.video_url.split("indexeddb://")[1];
        getVideoBlob(id).then(blob => {
            if (blob) {
                const objectUrl = URL.createObjectURL(blob);
                video.dataset.objectUrl = objectUrl;
                video.src = objectUrl;
                video.load();
                triggerPlay();
            } else {
                showToast("Video Not Found", "The local video file is not stored on this device.", "danger");
            }
        }).catch(err => {
            console.error("IndexedDB error:", err);
            showToast("Error Loading Video", "Could not load video from local storage.", "danger");
        });
    } else {
        video.src = vid.video_url;
        video.load();
        triggerPlay();
    }

    function triggerPlay() {
        document.getElementById("vp-student-video-title").innerText = vid.title;
        document.getElementById("vp-student-video-desc").innerText = vid.description || "No description provided.";

        const playBtn = document.getElementById("btn-vp-play-pause");
        video.play().then(() => {
            playBtn.innerHTML = `<i class="fa-solid fa-pause"></i>`;
        }).catch(err => {
            console.warn("Autoplay block. Wait for user gesture.", err);
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        });

        const stuCode = vpState.currentUser.student_code || "STUDENT";
        const phone = vpState.currentUser.phone || "01000000000";
        startWatermark(stuCode, phone);
    }
}

async function wipeSessionAndData(reason) {
    console.log("Wiping session and downloads. Reason: " + reason);
    
    // Clear student local storage session keys
    localStorage.removeItem("vp_session");
    
    // Clear IndexedDB video blobs if any exist
    try {
        const db = await initIndexedDB();
        const tx = db.transaction("videos", "readwrite");
        const store = tx.objectStore("videos");
        store.clear();
    } catch(e) {
        console.error("Error clearing IndexedDB videos:", e);
    }
    
    // Invoke native bridge to wipe all physical downloads
    if (window.AndroidBridge && typeof window.AndroidBridge.wipeAllVideos === "function") {
        try {
            window.AndroidBridge.wipeAllVideos();
        } catch(e) {
            console.error("Error invoking AndroidBridge.wipeAllVideos:", e);
        }
    }

    // Force student logout UI update and redirect to Auth screen
    vpState.currentUser = null;
    vpState.activeCourse = null;
    stopWatermark();
    stopSessionValidityCheck();
    const player = document.getElementById("vp-main-video-player");
    if (player) {
        player.pause();
        if (player.dataset.objectUrl) {
            URL.revokeObjectURL(player.dataset.objectUrl);
            delete player.dataset.objectUrl;
        }
        player.removeAttribute("src");
        player.load();
    }
    
    showToast("Access Blocked", `Your session has been terminated: ${reason}`, "danger");
    
    // Route back to auth panel
    document.getElementById("vp-student-workspace").classList.add("hidden");
    document.getElementById("vp-auth-panel").classList.remove("hidden");
    window.location.hash = "#video-portal";
    window.handleVideoPortalRouting("video-portal");
}
window.wipeSessionAndData = wipeSessionAndData;

async function checkSessionValidity() {
    if (!vpState.currentUser || vpState.currentUser.role !== "student") return true;
    
    try {
        const email = vpState.currentUser.email;
        const courseId = vpState.currentUser.course_id;
        
        // Fetch current status from database
        const checkReq = await dbGet("hawari_video_requests", `email=eq.${email}&course_id=eq.${courseId}`);
        if (checkReq.length === 0) {
            await wipeSessionAndData("Account deleted by administrator.");
            return false;
        }
        
        const req = checkReq[0];
        if (req.status !== "approved") {
            await wipeSessionAndData("Account is no longer active (status: " + req.status.toUpperCase() + ").");
            return false;
        }
        
        // If Android device, make sure device token matches or is set
        if (window.AndroidBridge && typeof window.AndroidBridge.getDeviceToken === "function") {
            const currentToken = window.AndroidBridge.getDeviceToken();
            if (req.device_token && req.device_token !== currentToken) {
                await wipeSessionAndData("Logged in on another device.");
                return false;
            }
        }
        return true;
    } catch (e) {
        console.error("Error during checkSessionValidity:", e);
        return true; // Don't wipe on random network error to allow offline use
    }
}
window.checkSessionValidity = checkSessionValidity;

let sessionValidityTimer = null;
function startSessionValidityCheck() {
    if (sessionValidityTimer) clearInterval(sessionValidityTimer);
    
    // Run immediately first
    checkSessionValidity();
    
    // Check every 30 seconds
    sessionValidityTimer = setInterval(async () => {
        const isValid = await checkSessionValidity();
        if (!isValid) {
            clearInterval(sessionValidityTimer);
            sessionValidityTimer = null;
        }
    }, 30000);
}
window.startSessionValidityCheck = startSessionValidityCheck;

function stopSessionValidityCheck() {
    if (sessionValidityTimer) {
        clearInterval(sessionValidityTimer);
        sessionValidityTimer = null;
    }
}
window.stopSessionValidityCheck = stopSessionValidityCheck;

let watermarkTimer = null;
function startWatermark(studentCode, phone) {
    const watermarkEl = document.getElementById("vp-moving-watermark");
    if (!watermarkEl) return;
    watermarkEl.innerText = `${studentCode} | ${phone}`;
    watermarkEl.classList.add("vp-watermark-active");
    
    if (watermarkTimer) clearInterval(watermarkTimer);
    watermarkTimer = setInterval(() => {
        const x = Math.floor(Math.random() * 70) + 5;
        const y = Math.floor(Math.random() * 70) + 5;
        watermarkEl.style.top = y + "%";
        watermarkEl.style.left = x + "%";
    }, 4000);
}

function stopWatermark() {
    if (watermarkTimer) {
        clearInterval(watermarkTimer);
        watermarkTimer = null;
    }
}

// Supabase Storage & IndexedDB Fallback helpers
async function uploadFileToSupabase(file, courseId, contentId, progressCallback) {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
    
    const cleanUrl = baseUrl.replace(/\/$/, '');
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const path = `hawari_videos/${courseId}/${contentId}_${cleanFileName}`;
    const uploadUrl = `${cleanUrl}/storage/v1/object/${path}`;

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl, true);
        xhr.setRequestHeader("apikey", anonKey);
        const token = (state.currentUser && state.currentUser.token) ? state.currentUser.token : anonKey;
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                if (progressCallback) progressCallback(pct);
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
                const publicUrl = `${cleanUrl}/storage/v1/object/public/${path}`;
                resolve(publicUrl);
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
            }
        };

        xhr.onerror = () => {
            reject(new Error("Network error during file upload to Supabase Storage."));
        };

        xhr.send(file);
    });
}

let dbInstance = null;
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);
        const request = indexedDB.open("hawari_video_db", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("videos")) {
                db.createObjectStore("videos");
            }
        };
        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };
        request.onerror = (e) => {
            reject(e.target.error);
        };
    });
}

async function saveVideoBlob(id, blob) {
    const db = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("videos", "readwrite");
        const store = tx.objectStore("videos");
        const request = store.put(blob, id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

async function getVideoBlob(id) {
    const db = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("videos", "readonly");
        const store = tx.objectStore("videos");
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteVideoBlob(id) {
    const db = await initIndexedDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("videos", "readwrite");
        const store = tx.objectStore("videos");
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

// ================= HAWARI BOOK & CANVAS ANNOTATOR ENGINE =================
let bookState = {
    currentPage: 1,
    numPages: 0,
    zoom: 1.0,
    fitMode: "normal", // "normal" | "fit-width" | "fit-page"
    activeTool: "pan", // "pan"|"select"|"lasso"|"pen"|"highlighter"|"text"|"underline"|"strikethrough"|"circle"|"rectangle"|"arrow"|"laser"|"eraser"
    activeColor: "#2563eb",
    strokeSize: 4,
    isDrawing: false,
    annotations: {}, // { [pageNumber]: [annotationObj1, ...] }
    historyStack: {}, // { [pageNumber]: { undo: [], redo: [] } }
    bookmarks: [], // array of page numbers e.g. [1, 5, 12]
    extraPages: {}, // { [pageNumber]: 'blank' | 'lined' }
    activeBookFile: null, // Dynamic active book object. NO DEFAULT 120-page dummy fallback!
    userProgressMap: {}
};

// ================= CANVAS ANNOTATOR HISTORY & UNDO / REDO ENGINE =================
function saveHistoryState(page) {
    if (!page) page = bookState.currentPage;
    if (!bookState.historyStack) bookState.historyStack = {};
    if (!bookState.historyStack[page]) {
        bookState.historyStack[page] = { undo: [], redo: [] };
    }
    const currentAnn = bookState.annotations[page] ? JSON.parse(JSON.stringify(bookState.annotations[page])) : [];
    bookState.historyStack[page].undo.push(currentAnn);
    if (bookState.historyStack[page].undo.length > 25) {
        bookState.historyStack[page].undo.shift();
    }
    bookState.historyStack[page].redo = [];
}
window.saveHistoryState = saveHistoryState;

function undoBookPageAction() {
    const page = bookState.currentPage;
    if (!bookState.historyStack || !bookState.historyStack[page] || !bookState.historyStack[page].undo || !bookState.historyStack[page].undo.length) {
        showToast("Undo", "No previous actions to undo on this page.", "info");
        return;
    }
    const currentAnn = bookState.annotations[page] ? JSON.parse(JSON.stringify(bookState.annotations[page])) : [];
    if (!bookState.historyStack[page].redo) bookState.historyStack[page].redo = [];
    bookState.historyStack[page].redo.push(currentAnn);
    const prevState = bookState.historyStack[page].undo.pop();
    bookState.annotations[page] = prevState || [];
    bookState.selectedAnnotationIndex = null;
    saveBookPageAnnotationToCloud(page);
    redrawBookCanvas();
    showToast("Undo", `Reverted last change on Page ${page}`, "info");
}
window.undoBookPageAction = undoBookPageAction;

function redoBookPageAction() {
    const page = bookState.currentPage;
    if (!bookState.historyStack || !bookState.historyStack[page] || !bookState.historyStack[page].redo || !bookState.historyStack[page].redo.length) {
        showToast("Redo", "No actions to redo on this page.", "info");
        return;
    }
    const currentAnn = bookState.annotations[page] ? JSON.parse(JSON.stringify(bookState.annotations[page])) : [];
    if (!bookState.historyStack[page].undo) bookState.historyStack[page].undo = [];
    bookState.historyStack[page].undo.push(currentAnn);
    const nextState = bookState.historyStack[page].redo.pop();
    bookState.annotations[page] = nextState || [];
    bookState.selectedAnnotationIndex = null;
    saveBookPageAnnotationToCloud(page);
    redrawBookCanvas();
    showToast("Redo", `Redid last action on Page ${page}`, "info");
}
window.redoBookPageAction = redoBookPageAction;

// Check if a user email is authorized for Hawari Book access

// Centralized Access Level Calculator
function getBookAccessLevel(user) {
    if (!user || !user.email) return { isFullGrant: false, maxPage: 10 };
    
    const cleanEmail = user.email.trim().toLowerCase();
    const isAdmin = user.role === "admin" || user.role === "instructor" || user.is_admin === true;
    
    let isGranted = false;
    if (Array.isArray(state.grantedBookUsers)) {
        isGranted = state.grantedBookUsers.some(e => String(e).trim().toLowerCase() === cleanEmail);
    }
    if (!isGranted) {
        try {
            const cached = localStorage.getItem(getGroupKey("hawari_granted_book_users"));
            if (cached) {
                const list = JSON.parse(cached);
                if (Array.isArray(list)) {
                    isGranted = list.some(e => String(e).trim().toLowerCase() === cleanEmail);
                }
            }
        } catch (e) {}
    }

    if (isAdmin || isGranted) {
        return { isFullGrant: true, maxPage: bookState.numPages || 9999 };
    }
    return { isFullGrant: false, maxPage: Math.min(10, bookState.numPages || 10) };
}

function isUserBookAuthorized(user) {
    return getBookAccessLevel(user).isFullGrant;
}

// Fetch Granted Users List from Supabase Table hawari_book_access (Scoped per course)
async function fetchGrantedUsersList() {
    try {
        const rows = await supabaseRequest("hawari_book_access?select=email,status");
        const activeTag = `::${state.activeGroup}`;
        if (rows && Array.isArray(rows)) {
            const filtered = [];
            rows.forEach(r => {
                if (!r || !r.email) return;
                const em = r.email.trim().toLowerCase();
                if (em.endsWith(activeTag.toLowerCase())) {
                    const pureEmail = em.slice(0, -activeTag.length).trim().toLowerCase();
                    if (pureEmail && !filtered.includes(pureEmail)) filtered.push(pureEmail);
                } else if (!em.includes("::") && state.activeGroup === "infection") {
                    // Backward-compatibility: Untagged legacy rows belong to infection
                    if (!filtered.includes(em)) filtered.push(em);
                }
            });
            state.grantedBookUsers = filtered;
            localStorage.setItem(getGroupKey("hawari_granted_book_users"), JSON.stringify(state.grantedBookUsers));
        } else {
            const cached = localStorage.getItem(getGroupKey("hawari_granted_book_users"));
            state.grantedBookUsers = cached ? JSON.parse(cached) : [];
        }
    } catch (e) {
        console.warn("[FullGrant] Could not fetch hawari_book_access table:", e.message);
        const cached = localStorage.getItem(getGroupKey("hawari_granted_book_users"));
        state.grantedBookUsers = cached ? JSON.parse(cached) : [];
    }
    renderGrantedUsersList();
}

function renderGrantedUsersList() {
    const listEl = document.getElementById("admin-book-authorized-list");
    const countEl = document.getElementById("admin-book-authorized-count");
    if (countEl) countEl.innerText = (state.grantedBookUsers || []).length;
    if (!listEl) return;

    listEl.innerHTML = "";
    if (!state.grantedBookUsers || state.grantedBookUsers.length === 0) {
        listEl.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No Full Grant users added yet for this course.</div>';
        return;
    }

    state.grantedBookUsers.forEach(email => {
        const row = document.createElement("div");
        row.className = "flex-between";
        row.style.cssText = "padding: 10px 14px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px;";
        row.innerHTML = `
            <span style="font-weight: 500; font-size: 0.85rem;"><i class="fa-solid fa-user-check" style="color: var(--color-success); margin-right: 6px;"></i> ${escapeHTML(email)}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span class="badge badge-success" style="font-size: 0.7rem;">FULL GRANT (${escapeHTML((state.activeGroup || '').toUpperCase())})</span>
                <button class="btn btn-danger" style="padding: 4px 10px; font-size: 0.75rem;" onclick="revokeStudentBookAccess('${escapeHTML(email)}')">
                    <i class="fa-solid fa-user-xmark"></i> Revoke
                </button>
            </div>
        `;
        listEl.appendChild(row);
    });
}

async function grantBookAccess(email) {
    if (!email) return false;
    const cleanEmail = email.trim().toLowerCase();
    const taggedEmail = `${cleanEmail}::${state.activeGroup}`;
    
    try {
        const payload = {
            email: taggedEmail,
            status: "active",
            granted_at: new Date().toISOString()
        };
        const dbRes = await supabaseRequest("hawari_book_access", {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify(payload)
        });

        if (dbRes && dbRes.error) {
            console.error("[FullGrant] Grant failed:", dbRes.error);
            showToast("Grant Error", `Could not grant access: ${dbRes.error.message || JSON.stringify(dbRes.error)}`, "danger");
            return false;
        }

        showToast("Full Grant Applied", `Full grant access granted to ${cleanEmail} for ${state.activeGroup.toUpperCase()}`, "success");
        if (!state.grantedBookUsers.includes(cleanEmail)) {
            state.grantedBookUsers.push(cleanEmail);
        }
        localStorage.setItem(getGroupKey("hawari_granted_book_users"), JSON.stringify(state.grantedBookUsers));
        renderGrantedUsersList();
        redrawBookCanvas();
        return true;
    } catch (e) {
        console.error("[FullGrant] Exception during grant:", e);
        showToast("Error", e.message || "Failed to grant access", "danger");
        return false;
    }
}

window.revokeStudentBookAccess = async function(email) {
    if (!email) return;
    const cleanEmail = email.trim().toLowerCase();
    const taggedEmail = `${cleanEmail}::${state.activeGroup}`;
    
    try {
        await supabaseRequest(`hawari_book_access?email=in.("${encodeURIComponent(taggedEmail)}","${encodeURIComponent(cleanEmail)}")`, {
            method: "DELETE"
        });

        state.grantedBookUsers = state.grantedBookUsers.filter(e => e.toLowerCase() !== cleanEmail);
        localStorage.setItem(getGroupKey("hawari_granted_book_users"), JSON.stringify(state.grantedBookUsers));
        showToast("Access Revoked", `Full grant access revoked for ${cleanEmail} (${state.activeGroup})`, "info");
        renderGrantedUsersList();
        
        // Immediately enforce page 10 limit if revoked user is active
        if (state.currentUser && state.currentUser.email.toLowerCase() === cleanEmail) {
            if (bookState.currentPage > 10) {
                bookState.currentPage = 10;
            }
        }
        redrawBookCanvas();
    } catch (e) {
        console.error("[FullGrant] Exception during revoke:", e);
        showToast("Error", e.message || "Failed to revoke access", "danger");
    }
};

// ==========================================
// RESTORED HAWARI BOOK UTILITIES & SYNC
// ==========================================

function initBookDrmProtection() {
    const bookView = document.getElementById("hawari-book-view");
    const viewport = document.getElementById("book-canvas-viewport");
    if (!bookView || bookView.dataset.drmBound) return;
    bookView.dataset.drmBound = "true";

    // 1. Context Menu & Selection Blocker
    bookView.addEventListener("contextmenu", (e) => e.preventDefault());
    bookView.addEventListener("copy", (e) => e.preventDefault());
    bookView.addEventListener("cut", (e) => e.preventDefault());
    bookView.addEventListener("dragstart", (e) => e.preventDefault());

    // 2. Keyboard Shortcut Blocker (Ctrl+P, Ctrl+S, Ctrl+U, F12, PrintScreen)
    window.addEventListener("keydown", (e) => {
        if (!state.activeView || state.activeView !== "hawari-book") return;
        const key = e.key ? e.key.toLowerCase() : "";
        if (
            (e.ctrlKey && (key === "p" || key === "s" || key === "u")) ||
            (e.ctrlKey && e.shiftKey && key === "i") ||
            key === "f12" ||
            key === "printscreen"
        ) {
            e.preventDefault();
            e.stopPropagation();
            showToast("Action Blocked", "Printing, saving, or inspecting Hawari Book content is disabled.", "danger");
            return false;
        }

        // Undo / Redo Shortcuts
        if (e.ctrlKey && e.shiftKey && (key === "z" || key === "Z")) {
            e.preventDefault();
            redoBookPageAction();
        } else if (e.ctrlKey && key === "z") {
            e.preventDefault();
            undoBookPageAction();
        } else if (e.ctrlKey && key === "y") {
            e.preventDefault();
            redoBookPageAction();
        }
    });

    // 3. Screen Protection Auto-Blur on Window Focus Loss
    window.addEventListener("blur", () => {
        if (state.activeView === "hawari-book" && viewport) {
            viewport.classList.add("canvas-blurred");
        }
    });
    window.addEventListener("focus", () => {
        if (viewport) {
            viewport.classList.remove("canvas-blurred");
        }
    });

    // 4. Populate Floating Student Email Watermark
    updateBookWatermark();
}

function updateBookWatermark() {
    const watermarkEl = document.getElementById("book-watermark-overlay");
    if (!watermarkEl) return;
    const email = state.currentUser ? (state.currentUser.email || "STUDENT-ACCESS") : "STUDENT-ACCESS";
    
    // Exactly 4 static watermarks positioned in a balanced 2x2 grid inside the book page
    watermarkEl.innerHTML = `
        <div style="position: absolute; top: 18%; left: 15%; transform: rotate(-25deg); pointer-events: none; user-select: none; font-weight: 700; font-size: 0.95rem; color: rgba(100, 116, 139, 0.18); letter-spacing: 1px; font-family: Outfit, sans-serif;">
            ${escapeHTML(email)}
        </div>
        <div style="position: absolute; top: 18%; right: 15%; transform: rotate(-25deg); pointer-events: none; user-select: none; font-weight: 700; font-size: 0.95rem; color: rgba(100, 116, 139, 0.18); letter-spacing: 1px; font-family: Outfit, sans-serif;">
            ${escapeHTML(email)}
        </div>
        <div style="position: absolute; top: 68%; left: 15%; transform: rotate(-25deg); pointer-events: none; user-select: none; font-weight: 700; font-size: 0.95rem; color: rgba(100, 116, 139, 0.18); letter-spacing: 1px; font-family: Outfit, sans-serif;">
            ${escapeHTML(email)}
        </div>
        <div style="position: absolute; top: 68%; right: 15%; transform: rotate(-25deg); pointer-events: none; user-select: none; font-weight: 700; font-size: 0.95rem; color: rgba(100, 116, 139, 0.18); letter-spacing: 1px; font-family: Outfit, sans-serif;">
            ${escapeHTML(email)}
        </div>
    `;
}

function updateAdminActiveBookUI() {
    const container = document.getElementById("admin-active-book-info");
    const countBadge = document.getElementById("admin-books-count-badge");
    const oldBtn = document.getElementById("btn-admin-delete-book-pdf");
    if (oldBtn) oldBtn.style.display = "none";

    const books = state.books || [];
    const activeGroup = (state.activeGroup || "infection").toLowerCase();
    const groupBooks = books.filter(b => (b.group_name || "infection").toLowerCase() === activeGroup);

    if (countBadge) {
        countBadge.innerText = `${groupBooks.length} كتب`;
    }

    if (!container) return;

    if (groupBooks.length === 0) {
        container.innerHTML = `
            <div style="padding: 16px; background: var(--bg-primary); border-radius: 8px; text-align: center; color: var(--text-secondary); font-size: 0.85rem; border: 1px dashed var(--border-color);">
                <i class="fa-solid fa-book-open" style="margin-bottom: 8px; font-size: 1.4rem; display: block; opacity: 0.5;"></i>
                لا توجد كتب مرفوعة لهذا المساق حالياً. استخدم نموذج الرفع أعلاه لإضافة كتاب جديد.
            </div>
        `;
        return;
    }

    let html = `
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; padding-right: 4px;">
    `;

    groupBooks.forEach((book, index) => {
        const safeTitle = escapeHTML(book.title || "Untitled Book");
        const safeId = escapeHTML(book.id);
        const pages = book.total_pages || 1;
        const uploadDate = book.uploaded_at ? new Date(book.uploaded_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
        const isActiveBook = bookState.activeBookFile && bookState.activeBookFile.id === book.id;

        html += `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; background: var(--bg-primary); border: 1px solid ${isActiveBook ? 'var(--primary-color)' : 'var(--border-color)'}; border-radius: 8px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <i class="fa-solid fa-file-pdf" style="color: var(--color-danger); margin-right: 4px;"></i> ${safeTitle}
                        </span>
                        ${isActiveBook ? '<span class="badge badge-success" style="font-size: 0.65rem; padding: 2px 6px;">نشط حالياً</span>' : ''}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 3px;">
                        <span><i class="fa-solid fa-file-lines"></i> ${pages} صفحة</span>
                        ${uploadDate ? `<span style="margin: 0 6px;">•</span><span>${uploadDate}</span>` : ""}
                    </div>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="openBook('${safeId}')" title="فتح ومعاينة الكتاب" style="padding: 5px 10px; font-size: 0.75rem; border-radius: 6px;">
                        <i class="fa-solid fa-eye"></i> فتح
                    </button>
                    <button type="button" class="btn btn-danger btn-sm" onclick="deleteAdminBook('${safeId}', '${safeTitle.replace(/'/g, "\\'")}')" title="حذف الكتاب نهائياً من المكتبة" style="padding: 5px 10px; font-size: 0.75rem; border-radius: 6px;">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// Fetch list of books from Supabase / localStorage with course-awareness & race condition protection
let _activeBookFetchId = 0;

async function fetchBookLibraryData(targetGroup = null) {
    const requestedGroup = (targetGroup || state.activeGroup || "infection").toLowerCase().trim();
    const currentFetchId = ++_activeBookFetchId;
    const url = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
    const cleanUrl = url.replace(/\/$/, "");

    console.log(`[BookDebug] Fetching books from Supabase for: ${requestedGroup} (Fetch ID: ${currentFetchId})`);

    let collectedBooks = [];
    let serverSuccess = false;

    // Strategy A: Query hawari_book_files table directly
    try {
        const resA = await fetch(`${cleanUrl}/rest/v1/hawari_book_files?group_name=eq.${encodeURIComponent(requestedGroup)}&order=uploaded_at.desc`, {
            headers: { "apikey": anonKey, "Authorization": `Bearer ${anonKey}` }
        });
        if (resA.ok) {
            const dataA = await resA.json();
            if (Array.isArray(dataA)) {
                serverSuccess = true;
                const activeOnly = dataA.filter(b => (!b.status || b.status === "active") && (b.group_name || "infection").toLowerCase().trim() === requestedGroup);
                collectedBooks.push(...activeOnly);
                console.log(`[BookDebug] Supabase returned: ${activeOnly.length} books for ${requestedGroup}`);
            }
        } else {
            console.warn(`[BookDebug] Strategy A (hawari_book_files) response not ok: ${resA.status}`);
        }
    } catch (eA) {
        console.warn("[BookDebug] Strategy A warning:", eA.message);
    }

    // Strategy B: Query admin records in hawari_users for fallback synchronization
    try {
        const resB = await fetch(`${cleanUrl}/rest/v1/hawari_users?role=eq.admin&group_name=eq.${encodeURIComponent(requestedGroup)}&select=email,report_task_progress`, {
            headers: { "apikey": anonKey, "Authorization": `Bearer ${anonKey}` }
        });
        if (resB.ok) {
            const users = await resB.json();
            if (Array.isArray(users)) {
                users.forEach(u => {
                    const userBooks = (u.report_task_progress && Array.isArray(u.report_task_progress.books)) ? u.report_task_progress.books : [];
                    const matching = userBooks.filter(b => (b.group_name || "infection").toLowerCase().trim() === requestedGroup);
                    collectedBooks.push(...matching);
                });
                if (users.length > 0) serverSuccess = true;
                console.log(`[BookDebug] Strategy B found books count: ${collectedBooks.length}`);
            }
        }
    } catch (eB) {
        console.warn("[BookDebug] Strategy B warning:", eB.message);
    }

    // Deduplicate collected books by ID and Title
    const uniqueMap = new Map();
    collectedBooks.forEach(b => {
        if (b && b.id && !uniqueMap.has(b.id)) {
            uniqueMap.set(b.id, b);
        }
    });

    const finalBooks = Array.from(uniqueMap.values());

    // Race condition check: Verify active course didn't change while awaiting fetch
    const currentActive = (state.activeGroup || "infection").toLowerCase().trim();
    if (currentActive !== requestedGroup) {
        console.log(`[BookDebug] Ignoring stale response for: ${requestedGroup}, current group: ${currentActive}`);
        // Still save to local storage for the requested group so it's ready when user returns
        if (serverSuccess || finalBooks.length > 0) {
            try {
                localStorage.setItem("hawari_books_" + requestedGroup, JSON.stringify(finalBooks));
            } catch(e){}
        }
        return state.books;
    }

    if (serverSuccess || finalBooks.length > 0) {
        state.books = finalBooks;
        try {
            localStorage.setItem("hawari_books_" + requestedGroup, JSON.stringify(state.books));
        } catch(err){}
    } else {
        // Fallback to local cache only if server could not be reached
        const local = localStorage.getItem("hawari_books_" + requestedGroup);
        if (local) {
            try {
                const parsed = JSON.parse(local);
                if (Array.isArray(parsed)) {
                    state.books = parsed.filter(b => (b.group_name || "infection").toLowerCase().trim() === requestedGroup);
                }
            } catch(e){}
        }
    }

    console.log(`[BookDebug] fetchBookLibraryData FINISHED for ${requestedGroup} — state.books count: ${state.books.length}`);
    updateAdminActiveBookUI();
    return state.books;
}

// Save user reading progress for active book (debounced to save traffic)
let saveProgressTimeout = null;
async function saveUserBookProgress() {
    if (!state.currentUser || !bookState.activeBookFile) return;

    const docId = bookState.activeBookFile.id;
    const page = bookState.currentPage;
    const email = state.currentUser.email.trim().toLowerCase();
    const group = (state.activeGroup || "infection").toLowerCase();

    // Immediately save to LocalStorage (local first)
    localStorage.setItem(`hawari_progress_${email}_${docId}`, page.toString());

    // Debounce the Supabase DB write by 3 seconds
    if (saveProgressTimeout) clearTimeout(saveProgressTimeout);
    saveProgressTimeout = setTimeout(async () => {
        const payload = {
            email: email,
            document_id: docId,
            last_page: page,
            total_pages: bookState.numPages || 1,
            group_name: group,
            updated_at: new Date().toISOString()
        };

        try {
            const result = await supabaseRequest("hawari_user_book_progress?on_conflict=email,document_id", {
                method: "POST",
                headers: { "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify(payload)
            });
            if (result && result.success === false) {
                console.warn(`[BookProgress] Cloud sync returned error (${result.status}):`, result.error);
            } else {
                console.log(`[BookProgress] Debounced sync: Saved page progress ${page} of ${docId} to cloud.`);
            }
        } catch (e) {
            console.warn("[BookProgress] Debounced sync fallback:", e);
        }
    }, 3000);
}

async function fetchUserBookProgress(bookId) {
    if (!state.currentUser || !bookId) return 1;
    const email = state.currentUser.email.trim().toLowerCase();

    // 1. Try to fetch latest reading progress from cloud
    try {
        const query = `hawari_user_book_progress?email=eq.${encodeURIComponent(email)}&document_id=eq.${encodeURIComponent(bookId)}&select=last_page`;
        const rows = await supabaseRequest(query);
        if (Array.isArray(rows) && rows.length > 0 && rows[0].last_page) {
            const p = parseInt(rows[0].last_page, 10);
            if (!isNaN(p) && p >= 1) {
                localStorage.setItem(`hawari_progress_${email}_${bookId}`, p.toString());
                return p;
            }
        }
    } catch (e) {
        console.warn("[BookProgress] Cloud progress fetch fallback:", e);
    }

    // 2. Fallback to local storage if cloud is unreachable
    const local = localStorage.getItem(`hawari_progress_${email}_${bookId}`);
    if (local) {
        const p = parseInt(local, 10);
        if (!isNaN(p) && p >= 1) return p;
    }

    return 1;
}

// Render book cards inside book-library-grid
async function renderBookLibrary(filterCategory = "all", searchQuery = "", skipCloudFetch = false) {
    const gridEl = document.getElementById("book-library-grid");
    const emptyEl = document.getElementById("book-library-empty");
    if (!gridEl) {
        console.warn("[BookLibrary] renderBookLibrary ABORTED — book-library-grid element NOT FOUND in DOM");
        return;
    }

    const activeGroup = (state.activeGroup || "infection").toLowerCase().trim();
    console.log(`[BookDebug] renderBookLibrary CALLED — activeGroup: ${activeGroup}, filter: ${filterCategory}, skipCloud: ${skipCloudFetch}`);

    // 1. Local-first: Check if state.books has matching books for the current group
    let hasMatchingMemoryBooks = Array.isArray(state.books) && state.books.some(b => (b.group_name || "infection").toLowerCase().trim() === activeGroup);

    if (!hasMatchingMemoryBooks) {
        const local = localStorage.getItem("hawari_books_" + activeGroup);
        if (local) {
            try {
                const parsed = JSON.parse(local);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    state.books = parsed.filter(b => (b.group_name || "infection").toLowerCase().trim() === activeGroup);
                    console.log(`[BookDebug] Pre-loaded from localStorage for instant render: ${state.books.length} books`);
                }
            } catch(e){}
        }
    }

    let booksList = (state.books || []).filter(b => (b.group_name || "infection").toLowerCase().trim() === activeGroup);

    // Apply search filter
    if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        booksList = booksList.filter(b => (b.title || "").toLowerCase().includes(q));
    }

    console.log(`[BookDebug] Local books count before cloud check: ${booksList.length}`);

    // CASE A: Cached/in-memory books exist -> render immediately, then refresh from cloud in background
    if (booksList.length > 0) {
        _renderBookCards(booksList, gridEl, emptyEl, filterCategory, searchQuery);
        updateAdminActiveBookUI();

        if (!skipCloudFetch) {
            fetchBookLibraryData(activeGroup).then((updatedBooks) => {
                const currentGroup = (state.activeGroup || "infection").toLowerCase().trim();
                if (currentGroup === activeGroup) {
                    renderBookLibrary(filterCategory, searchQuery, true);
                }
            }).catch(err => {
                console.error("[BookDebug] Async cloud fetch failed:", err);
            });
        }
        return;
    }

    // CASE B: No local books exist -> Show loading spinner and fetch from Supabase
    if (!skipCloudFetch) {
        gridEl.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; color: var(--primary-color); margin-bottom: 12px; display: block;"></i>
                <span style="font-weight: 500; font-size: 0.95rem;">جاري تحميل كتب المساق من السحابة...</span>
            </div>
        `;
        gridEl.classList.remove("hidden");
        if (emptyEl) emptyEl.classList.add("hidden");

        fetchBookLibraryData(activeGroup).then((freshBooks) => {
            const currentGroup = (state.activeGroup || "infection").toLowerCase().trim();
            if (currentGroup === activeGroup) {
                renderBookLibrary(filterCategory, searchQuery, true);
            }
        }).catch(err => {
            console.error("[BookDebug] Initial cloud fetch error:", err);
            gridEl.classList.add("hidden");
            if (emptyEl) emptyEl.classList.remove("hidden");
            updateAdminActiveBookUI();
        });
        return;
    }

    // CASE C: Cloud fetch already completed (skipCloudFetch === true) and returned 0 books -> Show proper empty state
    gridEl.innerHTML = "";
    gridEl.classList.add("hidden");
    if (emptyEl) emptyEl.classList.remove("hidden");
    updateAdminActiveBookUI();
}

function _renderBookCards(booksList, gridEl, emptyEl, filterCategory, searchQuery) {
    gridEl.innerHTML = "";
    gridEl.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    const isAdmin = state.currentUser && (state.currentUser.role === "admin" || state.currentUser.role === "instructor" || state.currentUser.is_admin === true);
    const email = state.currentUser ? (state.currentUser.email || "").trim().toLowerCase() : "";

    const getLocalProgress = (bookId) => {
        if (!email || !bookId) return 1;
        try {
            const stored = localStorage.getItem(`hawari_progress_${email}_${bookId}`);
            if (stored) return parseInt(stored, 10) || 1;
        } catch (e) {}
        return 1;
    };

    console.log(`[BookDebug] Rendering: ${booksList.length} book cards`);

    for (const book of booksList) {
        try {
            const cachedPage = getLocalProgress(book.id);
            const totalPages = book.total_pages || 1;
            const pct = Math.min(100, Math.round((cachedPage / totalPages) * 100));

            let gradient = "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)";
            if (book.group_name === "infection") gradient = "linear-gradient(135deg, #1e40af 0%, #1e1b4b 100%)";
            else if (book.group_name === "dermatology") gradient = "linear-gradient(135deg, #9d174d 0%, #4c0519 100%)";

            const card = document.createElement("div");
            card.className = "hawari-book-card";
            const safeTitle = escapeHTML(book.title).replace(/'/g, "\\\\'");
            card.innerHTML = `
                <div class="book-card-cover" style="background: ${gradient};">
                    <span class="book-cover-badge">${escapeHTML((book.group_name || "Course").toUpperCase())}</span>
                    <div>
                        <h4 class="book-cover-title">${escapeHTML(book.title)}</h4>
                        <span style="font-size: 0.78rem; opacity: 0.85;"><i class="fa-solid fa-file-pdf"></i> ${totalPages} Pages</span>
                    </div>
                </div>
                <div class="book-card-body">
                    <div>
                        <div class="book-card-meta">
                            <span id="book-meta-${book.id}"><i class="fa-solid fa-bookmark" style="color: var(--primary-color);"></i> ${cachedPage > 1 ? `Page ${cachedPage} of ${totalPages}` : "Not Started"}</span>
                            <span id="book-pct-${book.id}">${pct}%</span>
                        </div>
                        <div class="book-card-progress-bar">
                            <div id="book-fill-${book.id}" class="book-card-progress-fill" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                        <button id="book-btn-${book.id}" class="btn btn-primary" style="flex: 1; padding: 8px 12px; font-size: 0.85rem;" onclick="openBook('${book.id}')">
                            <i class="fa-solid fa-book-open"></i> ${cachedPage > 1 ? `Continue (p.${cachedPage})` : "Open Book"}
                        </button>
                        ${isAdmin ? `
                            <button class="btn btn-danger btn-icon" style="padding: 8px 10px;" title="Delete Book Permanently" onclick="deleteAdminBook('${book.id}', '${safeTitle}')">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ""}
                    </div>
                </div>
            `;
            gridEl.appendChild(card);
        } catch (cardErr) {
            console.error("[BookDebug] Failed to render card for book:", book.id, book.title, cardErr);
        }
    }
}

window.filterBookLibrary = function(cat, btnEl) {
    const btns = document.querySelectorAll("#book-library-category-filters button");
    btns.forEach(b => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    const searchVal = document.getElementById("book-library-search-input")?.value || "";
    renderBookLibrary(cat, searchVal);
};

window.searchBookLibrary = function(q) {
    const activeFilterBtn = document.querySelector("#book-library-category-filters button.active");
    const activeCat = activeFilterBtn ? activeFilterBtn.dataset.category || "all" : "all";
    renderBookLibrary(activeCat, q);
};

async function getSignedBookUrl(filePath, expiresIn = 300) {
    try {
        const cleanUrl = (import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co").replace(/\/$/, '');
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
        
        let targetPath = filePath || "";
        if (targetPath.includes("/hawari_books/")) {
            targetPath = targetPath.split("/hawari_books/").pop();
        } else if (targetPath.startsWith("http://") || targetPath.startsWith("https://")) {
            targetPath = targetPath.split("/").pop();
        }

        console.log("[Security] Requesting signed URL for path:", targetPath);

        const response = await fetch(`${cleanUrl}/storage/v1/object/sign/hawari_books/${targetPath}`, {
            method: "POST",
            headers: {
                "apikey": anonKey,
                "Authorization": `Bearer ${(state.currentUser && state.currentUser.token) ? state.currentUser.token : anonKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ expiresIn })
        });

        if (!response.ok) {
            console.error("[Security] Error fetching signed URL:", response.status);
            return null;
        }

        const data = await response.json();
        return `${cleanUrl}/storage/v1/object/sign/hawari_books/${targetPath}?token=${data.token || data.signedURL.split('token=').pop()}`;
    } catch (err) {
        console.error("[Security] Error fetching signed URL:", err);
        return null;
    }
}

window.openBook = async function(bookId) {
    const book = (state.books || []).find(b => b.id === bookId);
    if (!book) return;

    // Set active book
    bookState.activeBookFile = book;
    bookState.numPages = book.total_pages || 1;
    bookState.annotations = {}; // CLEAR memory to prevent annotations bleeding between books!
    bookState.pdfDoc = null; // Clear previous document!

    // Fetch user progress for this book
    const lastPage = await fetchUserBookProgress(bookId);
    bookState.currentPage = lastPage;

    // Fetch annotations scoped to this book
    await fetchBookCloudAnnotations();

    // Update UI elements
    const titleEl = document.getElementById("book-viewer-title");
    if (titleEl) titleEl.innerText = book.title;

    const totalPagesEl = document.getElementById("book-total-pages-num");
    if (totalPagesEl) totalPagesEl.innerText = book.total_pages;

    const gotoInput = document.getElementById("book-goto-page-input");
    if (gotoInput) {
        gotoInput.max = book.total_pages;
        gotoInput.value = lastPage;
    }

    // Toggle Workspace views
    const libraryContainer = document.getElementById("book-library-container");
    const viewerWorkspace = document.getElementById("book-viewer-workspace");
    if (libraryContainer) libraryContainer.classList.add("hidden");
    if (viewerWorkspace) viewerWorkspace.classList.remove("hidden");

    bindBookToolbarEvents();
    initBookCanvasDrawing();
    initBookDrmProtection();

    redrawBookCanvas();
    showToast("Book Loaded", `Opened "${book.title}" on page ${lastPage}`, "info");
};

window.closeBookViewerAndReturnToLibrary = function() {
    saveUserBookProgress();
    saveBookPageAnnotationToCloud(bookState.currentPage);

    // Flush any pending debounced syncs immediately
    if (saveAnnotationsTimeout) {
        clearTimeout(saveAnnotationsTimeout);
        flushPendingAnnotationsSync();
    }
    if (saveProgressTimeout) {
        clearTimeout(saveProgressTimeout);
        flushPendingProgressSync();
    }

    bookState.activeBookFile = null;
    bookState.pdfDoc = null;

    const libraryContainer = document.getElementById("book-library-container");
    const viewerWorkspace = document.getElementById("book-viewer-workspace");
    if (libraryContainer) libraryContainer.classList.remove("hidden");
    if (viewerWorkspace) viewerWorkspace.classList.add("hidden");

    renderBookLibrary();
};

window.deleteAdminBook = async function(bookId, bookTitle) {
    const isAdmin = isUserAdmin(state.currentUser);
    if (!isAdmin) {
        showToast("غير مصرح", "حذف الكتب من المكتبة متاح فقط للمشرفين والمسؤولين.", "danger");
        return;
    }

    if (!confirm(`هل أنت متأكد من رغبتك في حذف كتاب "${bookTitle}" نهائياً من المكتبة والسيرفر؟\n\nسيتم حذف الملف وكافة التظليلات والملاحظات المرتبطة به.`)) {
        return;
    }

    const group = (state.activeGroup || "infection").toLowerCase();
    const cleanUrl = SUPABASE_CONFIG.url;
    const jwtToken = await getValidSupabaseAccessToken();
    const authHeaders = getSupabaseAuthHeaders(jwtToken, { "Content-Type": "application/json" });

    try {
        const book = (state.books || []).find(b => b.id === bookId);
        
        // 1. Delete from hawari_book_files table with authenticated admin headers
        try {
            await fetch(`${cleanUrl}/rest/v1/hawari_book_files?id=eq.${encodeURIComponent(bookId)}`, {
                method: "DELETE",
                headers: authHeaders
            });
        } catch (dbErr) {
            console.warn("[BookDelete] Table delete warning:", dbErr.message);
        }

        // 2. Delete binary from Storage bucket
        if (book && book.storage_url) {
            try {
                const cleanPath = (book.storage_url || "").replace(/.*\/hawari_books\//, "");
                if (cleanPath) {
                    await fetch(`${cleanUrl}/storage/v1/object/hawari_books/${encodeURIComponent(cleanPath)}`, {
                        method: "DELETE",
                        headers: authHeaders
                    });
                }
            } catch (storageErr) {
                console.warn("[BookDelete] Storage cleanup warning:", storageErr.message);
            }
        }

        if (bookState.activeBookFile && bookState.activeBookFile.id === bookId) {
            bookState.activeBookFile = null;
            bookState.pdfDoc = null;
            localStorage.removeItem("hawari_active_book_" + group);
        }

        state.books = (state.books || []).filter(b => b.id !== bookId);
        localStorage.setItem("hawari_books_" + group, JSON.stringify(state.books));

        // 3. Sync deletion with hawari_users admin row for 100% cross-device consistency
        try {
            const adminEmail = (state.currentUser && state.currentUser.email ? state.currentUser.email : "").toLowerCase();
            await fetch(`${cleanUrl}/rest/v1/hawari_users?email=eq.${encodeURIComponent(adminEmail)}&group_name=eq.${group}`, {
                method: "PATCH",
                headers: authHeaders,
                body: JSON.stringify({
                    report_task_progress: {
                        ...(state.currentUser?.report_task_progress || {}),
                        books: state.books
                    },
                    last_updated: Date.now()
                })
            });
        } catch (syncErr) {
            console.warn("[BookDelete] Syncing deleted book to admin row warning:", syncErr.message);
        }
        
        showToast("Book Deleted", `Successfully deleted "${bookTitle}"`, "info");
        updateAdminActiveBookUI();
        renderBookLibrary();
    } catch (e) {
        console.error("[BookDelete] Error deleting book:", e);
        showToast("Delete Error", "Failed to delete book.", "danger");
    }
};

window.openAdminAddBookModal = function() {
    const modal = document.getElementById("modal-admin-add-book");
    if (modal) modal.classList.remove("hidden");
};

function initAddBookModalForm() {
    // Bind modal close buttons
    document.querySelectorAll(".close-modal").forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = "true";
            btn.onclick = () => {
                document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
            };
        }
    });

    const modalForm = document.getElementById("modal-add-book-form");
    if (modalForm && !modalForm.dataset.bound) {
        modalForm.dataset.bound = "true";
        modalForm.onsubmit = async (event) => {
            event.preventDefault();
            console.log("[BookUpload] Modal Submit button clicked!");
            
            const titleInput = document.getElementById("modal-book-title");
            const fileInput = document.getElementById("modal-book-pdf-file");
            const progressContainer = document.getElementById("modal-book-upload-progress");
            const progressBar = document.getElementById("modal-book-upload-bar");
            const progressText = document.getElementById("modal-book-upload-pct");

            const title = titleInput ? titleInput.value.trim() : "";
            const file = fileInput && fileInput.files ? fileInput.files[0] : null;

            if (!title || !file) {
                showToast("بيانات ناقصة", "يرجى كتابة عنوان الكتاب واختيار ملف الـ PDF.", "warning");
                return;
            }

            await processBookPdfUpload({
                title,
                file,
                progressContainer,
                progressBar,
                progressText,
                modalToClose: "modal-admin-add-book",
                formToReset: modalForm
            });
        };
    }
}

// Annotation compact compression & decompression helpers (saves ~60%+ database space and traffic)
function compressAnnotations(annotations) {
    if (!annotations || !Array.isArray(annotations)) return annotations;
    return annotations.map(ann => {
        const compressed = { t: ann.type };
        if (ann.color !== undefined) compressed.c = ann.color;
        if (ann.width !== undefined) compressed.w = ann.width;
        if (ann.height !== undefined) compressed.h = ann.height;
        if (ann.x !== undefined) compressed.x = ann.x;
        if (ann.y !== undefined) compressed.y = ann.y;
        if (ann.text !== undefined) compressed.tx = ann.text;
        if (ann.note !== undefined) compressed.n = ann.note;
        if (ann.badgeType !== undefined) compressed.b = ann.badgeType;
        if (ann.fontSize !== undefined) compressed.fs = ann.fontSize;
        if (ann.opacity !== undefined) compressed.o = ann.opacity;
        
        if (ann.points && Array.isArray(ann.points)) {
            const flat = [];
            ann.points.forEach(pt => {
                flat.push(Math.round(pt.x), Math.round(pt.y));
            });
            compressed.p = flat;
        }
        return compressed;
    });
}

function decompressAnnotations(compressed) {
    if (!compressed || !Array.isArray(compressed)) return compressed;
    return compressed.map(ann => {
        const decompressed = {};
        if (ann.t !== undefined) decompressed.type = ann.t;
        if (ann.c !== undefined) decompressed.color = ann.c;
        if (ann.w !== undefined) decompressed.width = ann.w;
        if (ann.h !== undefined) decompressed.height = ann.h;
        if (ann.x !== undefined) decompressed.x = ann.x;
        if (ann.y !== undefined) decompressed.y = ann.y;
        if (ann.tx !== undefined) decompressed.text = ann.tx;
        if (ann.n !== undefined) decompressed.note = ann.n;
        if (ann.b !== undefined) decompressed.badgeType = ann.b;
        if (ann.fs !== undefined) decompressed.fontSize = ann.fs;
        if (ann.o !== undefined) decompressed.opacity = ann.o;
        
        if (ann.p && Array.isArray(ann.p)) {
            const pts = [];
            for (let i = 0; i < ann.p.length; i += 2) {
                pts.push({ x: ann.p[i], y: ann.p[i+1] });
            }
            decompressed.points = pts;
        }
        return decompressed;
    });
}

async function fetchBookCloudAnnotations() {
    if (!state.currentUser || !state.activeGroup || !bookState.activeBookFile) return;
    const docId = bookState.activeBookFile.id;
    const email = state.currentUser.email;

    const local = localStorage.getItem(`hawari_anns_${email}_${docId}`);
    if (local) {
        try {
            bookState.annotations = JSON.parse(local);
        } catch (e) {}
    }

    try {
        const query = `hawari_book_annotations?email=eq.${encodeURIComponent(email)}&document_id=eq.${docId}`;
        const records = await supabaseRequest(query);
        if (!bookState.cloudAnnotationIds) bookState.cloudAnnotationIds = {};
        if (Array.isArray(records) && records.length > 0) {
            records.forEach(row => {
                if (row.page_number) {
                    if (row.id) {
                        bookState.cloudAnnotationIds[row.page_number] = row.id;
                    }
                    if (row.payload_json) {
                        // Decompress annotations payload
                        bookState.annotations[row.page_number] = decompressAnnotations(row.payload_json);
                    }
                }
            });
            localStorage.setItem(`hawari_anns_${email}_${docId}`, JSON.stringify(bookState.annotations));
            console.log(`[BookSync] Fetched and decompressed cloud annotations for ${records.length} pages.`);
        }
    } catch (e) {
        console.warn("[BookSync] Cloud annotations fetch fallback:", e);
    }
}

let saveAnnotationsTimeout = null;
const pendingPagesToSync = new Set();

async function saveBookPageAnnotationToCloud(page) {
    if (!state.currentUser || !state.activeGroup || !bookState.activeBookFile) return;
    
    // Only save annotations for Full Grant Access students
    const accessInfo = getBookAccessLevel(state.currentUser);
    if (!accessInfo.isFullGrant) {
        console.log("[BookSync] Annotations sync skipped (Premium feature for Full Grant only)");
        return;
    }

    const docId = bookState.activeBookFile.id;
    const email = state.currentUser.email;

    // Immediately save standard JSON to LocalStorage (local first)
    localStorage.setItem(`hawari_anns_${email}_${docId}`, JSON.stringify(bookState.annotations));

    // Register page for cloud syncing
    pendingPagesToSync.add(page);

    // Debounce the cloud write by 5 seconds
    if (saveAnnotationsTimeout) clearTimeout(saveAnnotationsTimeout);
    saveAnnotationsTimeout = setTimeout(async () => {
        await flushPendingAnnotationsSync();
    }, 5000);
}

async function flushPendingAnnotationsSync() {
    if (!state.currentUser || !state.activeGroup || !bookState.activeBookFile) return;
    const docId = bookState.activeBookFile.id;
    const email = state.currentUser.email.trim().toLowerCase();
    const group = (state.activeGroup || "infection").toLowerCase();
    const pagesArray = Array.from(pendingPagesToSync);
    pendingPagesToSync.clear();

    if (!bookState.cloudAnnotationIds) bookState.cloudAnnotationIds = {};

    for (const p of pagesArray) {
        const pageData = bookState.annotations[p] || [];
        const compressedPayload = compressAnnotations(pageData);

        try {
            const payload = {
                email: email,
                group_name: group,
                document_id: docId,
                page_number: p,
                payload_json: compressedPayload,
                updated_at: new Date().toISOString()
            };

            // Atomic upsert by (email, document_id, page_number)
            const insertRes = await supabaseRequest("hawari_book_annotations?on_conflict=email,document_id,page_number", {
                method: "POST",
                headers: { "Prefer": "resolution=merge-duplicates,return=representation", "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (Array.isArray(insertRes) && insertRes.length > 0 && insertRes[0].id) {
                bookState.cloudAnnotationIds[p] = insertRes[0].id;
            }
            console.log(`[BookSync] Atomic upserted compressed annotations for page ${p} to cloud.`);
        } catch (e) {
            console.warn(`[BookSync] Cloud sync failed for page ${p}:`, e);
        }
    }
}

async function flushPendingProgressSync() {
    if (!state.currentUser || !bookState.activeBookFile) return;
    const docId = bookState.activeBookFile.id;
    const page = bookState.currentPage || 1;
    const email = state.currentUser.email.trim().toLowerCase();
    const group = (state.activeGroup || "infection").toLowerCase();

    const payload = {
        email: email,
        document_id: docId,
        last_page: page,
        total_pages: bookState.numPages || 1,
        group_name: group,
        updated_at: new Date().toISOString()
    };

    try {
        await supabaseRequest("hawari_user_book_progress?on_conflict=email,document_id", {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(payload)
        });
        console.log(`[BookProgress] Flushed page progress ${page} to cloud.`);
    } catch (e) {
        console.warn("[BookProgress] Flush progress failed:", e);
    }
}

function renderHawariBookView() {
    const isAuth = isUserBookAuthorized(state.currentUser);
    const badge = document.getElementById("book-access-status-badge");
    if (badge) {
        if (isAuth) {
            badge.className = "badge badge-active";
            badge.innerHTML = `<i class="fa-solid fa-lock-open"></i> Full Subscription`;
        } else {
            badge.className = "badge badge-warning";
            badge.innerHTML = `<i class="fa-solid fa-eye"></i> Free 10-Page Preview`;
        }
    }

    initBookDrmProtection();

    const libraryContainer = document.getElementById("book-library-container");
    const viewerWorkspace = document.getElementById("book-viewer-workspace");

    if (bookState.activeBookFile) {
        if (libraryContainer) libraryContainer.classList.add("hidden");
        if (viewerWorkspace) viewerWorkspace.classList.remove("hidden");
        fetchBookCloudAnnotations().then(() => {
            redrawBookCanvas();
        });
    } else {
        if (libraryContainer) libraryContainer.classList.remove("hidden");
        if (viewerWorkspace) viewerWorkspace.classList.add("hidden");
        renderBookLibrary();
    }

    // Bind all toolbar & reader controls
    bindBookToolbarEvents();
}

function bindBookToolbarEvents() {
    const btnPrev = document.getElementById("btn-book-prev-page");
    const btnNext = document.getElementById("btn-book-next-page");
    const gotoInput = document.getElementById("book-goto-page-input");
    const btnZoomIn = document.getElementById("btn-book-zoom-in");
    const btnZoomOut = document.getElementById("btn-book-zoom-out");
    const btnFitWidth = document.getElementById("btn-book-fit-width");
    const btnFitPage = document.getElementById("btn-book-fit-page");
    const btnFullscreen = document.getElementById("btn-book-fullscreen");
    const btnBookmark = document.getElementById("btn-book-toggle-bookmark");
    const searchInput = document.getElementById("book-search-text-input");

    const btnClear = document.getElementById("btn-book-clear-page");
    const btnUndo = document.getElementById("btn-book-undo");
    const btnRedo = document.getElementById("btn-book-redo");
    const btnDrawer = document.getElementById("btn-toggle-book-drawer");
    const btnRuler = document.getElementById("btn-toggle-ruler");
    const btnDeletePdf = document.getElementById("btn-admin-delete-book-pdf");

    const colorPicker = document.getElementById("book-custom-color-picker");
    const btnAddBlank = document.getElementById("btn-add-blank-page") || document.getElementById("btn-book-add-blank-page");
    const stickerSelect = document.getElementById("book-sticker-select") || document.getElementById("book-vector-sticker-select");
    const btnStickyNote = document.getElementById("btn-add-sticky-note");

    if (btnDeletePdf && !btnDeletePdf.dataset.bound) {
        btnDeletePdf.dataset.bound = "true";
        btnDeletePdf.onclick = deleteAdminBookPdfFile;
    }

    // Pen Stroke Size Buttons (1px, 2px, 3px, 5px)
    document.querySelectorAll(".pen-size-btn").forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = "true";
            btn.onclick = () => {
                document.querySelectorAll(".pen-size-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                bookState.strokeSize = parseInt(btn.dataset.size || "3");
            };
        }
    });

    // Drawer Toggle
    if (btnDrawer && !btnDrawer.dataset.bound) {
        btnDrawer.dataset.bound = "true";
        btnDrawer.onclick = () => {
            const drawer = document.getElementById("book-nav-drawer");
            if (drawer) {
                drawer.classList.toggle("hidden");
                renderBookDrawerThumbnails();
            }
        };
    }

    // Page Navigation
    if (btnPrev && !btnPrev.dataset.bound) {
        btnPrev.dataset.bound = "true";
        btnPrev.onclick = () => {
            if (bookState.currentPage > 1) {
                bookState.currentPage--;
                redrawBookCanvas();
            }
        };
    }

    if (btnNext && !btnNext.dataset.bound) {
        btnNext.dataset.bound = "true";
        btnNext.onclick = () => {
            if (bookState.currentPage < bookState.numPages) {
                bookState.currentPage++;
                redrawBookCanvas();
            }
        };
    }

    if (gotoInput && !gotoInput.dataset.bound) {
        gotoInput.dataset.bound = "true";
        gotoInput.onchange = () => {
            let p = parseInt(gotoInput.value);
            if (isNaN(p) || p < 1) p = 1;
            if (p > bookState.numPages) p = bookState.numPages;
            bookState.currentPage = p;
            redrawBookCanvas();
        };
    }

    // Zoom Controls
    if (btnZoomIn && !btnZoomIn.dataset.bound) {
        btnZoomIn.dataset.bound = "true";
        btnZoomIn.onclick = () => {
            if (bookState.zoom < 2.5) {
                bookState.userCustomZoom = true;
                bookState.zoom += 0.15;
                bookState.fitMode = "normal";
                redrawBookCanvas();
            }
        };
    }

    if (btnZoomOut && !btnZoomOut.dataset.bound) {
        btnZoomOut.dataset.bound = "true";
        btnZoomOut.onclick = () => {
            if (bookState.zoom > 0.5) {
                bookState.userCustomZoom = true;
                bookState.zoom -= 0.15;
                bookState.fitMode = "normal";
                redrawBookCanvas();
            }
        };
    }

    if (btnFitWidth && !btnFitWidth.dataset.bound) {
        btnFitWidth.dataset.bound = "true";
        btnFitWidth.onclick = () => {
            const viewport = document.getElementById("book-canvas-viewport");
            if (viewport) {
                bookState.userCustomZoom = true;
                const viewportWidth = viewport.clientWidth - 40;
                bookState.zoom = Math.max(0.6, viewportWidth / 720);
                bookState.fitMode = "fit-width";
                redrawBookCanvas();
            }
        };
    }

    if (btnFitPage && !btnFitPage.dataset.bound) {
        btnFitPage.dataset.bound = "true";
        btnFitPage.onclick = () => {
            bookState.userCustomZoom = false;
            bookState.zoom = 1.0;
            bookState.fitMode = "fit-page";
            redrawBookCanvas();
        };
    }

    if (btnFullscreen && !btnFullscreen.dataset.bound) {
        btnFullscreen.dataset.bound = "true";
        btnFullscreen.onclick = () => {
            const container = document.getElementById("book-workspace-container");
            if (container) {
                if (!document.fullscreenElement) {
                    container.requestFullscreen().catch(err => {
                        console.warn("Fullscreen failed:", err);
                    });
                } else {
                    document.exitFullscreen();
                }
            }
        };
    }

    // Bookmark Toggle
    if (btnBookmark && !btnBookmark.dataset.bound) {
        btnBookmark.dataset.bound = "true";
        btnBookmark.onclick = () => {
            const page = bookState.currentPage;
            const idx = bookState.bookmarks.indexOf(page);
            if (idx >= 0) {
                bookState.bookmarks.splice(idx, 1);
                showToast("Bookmark Removed", `Removed page ${page} from bookmarks`, "info");
            } else {
                bookState.bookmarks.push(page);
                showToast("Page Bookmarked", `Bookmarked page ${page}`, "success");
            }
            updateBookmarkIcon();
            renderBookDrawerBookmarks();
        };
    }

    // In-PDF Search
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.oninput = () => {
            const q = searchInput.value.toLowerCase().trim();
            if (q.length > 2) {
                showToast("PDF Search", `Searching PDF for "${q}"...`, "info");
            }
        };
    }

    // Baseline Snapping Toggle Switch
    const snapToggle = document.getElementById("snap-baseline-toggle");
    if (snapToggle && !snapToggle.dataset.bound) {
        snapToggle.dataset.bound = "true";
        snapToggle.onchange = () => {
            bookState.snapBaseline = snapToggle.checked;
            showToast("Baseline Snapping", `Text auto-align to ruled lines is now ${bookState.snapBaseline ? 'ENABLED' : 'DISABLED'}.`, "info");
        };
    }

    // Tool Selection & Custom SVG Cursor Updating
    document.querySelectorAll(".book-tool-btn").forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = "true";
            btn.onclick = () => {
                document.querySelectorAll(".book-tool-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const toolId = btn.id.replace("btn-tool-", "");
                bookState.activeTool = toolId;
                console.log("[BookTools] Active tool set to:", toolId);
                updateBookViewportCursor(toolId);
            };
        }
    });

    document.querySelectorAll(".color-dot").forEach(dot => {
        if (!dot.dataset.bound) {
            dot.dataset.bound = "true";
            dot.onclick = () => {
                document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
                dot.classList.add("active");
                bookState.activeColor = dot.dataset.color || "#2563eb";
            };
        }
    });

    if (colorPicker && !colorPicker.dataset.bound) {
        colorPicker.dataset.bound = "true";
        colorPicker.oninput = () => {
            bookState.activeColor = colorPicker.value;
            document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
        };
    }

    // Virtual Ruler Toggle
    if (btnRuler && !btnRuler.dataset.bound) {
        btnRuler.dataset.bound = "true";
        btnRuler.onclick = () => {
            const ruler = document.getElementById("book-ruler-widget");
            if (ruler) {
                ruler.classList.toggle("hidden");
                makeWidgetDraggable(ruler);
                if (!ruler.classList.contains("hidden")) {
                    updateBookViewportCursor("ruler");
                } else {
                    updateBookViewportCursor(bookState.activeTool);
                }
            }
        };
    }

    // Medical Vector Sticker Stamp Selector
    if (stickerSelect && !stickerSelect.dataset.bound) {
        stickerSelect.dataset.bound = "true";
        stickerSelect.onchange = () => {
            const val = stickerSelect.value;
            if (val) {
                stampVectorStickerOnPage(val);
                stickerSelect.value = "";
            }
        };
    }

    // Sticky Note Button
    if (btnStickyNote && !btnStickyNote.dataset.bound) {
        btnStickyNote.dataset.bound = "true";
        btnStickyNote.onclick = () => {
            addStickyNoteOnPage();
        };
    }

    // Insert Scratchpad Page Template Picker Modal Trigger
    if (btnAddBlank && !btnAddBlank.dataset.bound) {
        btnAddBlank.dataset.bound = "true";
        btnAddBlank.onclick = () => {
            const modal = document.getElementById("modal-scratchpad-template");
            const lblPage = document.getElementById("scratchpad-target-page-num");
            if (lblPage) lblPage.innerText = bookState.currentPage;
            if (modal) modal.classList.remove("hidden");
        };
    }

    // Initialize Global Keyboard Shortcuts
    initBookKeyboardShortcuts();

    // Initialize Floating PDF Text Selection Action Menu
    initPdfTextSelectionListener();

    // Undo / Redo / Clear Page
    if (btnUndo && !btnUndo.dataset.bound) {
        btnUndo.dataset.bound = "true";
        btnUndo.onclick = undoBookPageAction;
    }

    if (btnRedo && !btnRedo.dataset.bound) {
        btnRedo.dataset.bound = "true";
        btnRedo.onclick = redoBookPageAction;
    }

    if (btnClear && !btnClear.dataset.bound) {
        btnClear.dataset.bound = "true";
        btnClear.onclick = () => {
            const page = bookState.currentPage;
            if (bookState.annotations[page] && bookState.annotations[page].length > 0) {
                saveHistoryState(page);
                bookState.annotations[page] = [];
                saveBookPageAnnotationToCloud(page);
                redrawBookCanvas();
                showToast("Canvas Cleared", `Cleared all annotations on page ${page}`, "info");
            }
        };
    }

    // Flashcard Creation Modals Fix
    const btnCreateFc = document.getElementById("btn-book-create-flashcard");
    const btnCreateFcPersonal = document.getElementById("btn-create-personal-flashcard");

    if (btnCreateFc && !btnCreateFc.dataset.bound) {
        btnCreateFc.dataset.bound = "true";
        btnCreateFc.onclick = () => {
            const modal = document.getElementById("modal-create-flashcard");
            const cat = document.getElementById("fc-new-category");
            const front = document.getElementById("fc-new-front");
            if (cat) cat.value = `Hawari Book Page ${bookState.currentPage}`;
            if (front) front.value = `High-Yield Concept from Page ${bookState.currentPage}`;
            if (modal) modal.classList.remove("hidden");
        };
    }

    if (btnCreateFcPersonal && !btnCreateFcPersonal.dataset.bound) {
        btnCreateFcPersonal.dataset.bound = "true";
        btnCreateFcPersonal.onclick = () => {
            const modal = document.getElementById("modal-create-flashcard");
            if (modal) modal.classList.remove("hidden");
        };
    }

    // Attach Pointer Events drawing canvas listeners
    initBookCanvasDrawing();

    // Start Real-Time Laser Trail Animation Loop
    initLaserTrailLoop();

    // Drawer Sub-tab Bindings
    bindDrawerSubtabs();
}

function updateBookmarkIcon() {
    const icon = document.getElementById("icon-book-bookmark");
    if (!icon) return;
    if (bookState.bookmarks.includes(bookState.currentPage)) {
        icon.className = "fa-solid fa-bookmark text-warning";
    } else {
        icon.className = "fa-regular fa-bookmark";
    }
}

// Canvas Drawing & Fading Laser Pointer Trail Engine
let isDrawingShape = false;
let startX = 0;
let startY = 0;
let laserDots = []; // [ { x, y, time } ]
let laserAnimFrame = null;

function initLaserTrailLoop() {
    if (laserAnimFrame) return;
    const loop = () => {
        if (state.activeView === "hawari-book" && laserDots.length > 0) {
            renderLaserTrailDots();
        }
        laserAnimFrame = requestAnimationFrame(loop);
    };
    laserAnimFrame = requestAnimationFrame(loop);
}

function renderLaserTrailDots() {
    const animCanvas = document.getElementById("book-annotation-canvas");
    if (!animCanvas) return;
    const ctx = animCanvas.getContext("2d");
    const now = Date.now();

    laserDots = laserDots.filter(d => now - d.time < 1500);

    redrawCurrentPageAnnotations();

    if (laserDots.length === 0) return;

    const dpr = window.devicePixelRatio || 1.5;
    const renderScale = (bookState.zoom || 1.0) * dpr;

    ctx.save();
    ctx.scale(renderScale, renderScale);
    laserDots.forEach(d => {
        const age = now - d.time;
        const opacity = Math.max(0, 1 - age / 1500);

        ctx.beginPath();
        ctx.arc(d.x, d.y, 8 * opacity, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(239, 68, 68, ${opacity * 0.9})`;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 10 * opacity;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(d.x, d.y, 3 * opacity, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.fill();
    });
    ctx.restore();
}

// Delete Active PDF Book File
async function deleteAdminBookPdfFile() {
    if (!confirm("Are you sure you want to delete the active PDF book file?")) return;
    try {
        if (bookState.activeBookFile && bookState.activeBookFile.id) {
            await supabaseRequest(`hawari_book_files?id=eq.${encodeURIComponent(bookState.activeBookFile.id)}`, {
                method: "DELETE"
            });
        }
        bookState.activeBookFile = null;
        bookState.numPages = 10;
        showToast("Book Deleted", "Deleted active PDF book file.", "info");

        const titleLbl = document.getElementById("admin-active-book-title-lbl");
        const pagesLbl = document.getElementById("admin-active-book-pages-lbl");
        if (titleLbl) titleLbl.innerText = "None";
        if (pagesLbl) pagesLbl.innerText = "0";

        redrawBookCanvas();
    } catch (e) {
        console.warn("[BookDelete] Delete fallback:", e);
        showToast("Delete Error", "Could not delete PDF file.", "danger");
    }
}





// Custom SVG Cursor Switcher
function updateBookViewportCursor(toolId) {
    const viewport = document.getElementById("book-canvas-viewport");
    if (!viewport) return;

    const cursorClasses = [
        "book-cursor-grab", "book-cursor-grabbing", "book-cursor-pen",
        "book-cursor-highlighter", "book-cursor-text", "book-cursor-eraser",
        "book-cursor-laser", "book-cursor-ruler", "book-cursor-crosshair"
    ];
    cursorClasses.forEach(cls => viewport.classList.remove(cls));

    const cursorMap = {
        pan: "book-cursor-grab",
        select: "book-cursor-grab",
        lasso: "book-cursor-crosshair",
        pen: "book-cursor-pen",
        highlighter: "book-cursor-highlighter",
        text: "book-cursor-text",
        eraser: "book-cursor-eraser",
        laser: "book-cursor-laser",
        ruler: "book-cursor-ruler",
        circle: "book-cursor-crosshair",
        rectangle: "book-cursor-crosshair",
        arrow: "book-cursor-crosshair",
        line: "book-cursor-crosshair",
        triangle: "book-cursor-crosshair"
    };

    const cls = cursorMap[toolId] || "book-cursor-grab";
    viewport.classList.add(cls);
}

// Ruled Page Baseline Snapping Calculator
function snapYToRuledLine(y, zoom) {
    if (!bookState.snapBaseline) return y;
    const pageTemplate = bookState.extraPages[bookState.currentPage];
    if (pageTemplate !== "lined" && pageTemplate !== "cornell") return y;

    const topMargin = 60;
    const lineSpacing = 30;
    if (y < topMargin) return y;

    const lineIndex = Math.round((y - topMargin) / lineSpacing);
    return topMargin + lineIndex * lineSpacing;
}

// Scratchpad Template Modal Actions
window.selectScratchpadTemplate = function(type, el) {
    bookState.selectedScratchpadTemplate = type;
    document.querySelectorAll(".template-option-card").forEach(c => c.classList.remove("active"));
    if (el) el.classList.add("active");
};

window.applySelectedScratchpadTemplate = function() {
    const template = bookState.selectedScratchpadTemplate || "ruled";
    const modal = document.getElementById("modal-scratchpad-template");
    if (modal) modal.classList.add("hidden");

    const templateMap = {
        blank: "blank",
        ruled: "lined",
        grid: "grid",
        dotted: "dotted",
        cornell: "cornell"
    };

    const mappedType = templateMap[template] || "lined";
    const page = bookState.currentPage;
    bookState.extraPages[page] = mappedType;

    redrawBookCanvas();
    showToast("Template Applied", `Applied ${template.toUpperCase()} scratchpad template to Page ${page}`, "success");
};

// Vector Sticker Stamping
function stampVectorStickerOnPage(badgeType) {
    const page = bookState.currentPage;
    if (!bookState.annotations[page]) bookState.annotations[page] = [];
    saveHistoryState(page);

    const badgeColorMap = {
        "HIGH YIELD": "#ef4444",
        "IMPORTANT": "#f59e0b",
        "REMEMBER": "#8b5cf6",
        "WARNING": "#dc2626",
        "EXAM": "#2563eb",
        "TIP": "#10b981",
        "NOTE": "#06b6d4",
        "REVIEW": "#6366f1",
        "QUESTION": "#ec4899",
        "DONE": "#22c55e"
    };

    const stickerObj = {
        type: "sticker",
        badgeType: badgeType,
        text: badgeType,
        note: "Double-click to edit note...",
        color: badgeColorMap[badgeType] || "#2563eb",
        x: 100,
        y: 120,
        width: 140,
        height: 38
    };

    bookState.annotations[page].push(stickerObj);
    saveBookPageAnnotationToCloud(page);
    redrawBookCanvas();
    showToast("Sticker Added", `Added ${badgeType} sticker. Double-click to edit inline!`, "success");
}

// Sticky Note Generator
function addStickyNoteOnPage() {
    const page = bookState.currentPage;
    if (!bookState.annotations[page]) bookState.annotations[page] = [];
    saveHistoryState(page);

    const noteColors = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa"];
    const randomBg = noteColors[Math.floor(Math.random() * noteColors.length)];

    let yPos = 140;
    if (bookState.extraPages[page] === "lined" || bookState.extraPages[page] === "cornell") {
        yPos = snapYToRuledLine(yPos, bookState.zoom);
    }

    const noteObj = {
        type: "note",
        text: "Double-click to add clinical note...",
        color: randomBg,
        x: 140,
        y: yPos,
        width: 180,
        height: 140
    };

    bookState.annotations[page].push(noteObj);
    saveBookPageAnnotationToCloud(page);
    redrawBookCanvas();
    showToast("Sticky Note Added", "Added new sticky note. Double click to edit!", "info");
}

// Global Keyboard Shortcuts
function initBookKeyboardShortcuts() {
    if (window._bookShortcutsBound) return;
    window._bookShortcutsBound = true;

    window.addEventListener("keydown", (e) => {
        if (state.activeView !== "hawari-book") return;
        if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

        const key = e.key ? e.key.toLowerCase() : "";

        if (key === "p") {
            const btn = document.getElementById("btn-tool-pen");
            if (btn) btn.click();
        } else if (key === "h") {
            const btn = document.getElementById("btn-tool-highlighter");
            if (btn) btn.click();
        } else if (key === "u") {
            const btn = document.getElementById("btn-tool-underline");
            if (btn) btn.click();
        } else if (key === "e") {
            const btn = document.getElementById("btn-tool-eraser");
            if (btn) btn.click();
        } else if (key === "l") {
            const btn = document.getElementById("btn-tool-laser");
            if (btn) btn.click();
        } else if (key === "m") {
            const btn = document.getElementById("btn-tool-pan");
            if (btn) btn.click();
        }
    });
}

function copySelectedAnnotation() {
    const page = bookState.currentPage;
    const selectedIdx = bookState.selectedAnnotationIndex;
    const annList = bookState.annotations[page];
    if (annList && selectedIdx !== undefined && annList[selectedIdx]) {
        bookState.clipboardAnnotation = JSON.parse(JSON.stringify(annList[selectedIdx]));
        showToast("Copied", "Annotation copied to clipboard.", "info");
    }
}

function pasteSelectedAnnotation() {
    if (!bookState.clipboardAnnotation) return;
    const page = bookState.currentPage;
    if (!bookState.annotations[page]) bookState.annotations[page] = [];

    saveHistoryState(page);
    const newObj = JSON.parse(JSON.stringify(bookState.clipboardAnnotation));
    newObj.x = (newObj.x || 100) + 20;
    newObj.y = (newObj.y || 100) + 20;
    if (newObj.fromX) { newObj.fromX += 20; newObj.toX += 20; }
    if (newObj.fromY) { newObj.fromY += 20; newObj.toY += 20; }

    bookState.annotations[page].push(newObj);
    bookState.selectedAnnotationIndex = bookState.annotations[page].length - 1;
    saveBookPageAnnotationToCloud(page);
    redrawBookCanvas();
    showToast("Pasted", "Annotation pasted.", "success");
}

function duplicateSelectedAnnotation() {
    copySelectedAnnotation();
    pasteSelectedAnnotation();
}

function deleteSelectedAnnotation() {
    const page = bookState.currentPage;
    const selectedIdx = bookState.selectedAnnotationIndex;
    const annList = bookState.annotations[page];
    if (annList && selectedIdx !== undefined && annList[selectedIdx]) {
        saveHistoryState(page);
        annList.splice(selectedIdx, 1);
        bookState.selectedAnnotationIndex = null;
        saveBookPageAnnotationToCloud(page);
        redrawBookCanvas();
        showToast("Deleted", "Deleted selected annotation.", "info");
    }
}

// Floating PDF Text Selection Action Menu Listener
function initPdfTextSelectionListener() {
    const viewport = document.getElementById("book-canvas-viewport");
    const menu = document.getElementById("pdf-text-select-menu");
    if (!viewport || !menu || viewport.dataset.textSelectBound) return;
    viewport.dataset.textSelectBound = "true";

    document.addEventListener("selectionchange", () => {
        if (state.activeView !== "hawari-book") return;
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (text.length > 0) {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const vpRect = viewport.getBoundingClientRect();

            if (rect.top >= vpRect.top && rect.bottom <= vpRect.bottom) {
                menu.style.top = `${Math.max(10, rect.top - vpRect.top - 45)}px`;
                menu.style.left = `${Math.max(10, rect.left - vpRect.left + (rect.width / 2) - 100)}px`;
                menu.classList.remove("hidden");
                menu.dataset.selectedText = text;
                return;
            }
        }
        menu.classList.add("hidden");
    });
}

window.pdfTextActionHighlight = function() {
    const menu = document.getElementById("pdf-text-select-menu");
    const text = menu ? menu.dataset.selectedText : "";
    if (text) {
        showToast("Text Highlighted", `Highlighted: "${text.substring(0, 25)}..."`, "success");
        if (menu) menu.classList.add("hidden");
    }
};

window.pdfTextActionAddNote = function() {
    const menu = document.getElementById("pdf-text-select-menu");
    const text = menu ? menu.dataset.selectedText : "";
    if (text) {
        addStickyNoteOnPage();
        const page = bookState.currentPage;
        const list = bookState.annotations[page];
        if (list && list.length > 0) {
            list[list.length - 1].text = text;
            redrawBookCanvas();
        }
        if (menu) menu.classList.add("hidden");
    }
};

window.pdfTextActionCreateFlashcard = function() {
    const menu = document.getElementById("pdf-text-select-menu");
    const text = menu ? menu.dataset.selectedText : "";
    const modal = document.getElementById("modal-create-flashcard");
    const front = document.getElementById("fc-new-front");
    if (front && text) front.value = text;
    if (modal) modal.classList.remove("hidden");
    if (menu) menu.classList.add("hidden");
};

window.pdfTextActionGenerateMcq = function() {
    const menu = document.getElementById("pdf-text-select-menu");
    const text = menu ? menu.dataset.selectedText : "";
    if (text) {
        showToast("AI MCQ Generator", `Generating MCQ from text: "${text.substring(0, 30)}..."`, "info");
        if (menu) menu.classList.add("hidden");
    }
};

window.pdfTextActionCopy = function() {
    const menu = document.getElementById("pdf-text-select-menu");
    const text = menu ? menu.dataset.selectedText : "";
    if (text) {
        navigator.clipboard.writeText(text);
        showToast("Copied", "Text copied to clipboard.", "info");
        if (menu) menu.classList.add("hidden");
    }
};

// Canvas Drawing Engine with Selection Handles & Smooth Curves
function initBookCanvasDrawing() {
    const animCanvas = document.getElementById("book-annotation-canvas");
    if (!animCanvas) return;
    
    animCanvas.style.pointerEvents = "auto";
    animCanvas.style.touchAction = "none";

    if (animCanvas.dataset.drawingBound === "true") return;
    animCanvas.dataset.drawingBound = "true";

    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    let isDrawing = false;
    let currentStroke = null;

    const getCoords = (e) => {
        const rect = animCanvas.getBoundingClientRect();
        let clientX = e.clientX;
        let clientY = e.clientY;

        if (clientX === undefined && e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (clientX === undefined && e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        }
        
        const cssX = (clientX !== undefined ? clientX : 0) - rect.left;
        const cssY = (clientY !== undefined ? clientY : 0) - rect.top;
        
        const ratioX = rect.width > 0 ? Math.max(0, Math.min(1, cssX / rect.width)) : 0;
        const ratioY = rect.height > 0 ? Math.max(0, Math.min(1, cssY / rect.height)) : 0;

        const zoom = bookState.zoom || 1.0;
        const baseWidth = (animCanvas.style.width ? parseFloat(animCanvas.style.width) : (rect.width || 720)) / zoom;
        const baseHeight = (animCanvas.style.height ? parseFloat(animCanvas.style.height) : (rect.height || 980)) / zoom;

        return {
            x: ratioX * baseWidth,
            y: ratioY * baseHeight
        };
    };

    const startDraw = (e) => {
        const tool = bookState.activeTool || "pen";
        if (tool === "pan") return;

        if (e.preventDefault) e.preventDefault();

        if (e.pointerId !== undefined && animCanvas.setPointerCapture) {
            try { animCanvas.setPointerCapture(e.pointerId); } catch(err){}
        }

        const coords = getCoords(e);
        lastX = coords.x;
        lastY = coords.y;
        startX = coords.x;
        startY = coords.y;

        if (tool === "laser") {
            laserDots.push({ x: coords.x, y: coords.y, time: Date.now() });
            isDrawing = true;
            return;
        }

        const page = bookState.currentPage;
        if (!bookState.annotations[page]) bookState.annotations[page] = [];
        saveHistoryState(page);

        if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
            const currentSize = tool === "highlighter" ? Math.max(12, (bookState.strokeSize || 3) * 5) : (tool === "eraser" ? 24 : (bookState.strokeSize || 3));
            currentStroke = {
                type: tool,
                color: bookState.activeColor || "#2563eb",
                size: currentSize,
                points: [{ x: coords.x, y: coords.y }]
            };
        }

        isDrawing = true;
    };

    const drawMove = (e) => {
        if (!isDrawing) return;
        const tool = bookState.activeTool || "pen";
        if (tool === "pan") return;

        if (e.preventDefault) e.preventDefault();

        const coords = getCoords(e);

        if (tool === "laser") {
            laserDots.push({ x: coords.x, y: coords.y, time: Date.now() });
            return;
        }

        if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
            if (currentStroke && currentStroke.points) {
                currentStroke.points.push({ x: coords.x, y: coords.y });
                
                // Draw incremental segment directly on canvas for 60fps responsiveness
                const ctx = animCanvas.getContext("2d");
                const dpr = window.devicePixelRatio || 1.5;
                const renderScale = (bookState.zoom || 1.0) * dpr;

                ctx.save();
                ctx.scale(renderScale, renderScale);
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(coords.x, coords.y);
                if (tool === "highlighter") {
                    ctx.strokeStyle = currentStroke.color || "#fde047";
                    ctx.globalAlpha = 0.4;
                    ctx.lineWidth = currentStroke.size || Math.max(12, (bookState.strokeSize || 3) * 5);
                    ctx.lineCap = "square";
                } else if (tool === "eraser") {
                    ctx.globalCompositeOperation = "destination-out";
                    ctx.lineWidth = currentStroke.size || 24;
                    ctx.lineCap = "round";
                } else {
                    ctx.strokeStyle = currentStroke.color || "#2563eb";
                    ctx.globalAlpha = 1.0;
                    ctx.lineWidth = currentStroke.size || bookState.strokeSize || 3;
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                }
                ctx.stroke();
                ctx.restore();
            }
            lastX = coords.x;
            lastY = coords.y;
        } else if (tool === "underline") {
            redrawCurrentPageAnnotations();
            const ctx = animCanvas.getContext("2d");
            const dpr = window.devicePixelRatio || 1.5;
            const renderScale = (bookState.zoom || 1.0) * dpr;
            ctx.save();
            ctx.scale(renderScale, renderScale);
            const previewShape = {
                type: "underline",
                color: bookState.activeColor || "#2563eb",
                size: bookState.strokeSize || 3,
                x: startX,
                y: startY,
                toX: coords.x,
                toY: startY
            };
            drawSingleStroke(ctx, previewShape);
            ctx.restore();
            lastX = coords.x;
            lastY = coords.y;
        }
    };

    const stopDraw = (e) => {
        if (!isDrawing) return;
        isDrawing = false;

        const tool = bookState.activeTool || "pen";
        if (tool === "laser" || tool === "pan") return;

        const page = bookState.currentPage;
        if (!bookState.annotations[page]) bookState.annotations[page] = [];

        if (tool === "underline") {
            let endCoords = { x: lastX, y: lastY };
            if (e && (e.clientX !== undefined)) {
                endCoords = getCoords(e);
            }

            const shapeObj = {
                type: "underline",
                color: bookState.activeColor || "#2563eb",
                size: bookState.strokeSize || 3,
                x: startX,
                y: startY,
                toX: endCoords.x,
                toY: startY
            };

            bookState.annotations[page].push(shapeObj);
            saveBookPageAnnotationToCloud(page);
            redrawCurrentPageAnnotations();
        } else if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
            if (currentStroke && currentStroke.points && currentStroke.points.length > 0) {
                bookState.annotations[page].push(currentStroke);
                currentStroke = null;
                saveBookPageAnnotationToCloud(page);
                redrawCurrentPageAnnotations();
            }
        }
    };

    // Double click on Canvas inline text/sticker/note editor
    animCanvas.addEventListener("dblclick", (e) => {
        const coords = getCoords(e);
        const page = bookState.currentPage;
        const annList = bookState.annotations[page] || [];

        for (let i = annList.length - 1; i >= 0; i--) {
            const a = annList[i];
            if (a.type === "text" || a.type === "sticker" || a.type === "note") {
                const bbox = getAnnotationBBox(a);
                if (coords.x >= bbox.x && coords.x <= bbox.x + bbox.width &&
                    coords.y >= bbox.y && coords.y <= bbox.y + bbox.height) {
                    
                    const newText = prompt("Edit content:", a.note || a.text || "");
                    if (newText !== null) {
                        saveHistoryState(page);
                        if (a.type === "sticker") a.note = newText;
                        else a.text = newText;
                        saveBookPageAnnotationToCloud(page);
                        redrawCurrentPageAnnotations();
                        showToast("Text Updated", "Updated annotation text.", "success");
                    }
                    break;
                }
            }
        }
    });

    animCanvas.addEventListener("pointerdown", startDraw);
    animCanvas.addEventListener("pointermove", drawMove);
    animCanvas.addEventListener("pointerup", stopDraw);
    animCanvas.addEventListener("pointercancel", stopDraw);
    animCanvas.addEventListener("pointerleave", (e) => {
        if (e.buttons === 0) stopDraw(e);
    });

    // Fallback mouse listeners for all environments
    animCanvas.addEventListener("mousedown", startDraw);
    animCanvas.addEventListener("mousemove", drawMove);
    animCanvas.addEventListener("mouseup", stopDraw);
}

function getAnnotationBBox(a) {
    if (a.type === "sticker") return { x: a.x || 100, y: a.y || 120, width: a.width || 140, height: a.height || 38 };
    if (a.type === "note") return { x: a.x || 140, y: a.y || 140, width: a.width || 180, height: a.height || 140 };
    if (a.type === "text") return { x: a.x || 50, y: (a.y || 50) - 16, width: Math.max(100, (a.text || "").length * 9), height: 24 };
    if (a.type === "rectangle" || a.type === "circle") return { x: Math.min(a.x, (a.toX !== undefined ? a.toX : a.x)), y: Math.min(a.y, (a.toY !== undefined ? a.toY : a.y)), width: Math.abs(a.width || 50), height: Math.abs(a.height || 50) };
    if (a.points && a.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        a.points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });
        return { x: minX - 5, y: minY - 5, width: (maxX - minX) + 10, height: (maxY - minY) + 10 };
    }
    return { x: (a.x || a.fromX || 0) - 10, y: (a.y || a.fromY || 0) - 10, width: Math.abs((a.toX || 50) - (a.fromX || 0)) + 20, height: Math.abs((a.toY || 50) - (a.fromY || 0)) + 20 };
}

function drawSingleStroke(ctx, s) {
    if (!s) return;
    ctx.save();

    if (s.type === "highlighter") {
        ctx.beginPath();
        if (s.points && s.points.length > 0) {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x, s.points[i].y);
            }
        } else if (s.fromX !== undefined) {
            ctx.moveTo(s.fromX, s.fromY);
            ctx.lineTo(s.toX, s.toY);
        }
        ctx.strokeStyle = s.color || "#fde047";
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = s.size || 18;
        ctx.lineCap = "square";
        ctx.lineJoin = "round";
        ctx.stroke();

    } else if (s.type === "eraser") {
        ctx.beginPath();
        if (s.points && s.points.length > 0) {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x, s.points[i].y);
            }
        } else if (s.fromX !== undefined) {
            ctx.moveTo(s.fromX, s.fromY);
            ctx.lineTo(s.toX, s.toY);
        }
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = s.size || 24;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

    } else if (s.type === "pen" || !s.type) {
        ctx.beginPath();
        if (s.points && s.points.length > 0) {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x, s.points[i].y);
            }
        } else if (s.fromX !== undefined) {
            ctx.moveTo(s.fromX, s.fromY);
            ctx.lineTo(s.toX, s.toY);
        }
        ctx.strokeStyle = s.color || "#2563eb";
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = s.size || 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();

    } else if (s.type === "underline") {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.toX, s.y);
        ctx.strokeStyle = s.color || "#2563eb";
        ctx.lineWidth = s.size || 3;
        ctx.lineCap = "round";
        ctx.stroke();

    } else if (s.type === "strikethrough") {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.toX, s.y);
        ctx.strokeStyle = s.color || "#ef4444";
        ctx.lineWidth = 3;
        ctx.stroke();

    } else if (s.type === "rectangle") {
        ctx.beginPath();
        ctx.rect(s.x, s.y, s.width, s.height);
        ctx.strokeStyle = s.color || "#2563eb";
        ctx.lineWidth = 3;
        ctx.stroke();

    } else if (s.type === "circle") {
        ctx.beginPath();
        const radiusX = Math.abs(s.width) / 2;
        const radiusY = Math.abs(s.height) / 2;
        const centerX = s.x + s.width / 2;
        const centerY = s.y + s.height / 2;
        ctx.ellipse(centerX, centerY, Math.max(1, radiusX), Math.max(1, radiusY), 0, 0, 2 * Math.PI);
        ctx.strokeStyle = s.color || "#2563eb";
        ctx.lineWidth = 3;
        ctx.stroke();

    } else if (s.type === "arrow") {
        drawCanvasArrow(ctx, s.x, s.y, s.toX, s.toY, s.color || "#2563eb");

    } else if (s.type === "text") {
        ctx.fillStyle = s.color || "#1e293b";
        ctx.font = `bold ${s.size || 16}px Inter, sans-serif`;
        ctx.fillText(s.text, s.x, s.y);

    } else if (s.type === "sticker") {
        const w = s.width || 140;
        const h = s.height || 38;
        const radius = 19;
        const color = s.color || "#ef4444";

        ctx.save();
        ctx.translate(s.x, s.y);

        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, radius);
        ctx.fillStyle = color;
        ctx.shadowColor = "rgba(0, 0, 0, 0.15)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fill();

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "900 12px Inter, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText((s.badgeType || s.text || "STICKER").toUpperCase(), 14, h / 2);

        if (s.note && s.note !== "Double-click to edit note...") {
            ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
            ctx.font = "500 10px Inter, sans-serif";
            ctx.fillText(s.note.substring(0, 12), 85, h / 2);
        }
        ctx.restore();

    } else if (s.type === "note") {
        const w = s.width || 180;
        const h = s.height || 140;
        const bg = s.color || "#fef08a";

        ctx.save();
        ctx.translate(s.x, s.y);

        ctx.fillStyle = bg;
        ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillRect(0, 0, w, h);
        ctx.shadowColor = "transparent";

        ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
        ctx.fillRect(0, 0, w, 24);

        ctx.beginPath();
        ctx.arc(w / 2, 12, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#ef4444";
        ctx.fill();

        ctx.fillStyle = "#1e293b";
        ctx.font = "500 13px Outfit, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        const lines = (s.text || "Double-click to add clinical note...").split("\n");
        lines.forEach((line, idx) => {
            if (idx < 6) ctx.fillText(line, 12, 32 + idx * 18);
        });
        ctx.restore();
    }
    ctx.restore();
}

function drawCanvasArrow(ctx, fromx, fromy, tox, toy, color) {
    const headlen = 12;
    const angle = Math.atan2(toy - fromy, tox - fromx);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(tox, toy);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function makeWidgetDraggable(elmnt) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    elmnt.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
        elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Drawer Sub-tabs
function bindDrawerSubtabs() {
    const btnThumbs = document.getElementById("btn-drawer-tab-thumbs");
    const btnToc = document.getElementById("btn-drawer-tab-toc");
    const btnBookmarks = document.getElementById("btn-drawer-tab-bookmarks");

    const paneThumbs = document.getElementById("drawer-pane-thumbs");
    const paneToc = document.getElementById("drawer-pane-toc");
    const paneBookmarks = document.getElementById("drawer-pane-bookmarks");

    if (btnThumbs && !btnThumbs.dataset.bound) {
        btnThumbs.dataset.bound = "true";
        btnThumbs.onclick = () => {
            btnThumbs.classList.add("active");
            if (btnToc) btnToc.classList.remove("active");
            if (btnBookmarks) btnBookmarks.classList.remove("active");

            if (paneThumbs) paneThumbs.classList.remove("hidden");
            if (paneToc) paneToc.classList.add("hidden");
            if (paneBookmarks) paneBookmarks.classList.add("hidden");

            renderBookDrawerThumbnails();
        };
    }

    if (btnToc && !btnToc.dataset.bound) {
        btnToc.dataset.bound = "true";
        btnToc.onclick = () => {
            btnToc.classList.add("active");
            if (btnThumbs) btnThumbs.classList.remove("active");
            if (btnBookmarks) btnBookmarks.classList.remove("active");

            if (paneToc) paneToc.classList.remove("hidden");
            if (paneThumbs) paneThumbs.classList.add("hidden");
            if (paneBookmarks) paneBookmarks.classList.add("hidden");

            renderBookDrawerToc();
        };
    }

    if (btnBookmarks && !btnBookmarks.dataset.bound) {
        btnBookmarks.dataset.bound = "true";
        btnBookmarks.onclick = () => {
            btnBookmarks.classList.add("active");
            if (btnThumbs) btnThumbs.classList.remove("active");
            if (btnToc) btnToc.classList.remove("active");

            if (paneBookmarks) paneBookmarks.classList.remove("hidden");
            if (paneThumbs) paneThumbs.classList.add("hidden");
            if (paneToc) paneToc.classList.add("hidden");

            renderBookDrawerBookmarks();
        };
    }
}

function renderBookDrawerThumbnails() {
    const pane = document.getElementById("drawer-pane-thumbs");
    if (!pane) return;
    pane.innerHTML = "";

    const pagesToRender = Math.min(bookState.numPages, 30);
    for (let p = 1; p <= pagesToRender; p++) {
        const card = document.createElement("div");
        card.className = `book-thumbnail-card ${p === bookState.currentPage ? 'active' : ''}`;
        card.innerHTML = `
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Page ${p}</div>
            <div style="height: 70px; background: #ffffff; border-radius: 4px; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 0.65rem; color: #000;">
                Hawari p.${p}
            </div>
        `;
        card.onclick = () => {
            bookState.currentPage = p;
            redrawBookCanvas();
        };
        pane.appendChild(card);
    }
}

function renderBookDrawerToc() {
    const ul = document.getElementById("book-toc-list");
    if (!ul) return;
    ul.innerHTML = `
        <li style="padding: 6px 0; border-bottom: 1px solid var(--border-color); cursor: pointer;" onclick="bookState.currentPage=1; redrawBookCanvas();">
            <strong style="color: var(--primary-color);">Chapter 1:</strong> Infection Control Principles (p. 1)
        </li>
        <li style="padding: 6px 0; border-bottom: 1px solid var(--border-color); cursor: pointer;" onclick="bookState.currentPage=5; redrawBookCanvas();">
            <strong style="color: var(--primary-color);">Chapter 2:</strong> General Bacteriology & Virology (p. 5)
        </li>
        <li style="padding: 6px 0; border-bottom: 1px solid var(--border-color); cursor: pointer;" onclick="bookState.currentPage=12; redrawBookCanvas();">
            <strong style="color: var(--primary-color);">Chapter 3:</strong> Clinical Dermatology Lesions (p. 12)
        </li>
        <li style="padding: 6px 0; border-bottom: 1px solid var(--border-color); cursor: pointer;" onclick="bookState.currentPage=25; redrawBookCanvas();">
            <strong style="color: var(--primary-color);">Chapter 4:</strong> High-Yield Past Exam Board MCQs (p. 25)
        </li>
    `;
}

function renderBookDrawerBookmarks() {
    const listEl = document.getElementById("book-bookmarks-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (bookState.bookmarks.length === 0) {
        listEl.innerHTML = `<span class="text-muted" style="font-size: 0.8rem; text-align: center; display: block; padding: 10px;">No bookmarked pages yet.</span>`;
        return;
    }

    bookState.bookmarks.forEach(p => {
        const item = document.createElement("div");
        item.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: var(--bg-primary); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.82rem; cursor: pointer;";
        item.innerHTML = `
            <span><i class="fa-solid fa-bookmark text-warning"></i> Page ${p}</span>
            <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 0.7rem;">Go</button>
        `;
        item.onclick = () => {
            bookState.currentPage = p;
            redrawBookCanvas();
        };
        listEl.appendChild(item);
    });
}

function redrawCurrentPageAnnotations() {
    const animCanvas = document.getElementById("book-annotation-canvas");
    if (!animCanvas) return;
    const ctx = animCanvas.getContext("2d");
    ctx.clearRect(0, 0, animCanvas.width, animCanvas.height);

    const dpr = window.devicePixelRatio || 1.5;
    const renderScale = (bookState.zoom || 1.0) * dpr;

    ctx.save();
    ctx.scale(renderScale, renderScale);

    const page = bookState.currentPage;
    const annList = bookState.annotations[page] || [];
    annList.forEach((stroke, idx) => {
        drawSingleStroke(ctx, stroke);
        if (bookState.selectedAnnotationIndex === idx) {
            const bounds = getAnnotationBBox(stroke);
            drawSelectionBox(ctx, bounds);
        }
    });

    ctx.restore();
}

function drawSelectionBox(ctx, bounds) {
    if (!bounds) return;
    ctx.save();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
    ctx.restore();
}

// Redraw canvas pages & overlays
async function redrawBookCanvas() {
    saveUserBookProgress();

    const pageNumInput = document.getElementById("book-goto-page-input");
    const totalPagesEl = document.getElementById("book-total-pages-num");
    const zoomPctEl = document.getElementById("book-zoom-percentage");
    const lockOverlay = document.getElementById("book-page-lock-overlay");

    const accessInfo = getBookAccessLevel(state.currentUser);
    const maxPage = accessInfo.isFullGrant ? (bookState.numPages || 9999) : Math.min(10, bookState.numPages || 10);

    // Enforce maxPage bounds strictly
    if (bookState.currentPage > maxPage) {
        bookState.currentPage = maxPage;
        showToast("معاينة مجانية", "تم الوصول للحد الأقصى للمعاينة المجانية (10 صفحات). يرجى طلب الوصول الكامل من المشرف.", "warning");
    }

    if (pageNumInput) pageNumInput.value = bookState.currentPage;
    if (totalPagesEl) totalPagesEl.innerText = bookState.numPages;
    if (zoomPctEl) zoomPctEl.innerText = `${Math.round(bookState.zoom * 100)}%`;

    // Show lock overlay if normal student exceeds page 10
    if (bookState.currentPage >= 10 && !accessInfo.isFullGrant) {
        if (lockOverlay) lockOverlay.classList.remove("hidden");
    } else {
        if (lockOverlay) lockOverlay.classList.add("hidden");
    }

    updateBookmarkIcon();

    const pdfCanvas = document.getElementById("book-pdf-canvas");
    const animCanvas = document.getElementById("book-annotation-canvas");
    const stack = document.getElementById("book-canvas-stack");

    if (!pdfCanvas || !animCanvas) return;

    // Apply strict copy & screenshot protection on canvas stack
    if (stack && !stack.dataset.protected) {
        stack.dataset.protected = "true";
        stack.style.userSelect = "none";
        stack.style.webkitUserSelect = "none";
        stack.style.webkitTouchCallout = "none";
        
        stack.addEventListener("contextmenu", e => e.preventDefault());
        stack.addEventListener("dragstart", e => e.preventDefault());
        stack.addEventListener("selectstart", e => e.preventDefault());
        
        window.addEventListener("keydown", e => {
            const viewerVisible = !document.getElementById("book-viewer-workspace")?.classList.contains("hidden");
            if (viewerVisible) {
                if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c'].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    showToast("حماية المحتوى", "نسخ أو طباعة كتاب Hawari غير متاح لحماية حقوق الطبع.", "warning");
                }
            }
        });
    }

    // Load PDF Document if not loaded yet
    if (!bookState.pdfDoc && bookState.activeBookFile) {
        await loadRealBookPdfDocument(bookState.activeBookFile);
        if (totalPagesEl && bookState.pdfDoc) {
            totalPagesEl.innerText = bookState.pdfDoc.numPages;
        }
        if (pageNumInput && bookState.pdfDoc) {
            pageNumInput.max = bookState.pdfDoc.numPages;
        }
    }

    if (bookState.pdfDoc) {
        try {
            const pageNum = Math.max(1, Math.min(bookState.currentPage, bookState.pdfDoc.numPages));
            
            // SECURITY GUARD: If page exceeds maxPage for normal student, DO NOT render PDF page
            if (pageNum > maxPage) {
                console.warn("[PDFViewer] Page access blocked beyond maxPage:", maxPage);
                return;
            }

            const page = await bookState.pdfDoc.getPage(pageNum);
            const basePageViewport = page.getViewport({ scale: 1.0 });

            const viewportEl = document.getElementById("book-canvas-viewport");
            const availWidth = viewportEl ? Math.max(260, viewportEl.clientWidth - 16) : (window.innerWidth - 20);

            let effectiveZoom = bookState.zoom || 1.0;
            // On mobile devices (< 768px), auto-fit to container width seamlessly
            if (window.innerWidth < 768 && (!bookState.userCustomZoom || bookState.zoom === 1.0)) {
                effectiveZoom = Math.min(1.0, availWidth / basePageViewport.width);
                bookState.zoom = effectiveZoom;
                if (zoomPctEl) zoomPctEl.innerText = `${Math.round(bookState.zoom * 100)}%`;
            }

            const dpr = window.devicePixelRatio || 1.5;
            const scale = effectiveZoom * dpr;
            const displayScale = effectiveZoom;
            const viewport = page.getViewport({ scale: scale });
            const displayViewport = page.getViewport({ scale: displayScale });

            if (stack) {
                stack.style.width = displayViewport.width + "px";
                stack.style.height = displayViewport.height + "px";
            }

            pdfCanvas.width = viewport.width;
            pdfCanvas.height = viewport.height;
            pdfCanvas.style.width = displayViewport.width + "px";
            pdfCanvas.style.height = displayViewport.height + "px";

            animCanvas.width = viewport.width;
            animCanvas.height = viewport.height;
            animCanvas.style.width = displayViewport.width + "px";
            animCanvas.style.height = displayViewport.height + "px";

            const pdfCtx = pdfCanvas.getContext("2d");
            pdfCtx.clearRect(0, 0, viewport.width, viewport.height);

            await page.render({ canvasContext: pdfCtx, viewport: viewport }).promise;
            console.log(`[PDFViewer] Rendered REAL PDF page ${pageNum} / ${bookState.pdfDoc.numPages}`);

            redrawCurrentPageAnnotations();
        } catch (renderErr) {
            console.error("[PDFViewer] Error rendering real PDF page:", renderErr);
        }
    } else {
        const baseWidth = 720;
        const baseHeight = 980;
        const scaledWidth = Math.round(baseWidth * bookState.zoom);
        const scaledHeight = Math.round(baseHeight * bookState.zoom);

        if (stack) {
            stack.style.width = scaledWidth + "px";
            stack.style.height = scaledHeight + "px";
        }
        pdfCanvas.width = scaledWidth;
        pdfCanvas.height = scaledHeight;
        animCanvas.width = scaledWidth;
        animCanvas.height = scaledHeight;

        const pdfCtx = pdfCanvas.getContext("2d");
        pdfCtx.fillStyle = "#ffffff";
        pdfCtx.fillRect(0, 0, scaledWidth, scaledHeight);
        pdfCtx.fillStyle = "#475569";
        pdfCtx.font = "bold 16px Outfit, sans-serif";
        pdfCtx.fillText("جاري تحميل مستند الـ PDF الأصلي...", 40, 50);
    }
}





window.testRealSupabaseSession = async function() {
    console.log("=== Running testRealSupabaseSession ===");
    let session = window.supabaseSession;
    if (!session) {
        try {
            const raw = localStorage.getItem("hawari_supabase_session");
            if (raw) session = JSON.parse(raw);
        } catch (e) {}
    }
    const hasSession = !!session;
    const token = session ? session.access_token : (state.currentUser ? (state.currentUser.token || state.currentUser.access_token) : null);
    const hasToken = !!token;
    console.log("[AUTH-TEST] Session:", hasSession);
    console.log("[AUTH-TEST] Token:", hasToken);

    if (!token) {
        console.error("[AUTH-TEST] Failed: No active Supabase access_token");
        return false;
    }

    const decoded = parseJwtPayload(token);
    if (decoded) {
        console.log("[AUTH-TEST] JWT role:", decoded.role);
        console.log("[AUTH-TEST] JWT email:", decoded.email);
        console.log("[AUTH-TEST] JWT sub:", decoded.sub);
        console.log("[AUTH-TEST] JWT aud:", decoded.aud);
        console.log("[AUTH-TEST] JWT exp:", new Date(decoded.exp * 1000).toISOString());
    }

    const url = import.meta.env.VITE_SUPABASE_URL || window.ENV_SUPABASE_URL || "https://sueksolsletlhunpbtix.supabase.co";
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || window.ENV_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";
    try {
        const restRes = await fetch(`${url.replace(/\/$/, '')}/rest/v1/hawari_users?select=email&limit=1`, {
            headers: {
                "apikey": anonKey,
                "Authorization": `Bearer ${token}`
            }
        });
        console.log("[AUTH-TEST] Authenticated REST request status:", restRes.status);
        return restRes.status === 200;
    } catch (e) {
        console.error("[AUTH-TEST] Exception:", e);
        return false;
    }
};


function renderAdminBookAccessManager() {
    fetchGrantedUsersList();

    const accessForm = document.getElementById("admin-book-access-form");
    if (accessForm && !accessForm.getAttribute("data-bound")) {
        accessForm.setAttribute("data-bound", "true");
        accessForm.onsubmit = async function(e) {
            e.preventDefault();
            const emailInput = document.getElementById("admin-book-access-email");
            if (!emailInput) return;
            const email = emailInput.value.trim();
            if (!email) return;
            const ok = await grantBookAccess(email);
            if (ok) emailInput.value = "";
        };
    }
}
window.renderAdminBookAccessManager = renderAdminBookAccessManager;
