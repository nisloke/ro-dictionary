import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, resets on cold start — acceptable for edge)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://nisloke.github.io",
  "https://ro-dictionary.vercel.app",
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow any localhost port for development
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Anthropic classification prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `당신은 라그나로크 온라인 커뮤니티 용어 전문가입니다.

아래 단어들은 RO 커뮤니티 문장에서 발견되었으나 기존 사전에 없는 단어입니다.
각 단어가 RO 관련 용어인지 판단하고, 맞다면 의미를 풀이해주세요.
일반 한국어 단어(조사, 일상어 등)는 "일반어"로 분류해주세요.

JSON 배열로만 응답하세요 (다른 텍스트 없이):
[
  { "term": "단어", "isRoTerm": true, "fullName": "풀네임", "description": "설명", "category": "추정 카테고리" }
]

카테고리 옵션: job, gear, system, stat, place, slang, notation
일반어인 경우: { "term": "단어", "isRoTerm": false }`;

// ---------------------------------------------------------------------------
// Upsert RO terms into unknown_terms (fire-and-forget after stream ends)
// ---------------------------------------------------------------------------
async function upsertUnknownTerms(
  results: Array<{
    term: string;
    isRoTerm: boolean;
    fullName?: string;
    description?: string;
    category?: string;
  }>,
): Promise<void> {
  const roTerms = results.filter((r) => r.isRoTerm);
  if (roTerms.length === 0) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Supabase credentials not configured — skipping DB upsert");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  for (const roTerm of roTerms) {
    const { error } = await supabase.rpc("upsert_unknown_term", {
      _term: roTerm.term,
      _suggested_full_name: roTerm.fullName ?? null,
      _suggested_description: roTerm.description ?? null,
      _suggested_category: roTerm.category ?? null,
    });

    // If RPC doesn't exist, fall back to raw upsert
    if (error) {
      const upsertResult = await supabase
        .from("unknown_terms")
        .upsert(
          {
            term: roTerm.term,
            suggested_full_name: roTerm.fullName ?? null,
            suggested_description: roTerm.description ?? null,
            suggested_category: roTerm.category ?? null,
            search_count: 1,
            last_seen_at: new Date().toISOString(),
          },
          {
            onConflict: "term",
            ignoreDuplicates: false,
          },
        );

      if (upsertResult.error) {
        // Term already exists — increment search_count
        const { data: existing } = await supabase
          .from("unknown_terms")
          .select("id, search_count")
          .eq("term", roTerm.term)
          .single();

        if (existing) {
          await supabase
            .from("unknown_terms")
            .update({
              search_count: existing.search_count + 1,
              last_seen_at: new Date().toISOString(),
              suggested_full_name: roTerm.fullName ?? null,
              suggested_description: roTerm.description ?? null,
              suggested_category: roTerm.category ?? null,
            })
            .eq("id", existing.id);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse accumulated text into results JSON
// ---------------------------------------------------------------------------
function parseResultsJson(
  text: string,
): Array<{
  term: string;
  isRoTerm: boolean;
  fullName?: string;
  description?: string;
  category?: string;
}> {
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }
  return JSON.parse(jsonText);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Rate limiting — use x-forwarded-for or fallback
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // ---- Parse & validate input ----
    const body = await req.json();
    const unknownTerms: unknown = body?.unknownTerms;

    if (!Array.isArray(unknownTerms)) {
      return new Response(
        JSON.stringify({ error: "unknownTerms must be an array of strings" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (unknownTerms.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (unknownTerms.length > 20) {
      return new Response(
        JSON.stringify({ error: "Maximum 20 unknown terms per request" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const terms: string[] = [];
    for (const t of unknownTerms) {
      if (typeof t !== "string" || t.length === 0 || t.length > 30) {
        return new Response(
          JSON.stringify({
            error: "Each term must be a non-empty string with max 30 characters",
          }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      terms.push(t);
    }

    // ---- Call Anthropic API with streaming ----
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          stream: true,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `다음 단어들을 분류해주세요:\n${terms.map((t) => `- ${t}`).join("\n")}`,
            },
          ],
        }),
      },
    );

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "AI classification service unavailable" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ---- Stream SSE back to client, accumulate text for DB upsert ----
    const anthropicBody = anthropicResponse.body;
    if (!anthropicBody) {
      return new Response(
        JSON.stringify({ error: "Empty response from AI service" }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let accumulatedText = "";

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Parse the SSE chunk to accumulate text content for DB upsert
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]" || !data) continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              accumulatedText += evt.delta.text;
            }
          } catch {
            // Ignore parse errors on partial lines
          }
        }
        // Forward the raw SSE chunk to the client as-is
        controller.enqueue(chunk);
      },
      async flush() {
        // Stream ended — fire-and-forget DB upsert with accumulated text
        if (accumulatedText) {
          try {
            const results = parseResultsJson(accumulatedText);
            // Don't await — let it run in the background
            upsertUnknownTerms(results).catch((err) => {
              console.error("DB upsert error:", err);
            });
          } catch (err) {
            console.error("Failed to parse accumulated Sonnet JSON for DB upsert:", err);
          }
        }
      },
    });

    const streamedBody = anthropicBody.pipeThrough(transformStream);

    return new Response(streamedBody, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
