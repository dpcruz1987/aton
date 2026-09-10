import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.ATON_INNOVEX_API_BASE || "https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp";
const TOKEN = process.env.ATON_INNOVEX_TOKEN;
const INTEGRADOR = process.env.ATON_INNOVEX_INTEGRADOR || "ATONAPI";
if (!TOKEN) throw new Error("ATON_INNOVEX_TOKEN ausente");

const now = new Date();
const recifeParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Recife", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
const defaultStart = `01/${recifeParts.month}/${recifeParts.year}`;
const defaultEnd = `${recifeParts.day}/${recifeParts.month}/${recifeParts.year}`;
const START = process.env.DATA_INICIAL || defaultStart;
const END = process.env.DATA_FINAL || defaultEnd;

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: TOKEN,
  Integrador: INTEGRADOR,
};

async function call(body) {
  const response = await fetch(`${BASE}/pedidosvenda/consulta`, {
    method: "POST", headers, body: JSON.stringify(body), redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`API respondeu HTTP ${response.status}`);
  try { return JSON.parse(text); } catch { throw new Error("API retornou JSON inválido"); }
}

function arrays(value, output = []) {
  if (Array.isArray(value)) {
    const rows = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (rows.length) output.push(rows);
    for (const item of value) arrays(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) arrays(item, output);
  }
  return output;
}
function score(rows) {
  const keys = [...new Set(rows.slice(0, 4).flatMap(Object.keys))];
  return (keys.some((key) => /pedido/i.test(key)) ? 8 : 0) + (keys.some((key) => /total/i.test(key)) ? 5 : 0);
}
function responseRows(payload) {
  const candidates = arrays(payload);
  candidates.sort((a, b) => score(b) - score(a) || b.length - a.length);
  return candidates[0] || [];
}
function first(object, names) {
  for (const name of names) if (object?.[name] !== undefined && object[name] !== null && object[name] !== "") return object[name];
}
function moneyToCents(value) {
  if (typeof value === "number") return Math.round(value * 100);
  if (typeof value !== "string") return 0;
  const cleaned = value.includes(",") ? value.replaceAll(".", "").replace(",", ".") : value.replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
function findXml(value, output = []) {
  if (Array.isArray(value)) for (const item of value) findXml(item, output);
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "xml" && typeof item === "string") output.push(item);
    else findXml(item, output);
  }
  return output;
}
function cleanXmlText(value) {
  return String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").trim();
}
function normalizeSeller(value) {
  return cleanXmlText(value).replace(/\s+NOSSO PEDIDO(?:.*)?$/i, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function sellerFromXml(xml) {
  const matches = [];
  const regex = /<(?:[A-Za-z0-9_]+:)?obsCont\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?obsCont>/gi;
  let match;
  while ((match = regex.exec(xml))) {
    const attribute = /xCampo\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    const child = /<(?:[A-Za-z0-9_]+:)?xCampo>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?xCampo>/i.exec(match[2])?.[1];
    const label = cleanXmlText(attribute || child);
    if (label.toUpperCase() !== "VENDEDOR") continue;
    const textMatch = /<(?:[A-Za-z0-9_]+:)?xTexto>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?xTexto>/i.exec(match[2]);
    const seller = normalizeSeller(textMatch?.[1]);
    if (seller) matches.push(seller);
  }
  if (!matches.length) {
    const fallback = /(?:vendedor|representante|consultor|atendente|comercial)\s*[:=\-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,60})/gi;
    while ((match = fallback.exec(xml))) {
      const seller = normalizeSeller(cleanXmlText(match[1]).split(/[;<]/)[0]);
      if (seller) matches.push(seller);
    }
  }
  return [...new Set(matches)];
}
function isoDate(value) {
  const text = String(value || "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return text.slice(0, 10);
}

const orders = new Map();
const positions = ["EMITIDO", "FECHADO"];
for (const posicao of positions) {
  for (let offset = 1; offset <= 10_000; offset++) {
    const payload = await call({
      tipo_data: "data_pedido", data_inicial: START, data_final: END,
      posicao, offset, limit: 50,
    });
    const rows = responseRows(payload);
    for (const order of rows) {
      const number = String(first(order, ["pedido", "numero_pedido", "id", "codigo", "PEDIDO"]) || "").trim();
      if (number && !orders.has(number)) orders.set(number, order);
    }
    if (rows.length < 50) break;
    if (offset === 10_000) throw new Error("Limite de paginação excedido");
  }
}

const acceptedOrders = [];
let sellerMissing = 0;
let sellerConflicts = 0;
for (const [number, order] of orders) {
  const sellers = [...new Set(findXml(order).flatMap(sellerFromXml))];
  if (!sellers.length) { sellerMissing++; continue; }
  if (sellers.length !== 1) { sellerConflicts++; continue; }
  acceptedOrders.push({
    number,
    vendedor: sellers[0],
    data: isoDate(first(order, ["data_pedido", "data", "DATA_PEDIDO"])),
    faturamento_centavos: moneyToCents(first(order, ["total_pedido", "valor_total", "vlr_total", "valor_pedido", "total", "VLR_TOTAL"])),
  });
}

const summary = new Map();
const daily = new Map();
for (const order of acceptedOrders) {
  const tipo = order.vendedor === "MERCADO LIVRE" ? "Canal" : "Equipe";
  const summaryRow = summary.get(order.vendedor) || { vendedor: order.vendedor, pedidos: 0, faturamento_centavos: 0, tipo };
  summaryRow.pedidos++;
  summaryRow.faturamento_centavos += order.faturamento_centavos;
  summary.set(order.vendedor, summaryRow);
  const key = `${order.data}|${order.vendedor}`;
  const dailyRow = daily.get(key) || { data: order.data, vendedor: order.vendedor, pedidos: 0, faturamento_centavos: 0, tipo };
  dailyRow.pedidos++;
  dailyRow.faturamento_centavos += order.faturamento_centavos;
  daily.set(key, dailyRow);
}

const seller_summary = [...summary.values()].map((row) => ({
  vendedor: row.vendedor,
  pedidos: row.pedidos,
  faturamento: row.faturamento_centavos / 100,
  ticket_medio: Math.round(row.faturamento_centavos / row.pedidos) / 100,
  comissao_estimada: row.tipo === "Equipe" ? Math.round(row.faturamento_centavos * 0.01) / 100 : null,
  tipo: row.tipo,
})).sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR"));
const seller_daily = [...daily.values()].map((row) => ({
  data: row.data,
  vendedor: row.vendedor,
  pedidos: row.pedidos,
  faturamento: row.faturamento_centavos / 100,
  tipo: row.tipo,
})).sort((a, b) => a.data.localeCompare(b.data) || a.vendedor.localeCompare(b.vendedor, "pt-BR"));

const canonical = { seller_summary, seller_daily };
const signature = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
const syncedAt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Recife", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(now).replace(" ", "T") + "-03:00";
const result = {
  schema_version: 1,
  signature,
  synced_at: syncedAt,
  timezone: "America/Recife",
  periodo: { inicio: START, fim: END },
  positions,
  quality: {
    total_pedidos_unicos: orders.size,
    pedidos_agregados: acceptedOrders.length,
    pedidos_sem_vendedor: sellerMissing,
    pedidos_com_conflito: sellerConflicts,
  },
  canonical,
};

fs.mkdirSync("output-nfe-seller", { recursive: true });
fs.writeFileSync("output-nfe-seller/payload-canonico.json", JSON.stringify(result, null, 2));
const total = seller_summary.reduce((sum, row) => sum + row.faturamento, 0);
const markdown = [
  "# Sincronização de vendas por vendedor", "",
  `Período: ${START} a ${END}`,
  `Pedidos únicos: ${orders.size}`,
  `Pedidos agregados: ${acceptedOrders.length}`,
  `Assinatura: ${signature}`,
  `Faturamento agregado: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total)}`,
].join("\n");
fs.writeFileSync("output-nfe-seller/resumo.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
