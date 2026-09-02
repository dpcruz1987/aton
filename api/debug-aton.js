import { createHmac, timingSafeEqual } from "node:crypto";

function reply(res, status, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  return res.status(status).json(body);
}

function operations() {
  try { return JSON.parse(process.env.ATON_READ_OPERATIONS || "{}"); }
  catch { return {}; }
}

function parameters() {
  try { return JSON.parse(process.env.ATON_READ_PARAMETERS || "{}"); }
  catch { return {}; }
}

function verify(q) {
  const token = process.env.ATON_TOKEN || "";
  const ts = String(q.ts || "");
  const sig = String(q.sig || "");
  const op = String(q.operation || "products");
  const code = String(q.codigo_interno || "");
  if (!token || !ts || !sig || Math.abs(Date.now() - Number(ts)) > 300000) return false;
  const expected = createHmac("sha256", token).update(`${op}\n${ts}\n${code}`).digest("hex");
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return reply(res, 405, { error: "method_not_allowed" });
  if (!verify(req.query || {})) return reply(res, 401, { error: "invalid_signature" });

  const op = String(req.query.operation || "products");
  const path = operations()[op];
  if (!path || !process.env.ATON_BASE_URL || !process.env.ATON_TOKEN) {
    return reply(res, 503, { error: "not_configured" });
  }

  const base = `${process.env.ATON_BASE_URL.replace(/\/$/, "")}/`;
  const url = new URL(path, base);
  const body = {};
  const allowed = parameters()[op] || [];
  if (allowed.includes("codigo_interno") && req.query.codigo_interno) body.codigo_interno = req.query.codigo_interno;
  if (allowed.includes("offset")) body.offset = 0;
  if (allowed.includes("limit")) body.limit = 1;

  const header = process.env.ATON_TOKEN_HEADER || "Authorization";
  const prefix = process.env.ATON_TOKEN_PREFIX ?? "";

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [header]: `${prefix}${process.env.ATON_TOKEN}`,
      },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 3000); }
    return reply(res, 200, {
      upstream_status: upstream.status,
      upstream_host: new URL(upstream.url).host,
      upstream_path: new URL(upstream.url).pathname,
      redirected: upstream.redirected,
      data,
    });
  } catch (error) {
    return reply(res, 502, {
      error: "upstream_exception",
      name: error?.name || null,
      message: error?.message || null,
      cause: error?.cause?.code || error?.cause?.message || null,
    });
  }
}
