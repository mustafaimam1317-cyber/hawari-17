/**
 * HAWARI PLATFORM - CLOUDFLARE EDGE GATEWAY & CACHE WORKER
 * 
 * Objective:
 * Offload 98%+ of read traffic from Supabase to Cloudflare's global edge network (Free & Unlimited Bandwidth).
 * Enables Hawari Platform to effortlessly scale to 500 - 5,000 concurrent students without hitting Supabase free tier limits.
 * 
 * Target Origin: https://sueksolsletlhunpbtix.supabase.co
 */

const SUPABASE_ORIGIN = "https://sueksolsletlhunpbtix.supabase.co";

export default {
    async fetch(request, env, ctx) {
        // 1. Handle CORS Preflight (OPTIONS)
        if (request.method === "OPTIONS") {
            return handleCors(request);
        }

        const url = new URL(request.url);

        // 2. Normalize target path on Supabase
        // Supports being deployed on a subpath (e.g. yourdomain.com/supabase-proxy/*)
        // or a custom subdomain (e.g. api.yourdomain.com/*)
        let targetPath = url.pathname;
        if (targetPath.startsWith("/supabase-proxy")) {
            targetPath = targetPath.replace(/^\/supabase-proxy/, "");
        }
        if (!targetPath.startsWith("/")) {
            targetPath = "/" + targetPath;
        }
        // Auto-prefix /rest/v1 for table and rpc endpoints if not already prefixed
        if (!targetPath.startsWith("/rest/v1") && !targetPath.startsWith("/auth/v1") && !targetPath.startsWith("/storage/v1")) {
            targetPath = "/rest/v1" + targetPath;
        }

        const originUrl = new URL(targetPath + url.search, SUPABASE_ORIGIN);

        // Copy and forward request headers
        const forwardHeaders = new Headers(request.headers);
        forwardHeaders.set("Host", originUrl.hostname);

        const method = request.method.toUpperCase();
        const isGet = method === "GET";
        const isPost = method === "POST";

        // Identify routes
        const isSanitizedQuestionsRpc = targetPath.includes("/rpc/get_sanitized_questions");
        const isQuizResults = targetPath.includes("/hawari_quiz_results");
        const isBookFiles = targetPath.includes("/hawari_book_files");
        const isAnnouncements = targetPath.includes("/hawari_announcements");
        
        // Critical: All Auth, User Records, and Mutations MUST NOT be cached
        const isPrivateOrAuth = 
            targetPath.includes("/auth/v1") || 
            targetPath.includes("/hawari_users") || 
            targetPath.includes("/hawari_user_book_progress") || 
            targetPath.includes("/hawari_book_annotations") || 
            (!isGet && !isSanitizedQuestionsRpc);

        // =========================================================================
        // ROUTE 1: PRIVATE / AUTH / MUTATIONS (Pass-Through with Zero-Store Headers)
        // =========================================================================
        if (isPrivateOrAuth) {
            const originRequest = new Request(originUrl.toString(), {
                method: request.method,
                headers: forwardHeaders,
                body: (method !== "GET" && method !== "HEAD") ? request.body : undefined,
                redirect: "follow"
            });

            const originResponse = await fetch(originRequest);
            const responseHeaders = new Headers(originResponse.headers);
            responseHeaders.set("Access-Control-Allow-Origin", "*");
            responseHeaders.set("Access-Control-Allow-Credentials", "true");
            responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
            responseHeaders.set("X-Hawari-Edge", "PASS-THROUGH");

            return new Response(originResponse.body, {
                status: originResponse.status,
                statusText: originResponse.statusText,
                headers: responseHeaders
            });
        }

        // =========================================================================
        // ROUTE 2: SANITIZED QUESTION BANK (POST RPC -> Edge Cached for 7 Days)
        // =========================================================================
        if (isSanitizedQuestionsRpc && isPost) {
            const bodyText = await request.clone().text();
            let group = "infection";
            try {
                const parsed = JSON.parse(bodyText);
                if (parsed.p_group) group = String(parsed.p_group).toLowerCase().trim();
            } catch (e) {}

            // Construct unique cache key per course group
            const cacheKeyUrl = new URL(`https://hawari-edge-cache.internal/questions/${group}`);
            const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
            const cache = caches.default;

            const isPurgeRequested = url.searchParams.has("purge") || request.headers.has("x-hawari-purge");

            if (!isPurgeRequested) {
                let cachedResponse = await cache.match(cacheKey);
                if (cachedResponse) {
                    const hitHeaders = new Headers(cachedResponse.headers);
                    hitHeaders.set("CF-Cache-Status", "HIT");
                    hitHeaders.set("X-Hawari-Edge", "EDGE-CACHE-HIT");
                    hitHeaders.set("Access-Control-Allow-Origin", "*");
                    return new Response(cachedResponse.body, {
                        status: cachedResponse.status,
                        headers: hitHeaders
                    });
                }
            }

            // Fetch from Supabase origin on cache MISS or PURGE
            const originRequest = new Request(originUrl.toString(), {
                method: "POST",
                headers: forwardHeaders,
                body: bodyText,
                redirect: "follow"
            });

            const originResponse = await fetch(originRequest);
            if (originResponse.ok) {
                const responseData = await originResponse.text();
                const cacheHeaders = new Headers(originResponse.headers);
                cacheHeaders.set("Access-Control-Allow-Origin", "*");
                cacheHeaders.set("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
                cacheHeaders.set("CF-Cache-Status", isPurgeRequested ? "PURGED_AND_RELOADED" : "MISS");
                cacheHeaders.set("X-Hawari-Edge", "EDGE-CACHE-WRITE");

                const responseToCache = new Response(responseData, {
                    status: originResponse.status,
                    headers: cacheHeaders
                });

                ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
                return responseToCache;
            }

            return originResponse;
        }

        // =========================================================================
        // ROUTE 3: QUIZ RESULTS / LEADERBOARD (GET -> Edge Cached for 3 Minutes)
        // =========================================================================
        if (isQuizResults && isGet) {
            const cache = caches.default;
            const cacheKey = new Request(originUrl.toString(), { method: "GET" });
            const isPurgeRequested = url.searchParams.has("purge");

            if (!isPurgeRequested) {
                let cachedResponse = await cache.match(cacheKey);
                if (cachedResponse) {
                    const hitHeaders = new Headers(cachedResponse.headers);
                    hitHeaders.set("CF-Cache-Status", "HIT");
                    hitHeaders.set("X-Hawari-Edge", "EDGE-CACHE-HIT");
                    hitHeaders.set("Access-Control-Allow-Origin", "*");
                    return new Response(cachedResponse.body, {
                        status: cachedResponse.status,
                        headers: hitHeaders
                    });
                }
            }

            const originResponse = await fetch(new Request(originUrl.toString(), {
                method: "GET",
                headers: forwardHeaders
            }));

            if (originResponse.ok) {
                const responseData = await originResponse.text();
                const cacheHeaders = new Headers(originResponse.headers);
                cacheHeaders.set("Access-Control-Allow-Origin", "*");
                cacheHeaders.set("Cache-Control", "public, max-age=180, s-maxage=180, stale-while-revalidate=60");
                cacheHeaders.set("CF-Cache-Status", "MISS");
                cacheHeaders.set("X-Hawari-Edge", "EDGE-CACHE-WRITE");

                const responseToCache = new Response(responseData, {
                    status: originResponse.status,
                    headers: cacheHeaders
                });

                ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
                return responseToCache;
            }

            return originResponse;
        }

        // =========================================================================
        // ROUTE 4: ANNOUNCEMENTS (GET -> Edge Cached for 60 Seconds)
        // =========================================================================
        if (isAnnouncements && isGet) {
            const cache = caches.default;
            const cacheKey = new Request(originUrl.toString(), { method: "GET" });

            let cachedResponse = await cache.match(cacheKey);
            if (cachedResponse && !url.searchParams.has("purge")) {
                const hitHeaders = new Headers(cachedResponse.headers);
                hitHeaders.set("CF-Cache-Status", "HIT");
                hitHeaders.set("X-Hawari-Edge", "EDGE-CACHE-HIT");
                hitHeaders.set("Access-Control-Allow-Origin", "*");
                return new Response(cachedResponse.body, {
                    status: cachedResponse.status,
                    headers: hitHeaders
                });
            }

            const originResponse = await fetch(new Request(originUrl.toString(), {
                method: "GET",
                headers: forwardHeaders
            }));

            if (originResponse.ok) {
                const responseData = await originResponse.text();
                const cacheHeaders = new Headers(originResponse.headers);
                cacheHeaders.set("Access-Control-Allow-Origin", "*");
                cacheHeaders.set("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=30");
                cacheHeaders.set("CF-Cache-Status", "MISS");
                cacheHeaders.set("X-Hawari-Edge", "EDGE-CACHE-WRITE");

                const responseToCache = new Response(responseData, {
                    status: originResponse.status,
                    headers: cacheHeaders
                });

                ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
                return responseToCache;
            }

            return originResponse;
        }

        // =========================================================================
        // ROUTE 5: BOOK FILES (GET -> Edge Cached for 1 Hour)
        // =========================================================================
        if (isBookFiles && isGet) {
            const cache = caches.default;
            const cacheKey = new Request(originUrl.toString(), { method: "GET" });

            let cachedResponse = await cache.match(cacheKey);
            if (cachedResponse && !url.searchParams.has("purge")) {
                const hitHeaders = new Headers(cachedResponse.headers);
                hitHeaders.set("CF-Cache-Status", "HIT");
                hitHeaders.set("X-Hawari-Edge", "EDGE-CACHE-HIT");
                hitHeaders.set("Access-Control-Allow-Origin", "*");
                return new Response(cachedResponse.body, {
                    status: cachedResponse.status,
                    headers: hitHeaders
                });
            }

            const originResponse = await fetch(new Request(originUrl.toString(), {
                method: "GET",
                headers: forwardHeaders
            }));

            if (originResponse.ok) {
                const responseData = await originResponse.text();
                const cacheHeaders = new Headers(originResponse.headers);
                cacheHeaders.set("Access-Control-Allow-Origin", "*");
                cacheHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
                cacheHeaders.set("CF-Cache-Status", "MISS");
                cacheHeaders.set("X-Hawari-Edge", "EDGE-CACHE-WRITE");

                const responseToCache = new Response(responseData, {
                    status: originResponse.status,
                    headers: cacheHeaders
                });

                ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
                return responseToCache;
            }

            return originResponse;
        }

        // =========================================================================
        // DEFAULT FALLBACK: Standard Proxied Request
        // =========================================================================
        const originResponse = await fetch(new Request(originUrl.toString(), {
            method: request.method,
            headers: forwardHeaders,
            body: (method !== "GET" && method !== "HEAD") ? request.body : undefined
        }));

        const finalHeaders = new Headers(originResponse.headers);
        finalHeaders.set("Access-Control-Allow-Origin", "*");
        return new Response(originResponse.body, {
            status: originResponse.status,
            headers: finalHeaders
        });
    }
};

function handleCors(request) {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type, prefer, range, x-hawari-purge");
    headers.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers });
}
