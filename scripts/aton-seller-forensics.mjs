import fs from 'node:fs';

const BASE=process.env.ATON_INNOVEX_API_BASE||'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const TOKEN=process.env.ATON_INNOVEX_TOKEN;
const INTEGRADOR=process.env.ATON_INNOVEX_INTEGRADOR||'ATONAPI';
const START=process.env.DATA_INICIAL||'01/09/2026';
const END=process.env.DATA_FINAL||'10/09/2026';
if(!TOKEN)throw new Error('ATON_INNOVEX_TOKEN ausente');
const headers={Accept:'application/json','Content-Type':'application/json',Authorization:TOKEN,Integrador:INTEGRADOR};

async function call(path,body){
  const r=await fetch(BASE+path,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  const raw=await r.text();
  if(!r.ok)throw new Error('HTTP '+r.status);
  try{return JSON.parse(raw)}catch{throw new Error('JSON inválido')}
}
function arrays(v,out=[]){if(Array.isArray(v)){const rows=v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));if(rows.length)out.push(rows);for(const x of v)arrays(x,out)}else if(v&&typeof v==='object')for(const x of Object.values(v))arrays(x,out);return out}
function score(rows){const keys=[...new Set(rows.slice(0,4).flatMap(Object.keys))];return(keys.some(k=>/pedido|ordem|numero/i.test(k))?8:0)+(keys.some(k=>/total|valor/i.test(k))?5:0)-(keys.some(k=>/produto|quantidade|codid/i.test(k))?5:0)}
function orderRows(p){const all=arrays(p);all.sort((a,b)=>score(b)-score(a)||b.length-a.length);return all[0]||[]}
function get(o,names){for(const n of names)if(o?.[n]!==undefined&&o[n]!==null&&o[n]!=='')return o[n]}
function num(v){if(typeof v==='number')return v;if(typeof v!=='string')return 0;const s=v.includes(',')?v.replaceAll('.','').replace(',','.'):v.replace(/[^0-9.-]/g,'');const n=Number(s);return Number.isFinite(n)?n:0}
function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
const sellers=['Josi','Dani','Gabriel','Livia','Alexandra','Emerson'];
const candidateKey=/vend|represent|consult|atend|operad|comercial|funcion|colabor|respons|usuario|user|login|emissor|emitido_por|criado_por|cod.*rep|cod.*ven|id.*rep|id.*ven/i;
const invoiceKey=/nota[_ ]?fiscal|numero[_ ]?nota|^nfe$|^nf$/i;
const excludedValue=/email|fone|telefone|celular|cpf|cnpj|endereco|destinat|cliente|razao|cep|bairro|cidade/i;

const stats={periodo:{ok:0,fail:0},detalhe:{ok:0,fail:0},logistica:{ok:0,fail:0},financeiro_pedido:{ok:0,fail:0},financeiro_nota:{ok:0,fail:0}};
const fields=new Map(),candidateIds=new Map();
function inspect(v,source,pedido,path='root',hits=[],invoices=new Set()){
  if(Array.isArray(v)){for(const x of v)inspect(x,source,pedido,path+'[]',hits,invoices);return {hits,invoices}}
  if(!v||typeof v!=='object')return {hits,invoices};
  for(const [k,x] of Object.entries(v)){
    const q=path+'.'+k;
    const f=fields.get(source+'|'+q)||{source,path:q,count:0,types:new Set()};f.count++;f.types.add(Array.isArray(x)?'array':x===null?'null':typeof x);fields.set(source+'|'+q,f);
    if(invoiceKey.test(k)&&(typeof x==='string'||typeof x==='number')&&String(x).trim())invoices.add(String(x).trim());
    if(candidateKey.test(k)){
      const c=candidateIds.get(source+'|'+q)||{source,path:q,count:0,numeric_values:new Set()};c.count++;
      if(!excludedValue.test(q)&&(typeof x==='number'||(typeof x==='string'&&/^\d+$/.test(x.trim()))))c.numeric_values.add(String(x));
      candidateIds.set(source+'|'+q,c);
    }
    if(typeof x==='string'){
      const n=norm(x);
      for(const seller of sellers)if(new RegExp('(^|[^a-z])'+norm(seller)+'([^a-z]|$)').test(n))hits.push({pedido,seller,path:q,source});
    }
    inspect(x,source,pedido,q,hits,invoices);
  }
  return {hits,invoices};
}
const byId=new Map();
for(const posicao of ['EMITIDO','FECHADO'])for(let offset=1;offset<=200;offset++){
  try{
    const p=await call('/pedidosvenda/consulta',{tipo_data:'data_pedido',data_inicial:START,data_final:END,posicao,offset,limit:50});stats.periodo.ok++;
    const rows=orderRows(p);for(const o of rows){const id=String(get(o,['pedido','numero_pedido','id','codigo','PEDIDO'])||'');if(id&&!byId.has(id))byId.set(id,o)}
    if(rows.length<50)break;
  }catch{stats.periodo.fail++;break}
}
const sellerHits=[];const orderData=[];
for(const [pedido,summary] of byId){
  const id=/^\d+$/.test(pedido)?Number(pedido):pedido;
  const sources=[['periodo',summary]];const invoices=new Set();
  for(const [source,path,body] of [
    ['detalhe','/pedidosvenda/consulta',{pedido:id}],
    ['logistica','/logistica/pedidos',{pedido:id}],
    ['financeiro_pedido','/financeiro/consultacontasreceber',{pedido:id}]
  ]){try{const p=await call(path,body);stats[source].ok++;sources.push([source,p])}catch{stats[source].fail++}}
  for(const [source,payload] of sources){const r=inspect(payload,source,pedido);for(const x of r.hits)sellerHits.push(x);for(const x of r.invoices)invoices.add(x)}
  for(const nota of [...invoices].slice(0,5)){try{const p=await call('/financeiro/consultacontasreceber',{nota_fiscal:/^\d+$/.test(nota)?Number(nota):nota});stats.financeiro_nota.ok++;const r=inspect(p,'financeiro_nota',pedido);sellerHits.push(...r.hits)}catch{stats.financeiro_nota.fail++}}
  orderData.push({pedido,total:num(get(summary,['total_pedido','valor_total','vlr_total','valor_pedido','total','VLR_TOTAL']))});
}
const perOrder=new Map();for(const h of sellerHits){const row=perOrder.get(h.pedido)||{sellers:new Set(),evidence:[]};row.sellers.add(h.seller);row.evidence.push({seller:h.seller,source:h.source,path:h.path});perOrder.set(h.pedido,row)}
const ranking=new Map();for(const o of orderData){const found=perOrder.get(o.pedido);for(const seller of found?.sellers||[]){const r=ranking.get(seller)||{vendedor:seller,pedidos:0,faturamento:0};r.pedidos++;r.faturamento+=o.total;ranking.set(seller,r)}}
const result={
  checked_at:new Date().toISOString(),periodo:{inicio:START,fim:END},total_pedidos:orderData.length,
  stats,
  seller_hits:sellerHits.length,
  pedidos_com_vendedor:perOrder.size,
  ranking:[...ranking.values()].sort((a,b)=>b.faturamento-a.faturamento),
  evidence:[...perOrder].map(([pedido,v])=>({pedido,vendedores:[...v.sellers],evidence:v.evidence})),
  candidate_fields:[...candidateIds.values()].map(x=>({...x,numeric_values:[...x.numeric_values].slice(0,30)})).sort((a,b)=>b.count-a.count),
  field_catalog:[...fields.values()].map(x=>({...x,types:[...x.types]})).sort((a,b)=>a.source.localeCompare(b.source)||a.path.localeCompare(b.path))
};
fs.mkdirSync('output-forensic',{recursive:true});
fs.writeFileSync('output-forensic/resultado-forense.json',JSON.stringify(result,null,2));
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const md=['# Investigação forense de vendedor','','Período: '+START+' a '+END,'Pedidos: '+result.total_pedidos,'Pedidos com nome de vendedor encontrado: '+result.pedidos_com_vendedor,'','## Ranking',...(result.ranking.length?result.ranking.map(r=>'- '+r.vendedor+': '+r.pedidos+' pedidos — '+brl.format(r.faturamento)):['- Nenhum nome conhecido foi encontrado nos retornos.']),'','## Campos candidatos',...(result.candidate_fields.length?result.candidate_fields.slice(0,30).map(x=>'- '+x.source+' '+x.path+' ('+x.count+' ocorrências; IDs: '+(x.numeric_values.join(', ')||'nenhum')+')'):['- Nenhum campo candidato.'])].join('\n');
fs.writeFileSync('output-forensic/resumo.md',md);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
