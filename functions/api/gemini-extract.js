/**
 * Cloudflare Pages Function - Secure Gemini Question Extractor
 * Route: /api/gemini-extract
 */

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type, authorization",
            "Access-Control-Max-Age": "86400"
        }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const rawText = String(body.text || "").substring(0, 100000);
        const defaultTopic = String(body.defaultTopic || "Infectious Diseases");
        const defaultSource = String(body.defaultSource || "PAST_PAPER");
        const apiKey = (env && env.GEMINI_API_KEY ? env.GEMINI_API_KEY : (body.apiKey || "")).trim();

        if (!apiKey) {
            return new Response(JSON.stringify({
                success: false,
                error: "GEMINI_API_KEY is not configured in Cloudflare Pages environment or request."
            }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        if (!rawText.trim()) {
            return new Response(JSON.stringify({
                success: false,
                error: "Source text is empty."
            }), {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

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

        const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
        const geminiRes = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: systemPrompt + "\n\nMedical source content to extract MCQs from:\n" + rawText }]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1
                }
            })
        });

        if (!geminiRes.ok) {
            const errJson = await geminiRes.json().catch(() => ({}));
            return new Response(JSON.stringify({
                success: false,
                error: errJson.error?.message || `Gemini API returned status ${geminiRes.status}`
            }), {
                status: geminiRes.status,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        }

        const data = await geminiRes.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsedQuestions = candidateText ? JSON.parse(candidateText) : [];

        return new Response(JSON.stringify({
            success: true,
            questions: Array.isArray(parsedQuestions) ? parsedQuestions : []
        }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    } catch (err) {
        return new Response(JSON.stringify({
            success: false,
            error: err.message || "Unexpected error in Gemini extraction edge function"
        }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
    }
}
