import fs from 'node:fs';

const COLLECTION_URL='https://documenter.gw.postman.com/api/collections/12902127/VV4tUJaC?segregateAuth=true&versionTag=latest';
const response=await fetch(COLLECTION_URL,{redirect:'error',signal:AbortSignal.timeout(60000)});
if(!response.ok) throw new Error('Postman HTTP '+response.status);
const collection=await response.json();

function walk(items,folders=[]){
  const out=[];
  for(const item of items||[]){
    if(item.request) out.push({folders,item});
    else out.push(...walk(item.item||[],[...folders,item.name||'']));
  }
  return out;
}
function rawUrl(req){
  return typeof req.url==='string'?req.url:(req.url?.raw||'');
}
function parseBody(text){
  if(!text)return null;
  try{return JSON.parse(text);}catch{return text;}
}
function shape(v){
  if(Array.isArray(v))return v.length?[shape(v[0])]:[];
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,shape(v[k])]));
  if(v===null)return 'null';
  return typeof v;
}
function paths(v,p='root',out=[]){
  if(Array.isArray(v)){for(const x of v.slice(0,2))paths(x,p+'[]',out);}
  else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){const q=p+'.'+k;out.push(q);paths(x,q,out);}}
  return out;
}
const terms=/vendedor|representante|consultor|atendente|usuario|operador|comercial|sales|seller/i;
const operations=walk(collection.item).map(({folders,item},ordinal)=>{
  const req=item.request||{};
  const reqBody=parseBody(req.body?.raw||'');
  const responses=(item.response||[]).map(r=>{
    const body=parseBody(r.body||'');
    const allPaths=paths(body);
    return {name:r.name||'',code:r.code,matching_paths:allPaths.filter(x=>terms.test(x)),body_shape:shape(body)};
  });
  return {
    ordinal:ordinal+1,folder:folders,name:item.name||'',method:req.method||'',
    route:new URL(rawUrl(req)).pathname.replace('/AtonSNIsapi.dll/atonerp',''),
    request_body:reqBody,
    description_matches:terms.test(String(req.description||item.description||'')),
    request_matches:paths(reqBody).filter(x=>terms.test(x)),
    responses
  };
});
const hits=operations.filter(o=>o.description_matches||o.request_matches.length||o.responses.some(r=>r.matching_paths.length));
const sellerCandidates=operations.filter(o=>/pedido|venda|receber|logistica|integrac/i.test([o.folder.join(' '),o.name,o.route].join(' ')));
const report={checked_at:new Date().toISOString(),collection:collection.info?.name||'',counts:{operations:operations.length,post:operations.filter(x=>x.method==='POST').length,put:operations.filter(x=>x.method==='PUT').length},commercial_term_hits:hits,sales_related_operations:sellerCandidates};
fs.mkdirSync('output-docs',{recursive:true});
fs.writeFileSync('output-docs/auditoria-documentacao.json',JSON.stringify(report,null,2));
const md=[
'# Auditoria ampliada da documentação Aton','',
'Coleção: '+report.collection,
'Operações: '+report.counts.operations+' (POST: '+report.counts.post+', PUT: '+report.counts.put+')',
'Operações com termos comerciais: '+hits.length,'',
'## Correspondências',
...(hits.length?hits.map(h=>'- '+h.method+' '+h.route+' — '+h.folder.concat(h.name).join(' / ')):[
'- Nenhuma ocorrência de vendedor/representante/consultor/atendente/usuário comercial nos contratos e exemplos.'
]),'',
'## Operações relacionadas a vendas',
...sellerCandidates.map(h=>'- '+h.method+' '+h.route+' — '+h.folder.concat(h.name).join(' / '))
].join('\n');
fs.writeFileSync('output-docs/resumo.md',md);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
