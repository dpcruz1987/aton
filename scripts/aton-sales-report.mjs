import fs from 'node:fs';

const BASE = process.env.ATON_INNOVEX_API_BASE || 'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const TOKEN = process.env.ATON_INNOVEX_TOKEN;
const INTEGRADOR = process.env.ATON_INNOVEX_INTEGRADOR || 'ATONAPI';
if (!TOKEN) throw new Error('ATON_INNOVEX_TOKEN não configurado');

const [start, end] = process.argv.slice(2);
if (!/^\d{2}\/\d{2}\/\d{4}$/.test(start || '') || !/^\d{2}\/\d{2}\/\d{4}$/.test(end || '')) {
  throw new Error('Datas devem usar DD/MM/AAAA');
}

const firstArray = value => {
  if (Array.isArray(value) && value.some(v => v && typeof v === 'object')) return value;
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (/pedido|result|data|registro|item/i.test(key)) {
      const found = firstArray(child);
      if (found) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = firstArray(child);
    if (found) return found;
  }
  return null;
};
const get = (obj, names) => {
  for (const name of names) if (obj?.[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
};
const text = v => typeof v === 'string' ? v.trim() : '';
const number = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim().replace(/R\$\s?/g, '');
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const sellerOf = order => {
  const direct = get(order, ['vendedor_nome','nome_vendedor','vendedor','VENDEDOR','representante','usuario_venda']);
  if (typeof direct === 'object') return text(get(direct, ['nome','descricao','name']));
  return text(direct);
};
const totalOf = order => number(get(order, ['valor_total','vlr_total','total_pedido','valor_pedido','total','VLR_TOTAL']));
const idOf = order => String(get(order, ['pedido','numero_pedido','id','codigo','PEDIDO']) ?? JSON.stringify(order).slice(0,160));

const seen = new Set();
const sellers = new Map();
const positions = ['EMITIDO', 'FECHADO'];
let requestCount = 0;

for (const position of positions) {
  for (let offset = 1; offset <= 200; offset++) {
    const body = {tipo_data:'data_pedido', data_inicial:start, data_final:end, posicao:position, offset, limit:50};
    const response = await fetch(`${BASE}/pedidosvenda/consulta`, {
      method:'POST',
      headers:{Accept:'application/json','Content-Type':'application/json',Authorization:TOKEN,Integrador:INTEGRADOR},
      body:JSON.stringify(body),
      redirect:'error',
      signal:AbortSignal.timeout(30000)
    });
    requestCount++;
    const raw = await response.text();
    if (!response.ok) throw new Error(`Aton respondeu HTTP ${response.status}: ${raw.slice(0,300)}`);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('Resposta do Aton não é JSON'); }
    const rows = firstArray(payload) || [];
    for (const order of rows) {
      const key = idOf(order);
      if (seen.has(key)) continue;
      seen.add(key);
      const seller = sellerOf(order) || 'NÃO INFORMADO';
      const current = sellers.get(seller) || {vendedor:seller,pedidos:0,faturamento:0};
      current.pedidos++;
      current.faturamento += totalOf(order);
      sellers.set(seller,current);
    }
    if (rows.length < 50) break;
  }
}

const result = [...sellers.values()]
  .sort((a,b) => b.faturamento-a.faturamento)
  .map((r,i) => ({posicao:i+1,...r,ticket_medio:r.pedidos ? r.faturamento/r.pedidos : 0}));

fs.mkdirSync('output',{recursive:true});
fs.writeFileSync('output/vendas-por-vendedor.json', JSON.stringify({periodo:{inicio:start,fim:end},consultas:requestCount,total_pedidos:seen.size,vendedores:result},null,2));
const csv = ['Posição,Vendedor,Pedidos,Faturamento,Ticket médio', ...result.map(r =>
  [r.posicao, JSON.stringify(r.vendedor), r.pedidos, r.faturamento.toFixed(2), r.ticket_medio.toFixed(2)].join(',')
)].join('\n');
fs.writeFileSync('output/vendas-por-vendedor.csv', csv);

const brl = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const md = [
  '# Vendas por vendedor',
  '',
  `Período: ${start} a ${end}`,
  '',
  '| # | Vendedor | Pedidos | Faturamento | Ticket médio |',
  '|---:|---|---:|---:|---:|',
  ...result.map(r => `| ${r.posicao} | ${r.vendedor.replace(/\|/g,'/')} | ${r.pedidos} | ${brl.format(r.faturamento)} | ${brl.format(r.ticket_medio)} |`)
].join('\n');
fs.writeFileSync('output/resumo.md', md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (!result.length) throw new Error('Nenhum pedido/vendedor encontrado; confira período, posições e formato retornado pela API');
