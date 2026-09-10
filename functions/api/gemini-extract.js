/**
 * Cloudflare Pages Function: /api/gemini-extract
 * Server-side Edge Handler for Gemini 2.0 Flash AI Quiz Generation.
 * 
 * Protects GEMINI_API_KEY as an encrypted Cloudflare Secret, preventing client-side leaks.
 */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-hawari-admin-key",
    "Access-Control-Max-Age": "86400"
};

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const body = await request.json().catch(() => ({}));
        const rawText = body.text || "";
        const defaultTopic = body.defaultTopic || "Infectious Diseases";
        const defaultSource = body.defaultSource || "PAST_PAPER";
        
        // Priority 1: Cloudflare Secret (Server-side environment variable)
        // Priority 2: Client-provided fallback key (for local dev or transitional setups)
        const apiKey = (env?.GEMINI_API_KEY || body.apiKey || "").trim();

        if (!apiKey) {
            return new Response(
                JSON.stringify({
                    error: "مفتاح Gemini API غير مهيأ في السيرفر. يرجى إضافة GEMINI_API_KEY في إعدادات Cloudflare Pages Secrets."
                }),
                {
                    status: 400,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        if (!rawText || typeof rawText !== "string" || rawText.trim().length === 0) {
            return new Response(
                JSON.stringify({ error: "النص الطبي المراد استخراج الأسئلة منه فارغ." }),
                {
                    status: 400,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const systemPrompt = `You are an expert medical examination board question parser.
Your task is to analyze the provided medical text/notes/exam questions and extract or formulate all high-quality multiple choice questions (MCQs).
Rules:
1. Each question must have a clear clinical stem or theoretical question in English.
2. Must have options A, B, C, D (and E if present in source text).
3. Specify the correctOption ('A', 'B', 'C', 'D', or 'E').
4. Provide a detailed, high-yield clinical explanation explaining WHY the correct option is right and WHY the incorrect options are wrong.
5. Topic should be a relevant medical topic (e.g. "${defaultTopic}").
6. Source should be "${defaultSource}".
Output format MUST be valid JSON matching this exact schema:
[
  {
    "id": "q_ai_timestamp_index",
    "text": "Question stem text",
    "options": {
      "A": "Option A text",
      "B": "Option B text",
      "C": "Option C text",
      "D": "Option D text"
    },
    "correctOption": "A",
    "explanation": "Detailed clinical explanation...",
    "topic": "${defaultTopic}",
    "source": "${defaultSource}"
  }
]`;

        const requestBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: systemPrompt + "\n\nMedical source content to extract MCQs from:\n" + rawText.substring(0, 100000) }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1
            }
        };

        const googleResponse = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        if (!googleResponse.ok) {
            const errorData = await googleResponse.json().catch(() => ({}));
            const errMsg = errorData.error?.message || `Google Gemini API returned status ${googleResponse.status}`;
            return new Response(
                JSON.stringify({ error: errMsg }),
                {
                    status: googleResponse.status,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        const data = await googleResponse.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
            return new Response(
                JSON.stringify({ error: "استجابة فارغة من محرك Gemini API." }),
                {
                    status: 502,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        let parsedQuestions;
        try {
            parsedQuestions = JSON.parse(candidateText);
        } catch (jsonErr) {
            return new Response(
                JSON.stringify({ error: "فشل فك شفرة JSON الراجعة من محرك الذكاء الاصطناعي." }),
                {
                    status: 502,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        if (!Array.isArray(parsedQuestions)) {
            return new Response(
                JSON.stringify({ error: "صيغة الأسئلة الراجعة غير مطابقة للمصفوفة المطلوبة." }),
                {
                    status: 502,
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
                }
            );
        }

        // Attach unique IDs if not already structured
        const now = Date.now();
        const validatedQuestions = parsedQuestions.map((q, idx) => ({
            id: q.id || `q_ai_${now}_${idx + 1}`,
            text: q.text || "",
            options: q.options || {},
            correctOption: (q.correctOption || "A").toUpperCase(),
            explanation: q.explanation || "",
            topic: q.topic || defaultTopic,
            source: q.source || defaultSource
        }));

        return new Response(
            JSON.stringify({
                success: true,
                count: validatedQuestions.length,
                questions: validatedQuestions
            }),
            {
                status: 200,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
            }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message || "حدث خطأ غير متوقع في معالجة الذكاء الاصطناعي على السيرفر." }),
            {
                status: 500,
                headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
            }
        );
    }
}
