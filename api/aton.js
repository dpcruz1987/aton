import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

const MCP_PROTOCOL_VERSION = "2025-06-18";
const METHODS = new Set(["GET", "POST", "OPTIONS"]);
const SIGNED_READ_TTL_MS = 5 * 60 * 1000;
const VERCEL_OIDC_ISSUER = "https://oidc.vercel.com/bestshoplojaonline-3453s-projects";
const VERCEL_OIDC_AUDIENCE = "https://vercel.com/bestshoplojaonline-3453s-projects";
const VERCEL_OIDC_SUBJECT = "owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production";
let oidcJwksPromise;

function setHeaders(res) {
  for (const [key, value] of Object.entries(JSON_HEADERS)) res.setHeader(key, value);
}

function reply(res, status, body) {
  setHeaders(res);
  return res.status(status).json(body);
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

export function configuredOperations() {
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

export function configuredParameters() {
  try {
    const parsed = JSON.parse(process.env.ATON_READ_PARAMETERS || "{}");
    return Object.fromEntries(
      Object.entries(parsed).map(([operation, names]) => [
        operation,
        Array.isArray(names) ? names.filter((name) => typeof name === "string") : [],
      ])
    );
  } catch {
    return {};
  }
}

function upstreamAuthHeaders() {
  const header = process.env.ATON_TOKEN_HEADER || "Authorization";
  const prefix = process.env.ATON_TOKEN_PREFIX ?? "";
  return { [header]: `${prefix}${process.env.ATON_TOKEN}` };
}

function isAuthorized(req) {
  const expected = process.env.ATON_CONNECTOR_TOKEN;
  if (!expected) return false;
  const header = String(req.headers?.authorization || "");
  return header === `Bearer ${expected}`;
}

async function getOidcJwks() {
  if (!oidcJwksPromise) {
    oidcJwksPromise = (async () => {
      const discovery = await fetch(`${VERCEL_OIDC_ISSUER}/.well-known/openid-configuration`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!discovery.ok) throw new Error("oidc_discovery_failed");
      const config = await discovery.json();
      if (!config?.jwks_uri) throw new Error("oidc_jwks_missing");
      return createRemoteJWKSet(new URL(config.jwks_uri));
    })();
  }
  return oidcJwksPromise;
}

async function isVercelOidcAuthorized(req) {
  const token = String(req.headers?.["x-vercel-oidc-token"] || "");
  if (!token) return false;
  try {
    const jwks = await getOidcJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: VERCEL_OIDC_ISSUER,
      audience: VERCEL_OIDC_AUDIENCE,
    });
    return payload.sub === VERCEL_OIDC_SUBJECT &&
      payload.project === "aton-innovex-readonly" &&
      payload.environment === "production";
  } catch {
    return false;
  }
}

function requestPayload(req) {
  if (req.method === "GET") return req.query || {};
  return typeof req.body === "object" && req.body ? req.body : {};
}

function tokenFingerprint() {
  if (!process.env.ATON_TOKEN) return null;
  return createHash("sha256").update(process.env.ATON_TOKEN).digest("hex").slice(0, 16);
}

function upstreamHost() {
  try {
    return new URL(process.env.ATON_BASE_URL).host;
  } catch {
    return null;
  }
}

function canonicalSignedRead(payload) {
  const operation = String(payload.operation || "");
  const ts = String(payload.ts || "");
  const allowed = configuredParameters()[operation] || [];
  const entries = [];
  for (const name of allowed) {
    if (payload[name] !== undefined && payload[name] !== null) {
      entries.push([name, String(payload[name])]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return [operation, ts, ...entries.map(([k, v]) => `${k}=${v}`)].join("\n");
}

function verifySignedRead(payload) {
  const token = process.env.ATON_TOKEN;
  const signature = String(payload.sig || "");
  const ts = Number(payload.ts);
  if (!token || !signature || !Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > SIGNED_READ_TTL_MS) return false;

  const canonical = canonicalSignedRead(payload);
  const expected = createHmac("sha256", token).update(canonical).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
}

function readParams(payload) {
  const operation = String(payload.operation || "");
  const allowed = configuredParameters()[operation] || [];
  return Object.fromEntries(
    allowed
      .filter((name) => payload[name] !== undefined && payload[name] !== null)
      .map((name) => [name, payload[name]])
  );
}

function healthPayload() {
  const operations = configuredOperations();
  const parameters = configuredParameters();
  return {
    ok: true,
    service: "aton-readonly",
    mcp: true,
    configured: Boolean(
      process.env.ATON_BASE_URL &&
      process.env.ATON_TOKEN &&
      process.env.ATON_CONNECTOR_TOKEN &&
      Object.keys(operations).length
    ),
    upstream_host: upstreamHost(),
    token_fingerprint: tokenFingerprint(),
    signed_reads: true,
    vercel_oidc_reads: true,
    signed_read_ttl_seconds: SIGNED_READ_TTL_MS / 1000,
    operations: Object.keys(operations),
    parameters,
  };
}

async function queryAton(operation, params = {}) {
  const path = configuredOperations()[operation];
  if (!path) return { status: 404, data: { error: "operation_not_allowed" } };
  if (!process.env.ATON_BASE_URL || !process.env.ATON_TOKEN) {
    return { status: 503, data: { error: "service_not_configured" } };
  }

  const upstreamUrl = new URL(path, `${process.env.ATON_BASE_URL.replace(/\/$/, "")}/`);
  const allowedParameters = configuredParameters()[operation] || [];
  const upstreamBody = {};
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (allowedParameters.includes(key) && ["string", "number", "boolean"].includes(typeof value)) {
        upstreamBody[key] = value;
      }
    }
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...upstreamAuthHeaders(),
      },
      body: JSON.stringify(upstreamBody),
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await upstream.json()
      : { data: await upstream.text() };
    return { status: upstream.status, data };
  } catch {
    return { status: 502, data: { error: "upstream_unavailable" } };
  }
}

function mcpTools() {
  const parameters = configuredParameters();
  return Object.keys(configuredOperations()).map((name) => ({
    name,
    title: `Consultar ATON: ${name}`,
    description: `Use esta ferramenta para executar a consulta somente leitura “${name}” no ATON.`,
    inputSchema: {
      type: "object",
      properties: {
        params: {
          type: "object",
          description: "Parâmetros da consulta enviados ao ATON.",
          properties: Object.fromEntries(
            (parameters[name] || []).map((parameter) => [
              parameter,
              { type: ["string", "number", "boolean"] },
            ])
          ),
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

async function handleMcp(payload) {
  const id = payload.id;
  switch (payload.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aton-readonly", version: "2.2.0" },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
    case "tools/call": {
      const name = String(payload.params?.name || "");
      const params = payload.params?.arguments?.params || {};
      const result = await queryAton(name, params);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result.data) }],
        isError: result.status < 200 || result.status >= 300,
      });
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

export default async function handler(req, res) {
  if (!METHODS.has(req.method)) {
    res.setHeader("allow", "GET, POST, OPTIONS");
    return reply(res, 405, { error: "method_not_allowed" });
  }
  if (req.method === "OPTIONS") {
    setHeaders(res);
    return res.status(204).end();
  }

  const payload = requestPayload(req);
  if (String(payload.operation || "") === "health") return reply(res, 200, healthPayload());

  if (req.method === "GET" && await isVercelOidcAuthorized(req)) {
    const operation = String(payload.operation || "");
    const result = await queryAton(operation, readParams(payload));
    return reply(res, result.status, result.data);
  }

  if (req.method === "GET" && payload.sig && payload.ts) {
    if (!verifySignedRead(payload)) return reply(res, 401, { error: "invalid_or_expired_signature" });
    const operation = String(payload.operation || "");
    const result = await queryAton(operation, readParams(payload));
    return reply(res, result.status, result.data);
  }

  if (!process.env.ATON_CONNECTOR_TOKEN) {
    return reply(res, 503, { error: "connector_auth_not_configured" });
  }
  if (!isAuthorized(req)) return reply(res, 401, { error: "unauthorized" });

  if (payload.jsonrpc === "2.0" && typeof payload.method === "string") {
    const result = await handleMcp(payload);
    if (result === null) {
      setHeaders(res);
      return res.status(204).end();
    }
    return reply(res, 200, result);
  }

  const operation = String(payload.operation || "");
  const result = await queryAton(operation, payload.params);
  return reply(res, result.status, result.data);
}
