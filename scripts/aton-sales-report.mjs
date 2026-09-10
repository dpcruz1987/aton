import fs from 'node:fs';

const BASE = process.env.ATON_INNOVEX_API_BASE || 'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const TOKEN = process.env.ATON_INNOVEX_TOKEN;
const INTEGRADOR = process.env.ATON_INNOVEX_INTEGRADOR || 'ATONAPI';
if (!TOKEN) throw new Error('ATON_INNOVEX_TOKEN não configurado');
const [start,end] = process.argv.slice(2);
if (![start,end].every(v=>typeof v==='string'&&v.length===10&&v[2]==='/'&&v[5]==='/')) throw new Error('Datas inválidas');

const get=(o,names)=>{for(const n of names)if(o&&o[n]!==undefined&&o[n]!==null&&o[n]!=='')return o[n];};
const txt=v=>typeof v==='string'?v.trim():'';
const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:0;if(typeof v!=='string')return 0;let s='';for(const ch of v.trim()){if('0123456789,-.'.includes(ch))s+=ch;}const x=s.includes(',')?s.split('.').join('').replace(',','.'):s;const n=Number(x);return Number.isFinite(n)?n:0;};
function collect(v,path,out){
  if(Array.isArray(v)){const rows=v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));if(rows.length)out.push({path,rows,keys:[...new Set(rows.slice(0,5).flatMap(Object.keys))]});v.forEach((x,i)=>collect(x,path+'['+i+']',out));}
  else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))collect(x,path+'.'+k,out);
}
function choose(payload){const c=[];collect(payload,'root',c);for(const x of c)x.score=(x.keys.some(k=>/pedido|ordem|numero/i.test(k))?8:0)+(x.keys.some(k=>/vendedor|representante|usuario.*venda/i.test(k))?12:0)+(x.keys.some(k=>/total|valor/i.test(k))?5:0)-(/itens?|produtos?/i.test(x.path)?8:0);c.sort((a,b)=>b.score-a.score||b.rows.length-a.rows.length);return {rows:c[0]?.rows||[],schema:c.slice(0,10).map(x=>({path:x.path,keys:x.keys,score:x.score,quantidade:x.rows.length}))};}
function seller(o){function visit(v){if(!v||typeof v!=='object')return '';for(const [k,x] of Object.entries(v))if(/vendedor|representante|usuario.*venda/i.test(k)){if(typeof x==='string'&&txt(x))return txt(x);if(x&&typeof x==='object'){const n=txt(get(x,['nome','descricao','name','razao_social']));if(n)return n;}}for(const x of Object.values(v)){const n=visit(x);if(n)return n;}return '';}return visit(o);}
const total=o=>num(get(o,['valor_total','vlr_total','total_pedido','valor_pedido','total','VLR_TOTAL']));
const oid=o=>String(get(o,['pedido','numero_pedido','id','codigo','PEDIDO'])??JSON.stringify(o).slice(0,160));

const seen=new Set(), sellers=new Map();let requests=0,schema=[];
for(const position of ['EMITIDO','FECHADO'])for(let offset=1;offset<=200;offset++){
 const body={tipo_data:'data_pedido',data_inicial:start,data_final:end,posicao:position,offset,limit:50};
 const response=await fetch(BASE+'/pedidosvenda/consulta',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:TOKEN,Integrador:INTEGRADOR},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});requests++;
 const raw=await response.text();if(!response.ok)throw new Error('Aton HTTP '+response.status+': '+raw.slice(0,300));let payload;try{payload=JSON.parse(raw);}catch{throw new Error('Resposta não é JSON');}
 const selected=choose(payload),rows=selected.rows;if(!schema.length)schema=selected.schema;
 for(const o of rows){const key=oid(o);if(seen.has(key))continue;seen.add(key);const name=seller(o)||'NÃO INFORMADO';const r=sellers.get(name)||{vendedor:name,pedidos:0,faturamento:0};r.pedidos++;r.faturamento+=total(o);sellers.set(name,r);}
 if(rows.length<50)break;
}
const result=[...sellers.values()].sort((a,b)=>b.faturamento-a.faturamento).map((r,i)=>({posicao:i+1,...r,ticket_medio:r.pedidos?r.faturamento/r.pedidos:0}));
fs.mkdirSync('output',{recursive:true});
fs.writeFileSync('output/vendas-por-vendedor.json',JSON.stringify({periodo:{inicio:start,fim:end},consultas:requests,total_pedidos:seen.size,vendedores:result},null,2));
fs.writeFileSync('output/esquema-resposta.json',JSON.stringify(schema,null,2));
const csv=['Posição,Vendedor,Pedidos,Faturamento,Ticket médio',...result.map(r=>[r.posicao,JSON.stringify(r.vendedor),r.pedidos,r.faturamento.toFixed(2),r.ticket_medio.toFixed(2)].join(','))].join('\\n');fs.writeFileSync('output/vendas-por-vendedor.csv',csv);
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const md=['# Vendas por vendedor','','Período: '+start+' a '+end,'','| # | Vendedor | Pedidos | Faturamento | Ticket médio |','|---:|---|---:|---:|---:|',...result.map(r=>'| '+r.posicao+' | '+r.vendedor.split('|').join('/')+' | '+r.pedidos+' | '+brl.format(r.faturamento)+' | '+brl.format(r.ticket_medio)+' |')].join('\\n');
fs.writeFileSync('output/resumo.md',md);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
if(!result.length)throw new Error('Nenhum pedido/vendedor encontrado');
