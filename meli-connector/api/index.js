import crypto from "node:crypto";
import { put, get } from "@vercel/blob";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const ACCOUNTS = new Set(["global", "innovex"]);
const API = "https://api.mercadolibre.com";

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ ...JSON_HEADERS, ...headers })) res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signObject(payload, ttlSeconds = 600) {
  const data = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac("sha256", env("MCP_SIGNING_SECRET")).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyObject(token) {
  const [data, sig] = String(token || "").split(".");
  if (!data || !sig) throw new Error("invalid_token");
  const expected = crypto.createHmac("sha256", env("MCP_SIGNING_SECRET")).update(data).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("invalid_token");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired_token");
  return payload;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return JSON.parse(raw);
}

function encrypt(value) {
  const key = Buffer.from(env("TOKEN_ENCRYPTION_KEY"), "hex");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}

function decrypt(value) {
  const box = JSON.parse(value);
  const key = Buffer.from(env("TOKEN_ENCRYPTION_KEY"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
}

async function saveMeliToken(account, token) {
  await put(`meli-tokens/${account}.json.enc`, encrypt({ ...token, saved_at: Date.now() }), {
    access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/octet-stream"
  });
}

async function loadMeliToken(account) {
  if (!ACCOUNTS.has(account)) throw new Error("Invalid account");
  const result = await get(`meli-tokens/${account}.json.enc`, { access: "private" });
  if (!result || result.statusCode === 404 || !result.stream) throw new Error(`Account ${account} is not connected`);
  return decrypt(await new Response(result.stream).text());
}

async function refreshMeli(account, token) {
  if (token.expires_at && token.expires_at > Date.now() + 120000) return token;
  const form = new URLSearchParams({
    grant_type: "refresh_token", client_id: env("MELI_CLIENT_ID"), client_secret: env("MELI_CLIENT_SECRET"), refresh_token: token.refresh_token
  });
  const response = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const next = await response.json();
  if (!response.ok) throw new Error(`Mercado Livre OAuth refresh failed (${response.status})`);
  const merged = { ...token, ...next, expires_at: Date.now() + Number(next.expires_in || 21600) * 1000 };
  await saveMeliToken(account, merged);
  return merged;
}

async function meliRequest(account, method, path, body) {
  let token = await loadMeliToken(account);
  token = await refreshMeli(account, token);
  const normalized = String(path || "");
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("..")) throw new Error("Invalid API path");
  const options = { method, headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" } };
  if (body !== undefined) { options.headers["content-type"] = "application/json"; options.body = JSON.stringify(body); }
  const response = await fetch(`${API}${normalized}`, options);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 4000) }; }
  if (!response.ok) return { ok: false, status: response.status, error: data };
  return { ok: true, status: response.status, data };
}

const tools = [
  { name: "meli_account_status", description: "Use this when you need to identify the connected Mercado Livre seller account and its classifications.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] } }, required: ["account"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "meli_shipping_status", description: "Use this when you need the seller shipping preferences and logistics modes, including evidence related to Coleta/cross_docking eligibility.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] } }, required: ["account"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "meli_item_get", description: "Use this when you need the current authoritative Mercado Livre data for one listing.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] }, item_id: { type: "string", pattern: "^MLB[0-9]+$" } }, required: ["account", "item_id"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "meli_api_get", description: "Use this when a specific read-only Mercado Livre API endpoint is required and no narrower tool covers it.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] }, path: { type: "string", pattern: "^/" } }, required: ["account", "path"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "meli_item_update", description: "Use this when the user explicitly asks to update a Mercado Livre listing. Sends a PUT only to /items/MLB... and returns the API response.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] }, item_id: { type: "string", pattern: "^MLB[0-9]+$" }, changes: { type: "object" } }, required: ["account", "item_id", "changes"] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
  { name: "meli_api_mutate", description: "Use this only when the user explicitly requests a Mercado Livre API mutation not covered by a narrower tool. Never guess the endpoint or payload; validate first with official documentation or a prior GET.", inputSchema: { type: "object", properties: { account: { enum: ["global", "innovex"] }, method: { enum: ["POST", "PUT", "PATCH", "DELETE"] }, path: { type: "string", pattern: "^/" }, body: { type: "object" } }, required: ["account", "method", "path"] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
];

async function callTool(name, args) {
  const account = args?.account;
  if (!ACCOUNTS.has(account)) throw new Error("Invalid account");
  if (name === "meli_account_status") return meliRequest(account, "GET", "/users/me");
  if (name === "meli_shipping_status") {
    const me = await meliRequest(account, "GET", "/users/me");
    if (!me.ok) return me;
    const id = me.data.id;
    const prefs = await meliRequest(account, "GET", `/users/${id}/shipping_preferences`);
    return { account: me, shipping_preferences: prefs };
  }
  if (name === "meli_item_get") return meliRequest(account, "GET", `/items/${args.item_id}`);
  if (name === "meli_api_get") return meliRequest(account, "GET", args.path);
  if (name === "meli_item_update") return meliRequest(account, "PUT", `/items/${args.item_id}`, args.changes);
  if (name === "meli_api_mutate") return meliRequest(account, args.method, args.path, args.body);
  throw new Error("Unknown tool");
}

function bearer(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { const p = verifyObject(match[1]); return p.kind === "access" && p.aud === env("APP_BASE_URL") ? p : null; } catch { return null; }
}

async function handleMcp(req, res) {
  if (!bearer(req)) return send(res, 401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${env("APP_BASE_URL")}/.well-known/oauth-protected-resource", scope="meli:read meli:write"` });
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
  const body = await readBody(req);
  const base = { jsonrpc: "2.0", id: body.id ?? null };
  if (body.method === "initialize") return send(res, 200, { ...base, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Mercado Livre Global", version: "1.0.0" } } });
  if (body.method === "notifications/initialized") return send(res, 202, "");
  if (body.method === "tools/list") return send(res, 200, { ...base, result: { tools } });
  if (body.method === "tools/call") {
    try {
      const result = await callTool(body.params?.name, body.params?.arguments || {});
      return send(res, 200, { ...base, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: result?.ok === false } });
    } catch (error) {
      return send(res, 200, { ...base, result: { content: [{ type: "text", text: error.message }], isError: true } });
    }
  }
  if (body.method === "ping") return send(res, 200, { ...base, result: {} });
  return send(res, 200, { ...base, error: { code: -32601, message: "Method not found" } });
}

function authorizationPage(query, message = "") {
  const fields = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "resource", "scope"]
    .map(k => `<input type="hidden" name="${k}" value="${String(query[k] || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Conectar Mercado Livre</title><style>body{font:16px system-ui;max-width:440px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0}button{background:#111;color:#fff;border:0;border-radius:8px}</style><h1>Conector Mercado Livre</h1><p>Autorize o ChatGPT a acessar somente as contas configuradas neste conector.</p>${message ? `<p style="color:#b00020">${message}</p>` : ""}<form method="post" action="/oauth/authorize">${fields}<label>Senha privada do conector</label><input name="password" type="password" autocomplete="current-password" required><button>Autorizar ChatGPT</button></form>`;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, env("APP_BASE_URL"));
    const path = url.pathname;
    if (path === "/health") return send(res, 200, { ok: true, service: "meli-mcp" });
    if (path === "/.well-known/oauth-protected-resource") return send(res, 200, { resource: env("APP_BASE_URL"), authorization_servers: [env("APP_BASE_URL")], scopes_supported: ["meli:read", "meli:write"] });
    if (path === "/.well-known/oauth-authorization-server") return send(res, 200, { issuer: env("APP_BASE_URL"), authorization_endpoint: `${env("APP_BASE_URL")}/oauth/authorize`, token_endpoint: `${env("APP_BASE_URL")}/oauth/token`, registration_endpoint: `${env("APP_BASE_URL")}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["meli:read", "meli:write"] });
    if (path === "/oauth/register" && req.method === "POST") {
      const body = await readBody(req); const redirects = body.redirect_uris || [];
      if (!Array.isArray(redirects) || !redirects.every(x => String(x).startsWith("https://chatgpt.com/"))) return send(res, 400, { error: "invalid_redirect_uri" });
      return send(res, 201, { client_id: signObject({ kind: "client", redirect_uris: redirects }, 315360000), client_id_issued_at: Math.floor(Date.now()/1000), token_endpoint_auth_method: "none", redirect_uris: redirects });
    }
    if (path === "/oauth/authorize" && req.method === "GET") { res.statusCode = 200; res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(authorizationPage(Object.fromEntries(url.searchParams))); }
    if (path === "/oauth/authorize" && req.method === "POST") {
      const body = await readBody(req); let client;
      try { client = verifyObject(body.client_id); } catch { return send(res, 400, { error: "invalid_client" }); }
      if (client.kind !== "client" || !client.redirect_uris.includes(body.redirect_uri) || body.code_challenge_method !== "S256") return send(res, 400, { error: "invalid_request" });
      if (!safeEqualHex(sha256(body.password || ""), env("MCP_PASSWORD_HASH"))) { res.statusCode = 401; res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(authorizationPage(body, "Senha incorreta.")); }
      const code = signObject({ kind: "code", client_id: body.client_id, redirect_uri: body.redirect_uri, code_challenge: body.code_challenge, resource: body.resource || env("APP_BASE_URL"), scope: body.scope || "meli:read meli:write", nonce: crypto.randomUUID() }, 300);
      const redirect = new URL(body.redirect_uri); redirect.searchParams.set("code", code); if (body.state) redirect.searchParams.set("state", body.state); return res.redirect(302, redirect.toString());
    }
    if (path === "/oauth/token" && req.method === "POST") {
      const body = await readBody(req);
      if (body.grant_type === "authorization_code") {
        let code; try { code = verifyObject(body.code); } catch { return send(res, 400, { error: "invalid_grant" }); }
        const challenge = crypto.createHash("sha256").update(body.code_verifier || "").digest("base64url");
        if (code.kind !== "code" || code.client_id !== body.client_id || code.redirect_uri !== body.redirect_uri || challenge !== code.code_challenge) return send(res, 400, { error: "invalid_grant" });
        return send(res, 200, { access_token: signObject({ kind: "access", aud: code.resource, scope: code.scope }, 3600), token_type: "Bearer", expires_in: 3600, refresh_token: signObject({ kind: "refresh", aud: code.resource, scope: code.scope }, 2592000), scope: code.scope });
      }
      if (body.grant_type === "refresh_token") { let rt; try { rt = verifyObject(body.refresh_token); } catch { return send(res, 400, { error: "invalid_grant" }); } if (rt.kind !== "refresh") return send(res, 400, { error: "invalid_grant" }); return send(res, 200, { access_token: signObject({ kind: "access", aud: rt.aud, scope: rt.scope }, 3600), token_type: "Bearer", expires_in: 3600, refresh_token: signObject({ kind: "refresh", aud: rt.aud, scope: rt.scope }, 2592000), scope: rt.scope }); }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/meli/connect" && req.method === "GET") {
      const account = url.searchParams.get("account"); if (!ACCOUNTS.has(account)) return send(res, 400, { error: "invalid_account" });
      const state = signObject({ kind: "meli_oauth", account }, 900);
      const redirect = new URL("https://auth.mercadolivre.com.br/authorization"); redirect.searchParams.set("response_type", "code"); redirect.searchParams.set("client_id", env("MELI_CLIENT_ID")); redirect.searchParams.set("redirect_uri", `${env("APP_BASE_URL")}/meli/callback`); redirect.searchParams.set("state", state); return res.redirect(302, redirect.toString());
    }
    if (path === "/meli/callback" && req.method === "GET") {
      let state; try { state = verifyObject(url.searchParams.get("state")); } catch { return send(res, 400, { error: "invalid_state" }); }
      if (state.kind !== "meli_oauth" || !ACCOUNTS.has(state.account) || !url.searchParams.get("code")) return send(res, 400, { error: "invalid_callback" });
      const form = new URLSearchParams({ grant_type: "authorization_code", client_id: env("MELI_CLIENT_ID"), client_secret: env("MELI_CLIENT_SECRET"), code: url.searchParams.get("code"), redirect_uri: `${env("APP_BASE_URL")}/meli/callback` });
      const response = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form }); const token = await response.json(); if (!response.ok) return send(res, 400, { error: "meli_oauth_failed", status: response.status });
      await saveMeliToken(state.account, { ...token, expires_at: Date.now() + Number(token.expires_in || 21600) * 1000 });
      const me = await meliRequest(state.account, "GET", "/users/me"); res.statusCode = 200; res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(`<!doctype html><meta charset="utf-8"><h1>Conta conectada</h1><p>${state.account} vinculada com sucesso ao usuário Mercado Livre ${me?.data?.id || "confirmado"}.</p><p>Você pode fechar esta janela.</p>`);
    }
    if (path === "/mcp") return handleMcp(req, res);
    return send(res, 404, { error: "not_found" });
  } catch (error) { console.error(error.message); return send(res, 500, { error: "internal_error" }); }
}
