/**
 * Cloudflare Pages Function - Native Edge Proxy & Cache for Hawari Platform
 * Route: /supabase-proxy/*
 * Automatically deployed by Cloudflare Pages on git push.
 */

const SUPABASE_ORIGIN = "https://sueksolsletlhunpbtix.supabase.co";

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer, range, x-hawari-purge",
            "Access-Control-Max-Age": "86400"
        }
    });
}

export async function onRequest(context) {
    const { request, waitUntil } = context;
    const url = new URL(request.url);

    // Normalize path to target on Supabase
    let targetPath = url.pathname.replace(/^\/supabase-proxy/, "");
    if (!targetPath.startsWith("/")) {
        targetPath = "/" + targetPath;
    }

    const originUrl = new URL(targetPath + url.search, SUPABASE_ORIGIN);

    // Forward request headers
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("Host", originUrl.hostname);

    const method = request.method.toUpperCase();
    const isGet = method === "GET";
    const isPost = method === "POST";

    const isSanitizedQuestionsRpc = targetPath.includes("/rpc/get_sanitized_questions");
    const isQuizResults = targetPath.includes("/hawari_quiz_results");
    const isBookFiles = targetPath.includes("/hawari_book_files");
    const isAnnouncements = targetPath.includes("/hawari_announcements");

    // Critical: Auth, Student Progress, and mutations are never cached
    const isPrivateOrAuth = 
        targetPath.includes("/auth/v1") || 
        targetPath.includes("/hawari_users") || 
        targetPath.includes("/hawari_user_book_progress") || 
        targetPath.includes("/hawari_book_annotations") || 
        (!isGet && !isSanitizedQuestionsRpc);

    // 1. Private / Auth / Mutations -> Pass-Through (no-store)
    if (isPrivateOrAuth) {
        const originResponse = await fetch(new Request(originUrl.toString(), {
            method: request.method,
            headers: forwardHeaders,
            body: (method !== "GET" && method !== "HEAD") ? request.body : undefined,
            redirect: "follow"
        }));

        const responseHeaders = new Headers(originResponse.headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
        responseHeaders.set("X-Hawari-Edge", "PAGES-PASS-THROUGH");

        return new Response(originResponse.body, {
            status: originResponse.status,
            statusText: originResponse.statusText,
            headers: responseHeaders
        });
    }

    // 2. Questions Bank (POST RPC -> Edge Cached for 7 days)
    if (isSanitizedQuestionsRpc && isPost) {
        const bodyText = await request.clone().text();
        let group = "infection";
        try {
            const parsed = JSON.parse(bodyText);
            if (parsed.p_group) group = String(parsed.p_group).toLowerCase().trim();
        } catch (e) {}

        const cacheKeyUrl = new URL(`https://hawari-edge-cache.internal/questions/${group}`);
        const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
        const cache = caches.default;

        const isPurgeRequested = url.searchParams.has("purge") || request.headers.has("x-hawari-purge");

        if (!isPurgeRequested) {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) {
                const hitHeaders = new Headers(cachedResponse.headers);
                hitHeaders.set("CF-Cache-Status", "HIT");
                hitHeaders.set("X-Hawari-Edge", "PAGES-CACHE-HIT");
                hitHeaders.set("Access-Control-Allow-Origin", "*");
                return new Response(cachedResponse.body, {
                    status: cachedResponse.status,
                    headers: hitHeaders
                });
            }
        }

        const originResponse = await fetch(new Request(originUrl.toString(), {
            method: "POST",
            headers: forwardHeaders,
            body: bodyText,
            redirect: "follow"
        }));

        if (originResponse.ok) {
            const responseData = await originResponse.text();
            const cacheHeaders = new Headers(originResponse.headers);
            cacheHeaders.set("Access-Control-Allow-Origin", "*");
            cacheHeaders.set("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
            cacheHeaders.set("CF-Cache-Status", isPurgeRequested ? "PURGED" : "MISS");
            cacheHeaders.set("X-Hawari-Edge", "PAGES-CACHE-WRITE");

            const responseToCache = new Response(responseData, {
                status: originResponse.status,
                headers: cacheHeaders
            });

            if (waitUntil) {
                waitUntil(cache.put(cacheKey, responseToCache.clone()));
            }
            return responseToCache;
        }

        return originResponse;
    }

    // 3. Quiz Results (GET -> Edge Cached for 3 minutes)
    if (isQuizResults && isGet) {
        const cache = caches.default;
        const cacheKey = new Request(originUrl.toString(), { method: "GET" });
        const isPurgeRequested = url.searchParams.has("purge");

        if (!isPurgeRequested) {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) {
                const hitHeaders = new Headers(cachedResponse.headers);
                hitHeaders.set("CF-Cache-Status", "HIT");
                hitHeaders.set("X-Hawari-Edge", "PAGES-CACHE-HIT");
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
            cacheHeaders.set("X-Hawari-Edge", "PAGES-CACHE-WRITE");

            const responseToCache = new Response(responseData, {
                status: originResponse.status,
                headers: cacheHeaders
            });

            if (waitUntil) {
                waitUntil(cache.put(cacheKey, responseToCache.clone()));
            }
            return responseToCache;
        }

        return originResponse;
    }

    // 4. Book Files & Announcements (GET -> Edge Cached for 1 hour)
    if ((isBookFiles || isAnnouncements) && isGet) {
        const cache = caches.default;
        const cacheKey = new Request(originUrl.toString(), { method: "GET" });

        if (!url.searchParams.has("purge")) {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) {
                const hitHeaders = new Headers(cachedResponse.headers);
                hitHeaders.set("CF-Cache-Status", "HIT");
                hitHeaders.set("X-Hawari-Edge", "PAGES-CACHE-HIT");
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
            cacheHeaders.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
            cacheHeaders.set("CF-Cache-Status", "MISS");
            cacheHeaders.set("X-Hawari-Edge", "PAGES-CACHE-WRITE");

            const responseToCache = new Response(responseData, {
                status: originResponse.status,
                headers: cacheHeaders
            });

            if (waitUntil) {
                waitUntil(cache.put(cacheKey, responseToCache.clone()));
            }
            return responseToCache;
        }

        return originResponse;
    }

    // Default Pass-Through
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
