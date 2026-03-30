// ---------------------------------------------------------------------------
// Edge Function: trigger-rebuild
// Triggers GitHub Actions deploy workflow. Admin-only.
// Deployed with --no-verify-jwt; auth verified via supabase.auth.getUser().
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://nisloke.github.io",
];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-client-info, apikey",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
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
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    // ---- Authenticate & authorise admin via Supabase Auth ----
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "인증 토큰이 필요합니다." }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "인증 실패: " + (authError?.message ?? "유효하지 않은 토큰") }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (user.user_metadata?.is_admin !== true) {
      return new Response(
        JSON.stringify({ error: "관리자 권한이 필요합니다." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ---- Trigger GitHub Actions ----
    const githubPat = Deno.env.get("GITHUB_PAT");
    if (!githubPat) {
      console.error("GITHUB_PAT not configured");
      return new Response(
        JSON.stringify({ error: "서버 설정 오류: GitHub PAT이 설정되지 않았습니다." }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const githubResponse = await fetch(
      "https://api.github.com/repos/nisloke/ro-dictionary/actions/workflows/deploy.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `token ${githubPat}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "master" }),
      },
    );

    if (!githubResponse.ok) {
      const errText = await githubResponse.text();
      console.error("GitHub API error:", githubResponse.status, errText);
      return new Response(
        JSON.stringify({
          error: `GitHub 배포 트리거 실패 (HTTP ${githubResponse.status})`,
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: "배포가 트리거되었습니다." }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
