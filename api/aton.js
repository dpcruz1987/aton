const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const METHODS = new Set(["GET", "POST", "OPTIONS"]);

function reply(res, status, body) {
  for (const [key, value] of Object.entries(JSON_HEADERS)) res.setHeader(key, value);
  return res.status(status).json(body);
}

function configuredOperations() {
  try {
    const parsed = JSON.parse(process.env.ATON_READ_OPERATIONS || "{}");
    return Object.fromEntries(
      Object.entries(parsed).filter(([, path]) =>
        typeof path === "string" && path.startsWith("/") && !path.includes("..")
      )
    );
  } catch {
    return {};
  }
}

function authHeaders() {
  const header = process.env.ATON_TOKEN_HEADER || "Authorization";
  const prefix = process.env.ATON_TOKEN_PREFIX ?? "Bearer ";
  return { [header]: `${prefix}${process.env.ATON_TOKEN}` };
}

function requestPayload(req) {
  if (req.method === "GET") return req.query || {};
  return typeof req.body === "object" && req.body ? req.body : {};
}

export default async function handler(req, res) {
  if (!METHODS.has(req.method)) {
    res.setHeader("allow", "GET, POST, OPTIONS");
    return reply(res, 405, { error: "method_not_allowed" });
  }
  if (req.method === "OPTIONS") return res.status(204).end();

  const payload = requestPayload(req);
  const operation = String(payload.operation || "");
  if (operation === "health") {
    return reply(res, 200, {
      ok: true,
      service: "aton-innovex-readonly",
      configured: Boolean(process.env.ATON_BASE_URL && process.env.ATON_TOKEN),
    });
  }

  const operations = configuredOperations();
  const path = operations[operation];
  if (!path) return reply(res, 404, { error: "operation_not_allowed" });
  if (!process.env.ATON_BASE_URL || !process.env.ATON_TOKEN) {
    return reply(res, 503, { error: "service_not_configured" });
  }

  const upstreamUrl = new URL(path, `${process.env.ATON_BASE_URL.replace(/\/$/, "")}/`);
  const params = payload.params && typeof payload.params === "object" ? payload.params : {};
  for (const [key, value] of Object.entries(params)) {
    if (["string", "number", "boolean"].includes(typeof value)) {
      upstreamUrl.searchParams.set(key, String(value));
    }
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json", ...authHeaders() },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await upstream.json()
      : { data: await upstream.text() };
    return reply(res, upstream.status, data);
  } catch (error) {
    return reply(res, 502, { error: "upstream_unavailable" });
  }
}
