import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp/";
const MCP_PROTOCOL_VERSION = "2025-06-18";

function reply(res, status, body) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization, content-type, mcp-protocol-version");
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
function connectorAuthorized(req) {
  const expected = process.env.ATON_CONNECTOR_TOKEN || "";
  return expected && String(req.headers?.authorization || "") === `Bearer ${expected}`;
}
function canonical(operation, ts, params) {
  const entries = Object.entries(params || {}).map(([k,v]) => [k,String(v)]).sort(([a],[b]) => a.localeCompare(b));
  return [operation, String(ts), ...entries.map(([k,v]) => `${k}=${v}`)].join("\n");
}
function signedAuthorized(operation, ts, params, sig) {
  const token = process.env.ATON_TOKEN || "";
  if (!token || !sig || !Number.isFinite(Number(ts)) || Math.abs(Date.now() - Number(ts)) > 300000) return false;
  const expected = createHmac("sha256", token).update(canonical(operation, ts, params)).digest("hex");
  return expected.length === String(sig).length && timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
}
function cleanParams(operation, source) {
  const allowed = parameters()[operation] || [];
  const out = {};
  for (const key of allowed) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}
async function query(operation, params = {}) {
  const path = operations()[operation];
  if (!path) return { status: 404, data: { error: "operation_not_allowed" } };
  if (!process.env.ATON_TOKEN) return { status: 503, data: { error: "token_not_configured" } };
  const url = new URL(path.replace(/^\/+/, ""), BASE_URL);
  const header = process.env.ATON_TOKEN_HEADER || "Authorization";
  const prefix = process.env.ATON_TOKEN_PREFIX ?? "";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", [header]: `${prefix}${process.env.ATON_TOKEN}` },
      body: JSON.stringify(params),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await r.json() : { data: await r.text() };
    return { status: r.status, data };
  } catch (e) {
    return { status: 502, data: { error: "upstream_unavailable", cause: e?.cause?.code || e?.name || null } };
  }
}
function tools() {
  const p = parameters();
  return Object.keys(operations()).map((name) => ({
    name,
    title: `ATON GLOBAL: ${name}`,
    description: `Consulta somente leitura no ATON da GLOBAL: ${name}`,
    inputSchema: { type: "object", properties: { params: { type: "object", properties: Object.fromEntries((p[name] || []).map(k => [k,{type:["string","number","boolean"]}])), additionalProperties:false } }, additionalProperties:false },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false }
  }));
}
async function mcp(payload) {
  const id = payload.id;
  if (payload.method === "initialize") return { jsonrpc:"2.0", id, result:{ protocolVersion:MCP_PROTOCOL_VERSION, capabilities:{tools:{listChanged:false}}, serverInfo:{name:"aton-global-readonly",version:"1.0.0"} } };
  if (payload.method === "notifications/initialized") return null;
  if (payload.method === "ping") return { jsonrpc:"2.0", id, result:{} };
  if (payload.method === "tools/list") return { jsonrpc:"2.0", id, result:{tools:tools()} };
  if (payload.method === "tools/call") {
    const name = String(payload.params?.name || "");
    const result = await query(name, cleanParams(name, payload.params?.arguments?.params || {}));
    return { jsonrpc:"2.0", id, result:{content:[{type:"text",text:JSON.stringify(result.data)}],isError:result.status<200||result.status>=300} };
  }
  return { jsonrpc:"2.0", id:id ?? null, error:{code:-32601,message:"Method not found"} };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method === "GET") {
    const operation = String(req.query?.operation || "health");
    if (operation === "health") return reply(res, 200, { ok:true, service:"aton-global-readonly", base_host:new URL(BASE_URL).host, base_path:new URL(BASE_URL).pathname, configured:Boolean(process.env.ATON_TOKEN), operations:Object.keys(operations()) });
    const params = cleanParams(operation, req.query || {});
    if (!signedAuthorized(operation, req.query?.ts, params, req.query?.sig)) return reply(res, 401, {error:"invalid_signature"});
    const result = await query(operation, params);
    return reply(res, result.status, result.data);
  }
  if (req.method !== "POST") return reply(res, 405, {error:"method_not_allowed"});
  if (!connectorAuthorized(req)) return reply(res, 401, {error:"unauthorized"});
  const payload = typeof req.body === "object" && req.body ? req.body : {};
  if (payload.jsonrpc === "2.0") {
    const result = await mcp(payload);
    if (result === null) { res.status(204).end(); return; }
    return reply(res, 200, result);
  }
  const operation = String(payload.operation || "");
  const result = await query(operation, cleanParams(operation, payload.params || {}));
  return reply(res, result.status, result.data);
}
