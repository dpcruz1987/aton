import fs from 'node:fs';
const BASE=process.env.ATON_INNOVEX_API_BASE||'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const TOKEN=process.env.ATON_INNOVEX_TOKEN;const INTEGRADOR=process.env.ATON_INNOVEX_INTEGRADOR||'ATONAPI';
const START=process.env.DATA_INICIAL||'01/09/2026',END=process.env.DATA_FINAL||'10/09/2026';
if(!TOKEN)throw new Error('ATON_INNOVEX_TOKEN ausente');
const headers={Accept:'application/json','Content-Type':'application/json',Authorization:TOKEN,Integrador:INTEGRADOR};
async function call(body){const r=await fetch(BASE+'/pedidosvenda/consulta',{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});const t=await r.text();if(!r.ok)throw new Error('HTTP '+r.status);return JSON.parse(t)}
function arrays(v,out=[]){if(Array.isArray(v)){const rows=v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));if(rows.length)out.push(rows);for(const x of v)arrays(x,out)}else if(v&&typeof v==='object')for(const x of Object.values(v))arrays(x,out);return out}
function score(rows){const k=[...new Set(rows.slice(0,4).flatMap(Object.keys))];return(k.some(x=>/pedido/i.test(x))?8:0)+(k.some(x=>/total/i.test(x))?5:0)}
function rows(p){const a=arrays(p);a.sort((x,y)=>score(y)-score(x)||y.length-x.length);return a[0]||[]}
function get(o,n){for(const k of n)if(o?.[k]!==undefined&&o[k]!==null&&o[k]!=='')return o[k]}
function num(v){if(typeof v==='number')return v;if(typeof v!=='string')return 0;const s=v.includes(',')?v.replaceAll('.','').replace(',','.'):v.replace(/[^0-9.-]/g,'');const n=Number(s);return Number.isFinite(n)?n:0}
function xmlValues(v,path='root',out=[]){if(Array.isArray(v))for(const x of v)xmlValues(x,path+'[]',out);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(k.toLowerCase()==='xml'&&typeof x==='string')out.push({path:path+'.'+k,xml:x});else xmlValues(x,path+'.'+k,out)}return out}
function clean(s){return String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').trim()}
function sellerFields(xml){
 const out=[];let m;
 const obs=/<obsCont\b[^>]*xCampo=["']([^"']+)["'][^>]*>([\s\S]*?)<\/obsCont>/gi;
 while((m=obs.exec(xml))){const label=clean(m[1]);if(/vend|represent|consult|atend|comercial/i.test(label)){const x=/<xTexto>([\s\S]*?)<\/xTexto>/i.exec(m[2]);if(x&&clean(x[1]))out.push({label,value:sellerName(x[1]),method:'obsCont'})}}
 const generic=/(?:vendedor|representante|consultor|atendente|comercial)\s*[:=\-]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,60})/gi;
 while((m=generic.exec(xml))){const value=sellerName(clean(m[1]).split(/[;<]/)[0]);if(value)out.push({label:m[0].slice(0,m[0].indexOf(m[1])).replace(/[:=\-\s]+$/,''),value,method:'texto'})}
 return out;
}
const orders=new Map();
for(const posicao of ['EMITIDO','FECHADO'])for(let offset=1;offset<=200;offset++){const p=await call({tipo_data:'data_pedido',data_inicial:START,data_final:END,posicao,offset,limit:50});const rr=rows(p);for(const o of rr){const id=String(get(o,['pedido','numero_pedido','id','codigo','PEDIDO'])||'');if(id&&!orders.has(id))orders.set(id,o)}if(rr.length<50)break}
const evidence=[];
for(const[pedido,o]of orders){for(const x of xmlValues(o))for(const f of sellerFields(x.xml))evidence.push({pedido,label:f.label,vendedor:f.value,metodo:f.method,path:x.path,total:num(get(o,['total_pedido','valor_total','vlr_total','valor_pedido','total','VLR_TOTAL']))})}
const perOrder=new Map();for(const e of evidence){const a=perOrder.get(e.pedido)||[];a.push(e);perOrder.set(e.pedido,a)}
const conflicts=[...perOrder].filter(([,a])=>new Set(a.map(x=>x.vendedor.toLowerCase())).size>1).map(([pedido,a])=>({pedido,valores:[...new Set(a.map(x=>x.vendedor))]}));
const ranking=new Map();for(const[pedido,a]of perOrder){const unique=[...new Map(a.map(x=>[x.vendedor.toLowerCase(),x])).values()];if(unique.length!==1)continue;const e=unique[0];const r=ranking.get(e.vendedor.toLowerCase())||{vendedor:e.vendedor,pedidos:0,faturamento:0};r.pedidos++;r.faturamento+=e.total;ranking.set(e.vendedor.toLowerCase(),r)}
const result={checked_at:new Date().toISOString(),periodo:{inicio:START,fim:END},total_pedidos:orders.size,pedidos_com_campo_vendedor:perOrder.size,pedidos_sem_campo_vendedor:orders.size-perOrder.size,conflitos:conflicts,ranking:[...ranking.values()].sort((a,b)=>b.faturamento-a.faturamento),evidencias:evidence.map(({total,...x})=>x)};
fs.mkdirSync('output-nfe-seller',{recursive:true});fs.writeFileSync('output-nfe-seller/resultado.json',JSON.stringify(result,null,2));
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});const md=['# Vendas por vendedor via XML da NF-e','','Período: '+START+' a '+END,'Cobertura: '+result.pedidos_com_campo_vendedor+' de '+result.total_pedidos+' pedidos','Conflitos: '+conflicts.length,'','| Vendedor | Pedidos | Faturamento | Ticket médio |','|---|---:|---:|---:|',...result.ranking.map(r=>'| '+r.vendedor.replaceAll('|','/')+' | '+r.pedidos+' | '+brl.format(r.faturamento)+' | '+brl.format(r.faturamento/r.pedidos)+' |')].join('\n');fs.writeFileSync('output-nfe-seller/resumo.md',md);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
