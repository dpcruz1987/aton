import { createHmac, timingSafeEqual } from "node:crypto";

function reply(res, status, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  return res.status(status).json(body);
}
function verify(q) {
  const token = process.env.ATON_TOKEN || "";
  const ts = String(q.ts || "");
  const sig = String(q.sig || "");
  if (!token || !ts || !sig || Math.abs(Date.now() - Number(ts)) > 300000) return false;
  const expected = createHmac("sha256", token).update(`probe\n${ts}`).digest("hex");
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
export default async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  if (!verify(req.query || {})) return reply(res, 401, { error: "invalid_signature" });
  const baseRaw = process.env.ATON_BASE_URL;
  const token = process.env.ATON_TOKEN;
  if (!baseRaw || !token) return reply(res, 503, { error: "not_configured" });
  const header = process.env.ATON_TOKEN_HEADER || "Authorization";
  const prefixToken = process.env.ATON_TOKEN_PREFIX ?? "";
  const host = new URL(baseRaw).origin;
  const candidates = [
    "/produtos/listagemgeral",
    "/api/produtos/listagemgeral",
    "/api/v1/produtos/listagemgeral",
    "/v1/produtos/listagemgeral",
    "/aton/produtos/listagemgeral",
    "/api/aton/produtos/listagemgeral",
    "/rest/produtos/listagemgeral",
    "/public/produtos/listagemgeral",
    "/publica/produtos/listagemgeral"
  ];
  const results = [];
  for (const path of candidates) {
    try {
      const r = await fetch(host + path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", [header]: `${prefixToken}${token}` },
        body: JSON.stringify({ offset: 0, limit: 1 }),
        redirect: "follow",
        signal: AbortSignal.timeout(6000),
      });
      results.push({ path, status: r.status, redirected: r.redirected, final_path: new URL(r.url).pathname, content_type: r.headers.get("content-type") });
      await r.body?.cancel();
    } catch (e) {
      results.push({ path, error: e?.cause?.code || e?.name || "fetch_error" });
    }
  }
  return reply(res, 200, { host: new URL(baseRaw).host, results });
}
