import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "MissionPop <noreply@mission-pop.com>";
const TO = "Contact@mission-pop.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const esc = (s: string) =>
  s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const clean = (v: unknown, max = 500) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const nom = clean(body.nom, 120);
  const entreprise = clean(body.entreprise, 160);
  const email = clean(body.email, 160);
  const telephone = clean(body.telephone, 40);
  const besoin = clean(body.besoin, 2000);
  const consent = body.consent === true;
  const trap = clean(body.website, 100);

  if (trap) return json({ ok: true });
  if (!nom || !telephone) return json({ error: "missing_fields" }, 400);
  if (!consent) return json({ error: "consent_required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.from("leads").insert({
    nom,
    entreprise,
    email,
    telephone,
    besoin,
    consent,
    source: "site",
    user_agent: req.headers.get("user-agent")?.slice(0, 400) ?? "",
  });

  if (error) {
    console.error("insert_failed", error);
    return json({ error: "insert_failed" }, 500);
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    const html = `
      <div style="font-family:system-ui,sans-serif;color:#0E2A1F;line-height:1.6">
        <p style="font-family:monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#E04A38;margin:0 0 6px">Nouvelle demande de rappel</p>
        <h2 style="margin:0 0 18px;font-size:20px">${esc(nom)}${entreprise ? " &middot; " + esc(entreprise) : ""}</h2>
        <p><b>Telephone :</b> ${esc(telephone)}</p>
        ${email ? `<p><b>Email :</b> ${esc(email)}</p>` : ""}
        ${besoin ? `<p><b>Besoin :</b><br>${esc(besoin).replace(/\n/g, "<br>")}</p>` : ""}
        <hr style="border:none;border-top:1px solid #EAE2D6;margin:22px 0">
        <p style="font-size:12px;color:#6B7F6B">Envoye depuis mission-pop.com &middot; consentement RGPD accepte</p>
      </div>`;

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: [TO],
          reply_to: email || undefined,
          subject: `Demande de rappel — ${nom}${entreprise ? " (" + entreprise + ")" : ""}`,
          html,
        }),
      });
      if (!r.ok) console.error("resend_failed", r.status, await r.text());
    } catch (e) {
      console.error("resend_error", e);
    }
  }

  return json({ ok: true });
});
