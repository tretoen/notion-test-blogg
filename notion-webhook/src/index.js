// Notion → GitHub-relé (Cloudflare Worker)
//
// Notion sender et webhook når et innlegg endres. Denne workeren sjekker at
// meldingen virkelig kommer fra Notion, og ber så GitHub starte workflowen
// «Bygg og publiser» (repository_dispatch med typen «notion-updated»).
//
// Hemmeligheter (settes med `npx wrangler secret put <NAVN>`):
//   GITHUB_TOKEN               fine-grained token med «Contents: Read and write» på repoet
//   NOTION_VERIFICATION_TOKEN  tokenet Notion sender første gang (se README.md)
// Variabel (wrangler.toml):
//   GITHUB_REPO                f.eks. "tretoen/notion-test-blogg"

// Hendelser som kan endre det som vises på bloggen.
const PAGE_EVENTS = new Set([
  "page.created",
  "page.content_updated",
  "page.properties_updated",
  "page.deleted",
  "page.undeleted",
  "page.moved",
]);

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Notion → GitHub-reléet kjører.\n");
    }

    const raw = await request.text(); // signaturen regnes av de rå bytene
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("Ugyldig JSON\n", { status: 400 });
    }

    // Første gang: Notion sender et verifiseringstoken som må limes inn i Notion
    // og lagres som hemmeligheten NOTION_VERIFICATION_TOKEN.
    if (body.verification_token) {
      console.log(`Notion verification_token: ${body.verification_token}`);
      return new Response("ok\n");
    }

    if (!env.NOTION_VERIFICATION_TOKEN || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
      console.log("Mangler NOTION_VERIFICATION_TOKEN, GITHUB_TOKEN eller GITHUB_REPO.");
      return new Response("Ikke ferdig satt opp\n", { status: 503 });
    }

    const signature = request.headers.get("X-Notion-Signature") || "";
    if (!(await validSignature(raw, signature, env.NOTION_VERIFICATION_TOKEN))) {
      console.log("Avviste en forespørsel med ugyldig signatur.");
      return new Response("Ugyldig signatur\n", { status: 401 });
    }

    if (!PAGE_EVENTS.has(body.type)) {
      return new Response(`Ignorerer ${body.type}\n`);
    }

    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "321-notion-webhook",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "notion-updated",
        client_payload: { notion_event: body.type, page_id: body.entity?.id ?? null },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`GitHub svarte ${res.status}: ${text}`);
      // 502 gjør at Notion prøver igjen senere.
      return new Response("GitHub avviste forespørselen\n", { status: 502 });
    }

    console.log(`Startet bygg etter ${body.type} (${body.entity?.id ?? "ukjent side"})`);
    return new Response("Bygg startet\n", { status: 202 });
  },
};

// X-Notion-Signature = "sha256=" + HMAC-SHA256(verification_token, rå body) i hex.
async function validSignature(raw, header, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
