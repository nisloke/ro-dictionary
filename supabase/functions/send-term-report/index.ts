import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Auth check — only service_role_key may invoke this function
// ---------------------------------------------------------------------------
function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "");
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return false;
    const payload = JSON.parse(atob(payloadB64));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------
function buildEmailHtml(
  terms: Array<{
    term: string;
    suggested_full_name: string | null;
    suggested_description: string | null;
    suggested_category: string | null;
    search_count: number;
    first_seen_at: string;
  }>,
): string {
  const rows = terms
    .map(
      (t) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;">${escapeHtml(t.term)}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.suggested_full_name ?? "-")}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.suggested_description ?? "-")}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(t.suggested_category ?? "-")}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;text-align:center;">${t.search_count}</td>
        <td style="padding:8px 12px;border:1px solid #ddd;font-size:12px;">${formatDate(t.first_seen_at)}</td>
      </tr>`,
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;max-width:800px;margin:0 auto;padding:20px;">
  <h2 style="color:#4a56e2;">🔍 RO 사전 — 신규 미확인 용어 리포트</h2>
  <p>아래 용어들이 문장 번역 기능에서 새롭게 감지되었습니다. 사전 등록 여부를 검토해 주세요.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">용어</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">추정 풀네임</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">추정 설명</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">카테고리</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:center;">검색 횟수</th>
        <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">최초 감지</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p style="color:#888;font-size:12px;">이 메일은 RO 사전 시스템에서 자동 발송되었습니다.</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Supabase credentials not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ---- Fetch un-notified terms ----
    const { data: terms, error: fetchError } = await supabase
      .from("unknown_terms")
      .select("id, term, suggested_full_name, suggested_description, suggested_category, search_count, first_seen_at")
      .eq("notified", false)
      .eq("status", "pending")
      .order("search_count", { ascending: false });

    if (fetchError) {
      console.error("Failed to fetch unknown terms:", fetchError);
      return new Response(
        JSON.stringify({ error: "Database query failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!terms || terms.length === 0) {
      return new Response(
        JSON.stringify({ message: "No new terms" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ---- Build and send email via Resend ----
    const subject = `[RO 사전] 신규 미확인 용어 ${terms.length}건 (${todayString()})`;
    const html = buildEmailHtml(terms);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RO 사전 <onboarding@resend.dev>",
        to: ["nisloke@gmail.com"],
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      console.error("Resend API error:", resendResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Failed to send email" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // ---- Mark terms as notified ----
    const termIds = terms.map((t) => t.id);
    const { error: updateError } = await supabase
      .from("unknown_terms")
      .update({ notified: true })
      .in("id", termIds);

    if (updateError) {
      console.error("Failed to update notified status:", updateError);
      // Email was sent, so we return partial success
      return new Response(
        JSON.stringify({
          message: `Email sent for ${terms.length} terms, but failed to mark as notified`,
          emailSent: true,
          termCount: terms.length,
        }),
        { status: 207, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        message: `Report sent for ${terms.length} terms`,
        termCount: terms.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
