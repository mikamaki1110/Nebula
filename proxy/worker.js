// =====================================================================
// Nebula KI-Proxy (Cloudflare Worker)
// Hält den Anthropic-API-Schlüssel geheim und leitet ATLAS-Anfragen weiter.
// Der Schlüssel liegt NUR hier (als Secret), nie in der Nebula-App.
//
// Schutz gegen Missbrauch:
//  - festes Modell (MODEL) und begrenzte Antwortlänge (MAX_TOKENS)
//  - Größenlimit für Anfragen
//  - Ratenbegrenzung pro Installation und pro IP-Adresse
//  - die harte Kostengrenze setzt du zusätzlich in der Anthropic Console (Limits)
// =====================================================================

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_BODY_BYTES = 300_000;
const MAX_MESSAGES = 120;

function json(status, error, code) {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function allowed(limiter, key) {
  if (!limiter) return true; // ohne Binding keine Ratenbegrenzung (nur zum Testen)
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Nebula KI-Proxy läuft.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/messages") return json(404, "Nicht gefunden.", "not-found");
    if (!env.ANTHROPIC_API_KEY) return json(500, "Der Proxy ist nicht eingerichtet (Secret ANTHROPIC_API_KEY fehlt).", "not-configured");

    const install = request.headers.get("x-nebula-install") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(install)) {
      return json(400, "Ungültige Anfrage.", "bad-install");
    }

    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES) return json(413, "Die Anfrage ist zu groß.", "too-large");

    const ip = request.headers.get("cf-connecting-ip") ?? "unbekannt";
    if (!(await allowed(env.LIMIT_INSTALL, install)) || !(await allowed(env.LIMIT_IP, ip))) {
      return json(429, "Zu viele Anfragen in kurzer Zeit.", "rate-limit");
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json(413, "Die Anfrage ist zu groß.", "too-large");
      body = JSON.parse(raw);
    } catch {
      return json(400, "Ungültige Anfrage.", "bad-json");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
      return json(400, "Ungültige Anfrage.", "bad-messages");
    }

    const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 1), Number(env.MAX_TOKENS) || 2048);
    // Nur die Felder weitergeben, die ATLAS braucht – Modell und Länge bestimmt der Proxy.
    const upstreamBody = {
      model: env.MODEL || "claude-haiku-5-5",
      max_tokens: maxTokens,
      messages: body.messages,
      ...(typeof body.system === "string" ? { system: body.system.slice(0, 40_000) } : {}),
      ...(Array.isArray(body.tools) ? { tools: body.tools.slice(0, 40) } : {}),
    };

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(upstreamBody),
      });
    } catch {
      return json(502, "Der KI-Dienst ist gerade nicht erreichbar.", "upstream-unreachable");
    }

    // Fehler von Anthropic nicht 1:1 durchreichen (könnten Konto-Details enthalten)
    if (!upstream.ok) {
      if (upstream.status === 429) return json(429, "Der KI-Dienst ist gerade ausgelastet.", "upstream-busy");
      if (upstream.status === 400) return json(400, "Die KI konnte die Anfrage nicht verarbeiten.", "upstream-bad-request");
      if (upstream.status === 401 || upstream.status === 403) return json(503, "Der Gratis-Zugang ist gerade nicht verfügbar.", "upstream-auth");
      return json(502, "Der KI-Dienst hat gerade Probleme.", "upstream-error");
    }
    return new Response(upstream.body, { status: 200, headers: { "content-type": "application/json" } });
  },
};
