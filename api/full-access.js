import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ATON_BASE='https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const ENCRYPTED_TOKEN={v:1,iv:'KHOkMypSrZ4d7qgo',tag:'4G2PS8LJIkErmc5voXSAag==',data:'ECmKM+fSDV2aegT7vv+XMLQ14lBdZvOdNyac4WStaYor10MF1vf7lnmHb9ke3C/6rIU='};
const ISSUER='https://oidc.vercel.com/bestshoplojaonline-3453s-projects';
const AUDIENCE='https://vercel.com/bestshoplojaonline-3453s-projects';
const SUBJECT='owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production';
const METHODS=new Set(['GET','POST','PUT','PATCH','DELETE']);
let jwksPromise;

function reply(res,status,body){res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');return res.status(status).json(body);}
function safePath(path){return typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&!path.includes('..')&&!path.includes('://');}
function decodeBody(v){if(!v)return undefined;try{return JSON.parse(Buffer.from(String(v),'base64url').toString('utf8'));}catch{throw new Error('invalid_body');}}
function loadToken(){const secret=process.env.ATON_CONNECTOR_TOKEN;if(!secret)throw new Error('connector_secret_missing');const key=crypto.createHash('sha256').update(secret).digest();const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ENCRYPTED_TOKEN.iv,'base64'));d.setAuthTag(Buffer.from(ENCRYPTED_TOKEN.tag,'base64'));return Buffer.concat([d.update(Buffer.from(ENCRYPTED_TOKEN.data,'base64')),d.final()]).toString('utf8');}
async function jwks(){if(!jwksPromise)jwksPromise=(async()=>{const r=await fetch(`${ISSUER}/.well-known/openid-configuration`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('oidc_discovery_failed');const c=await r.json();return createRemoteJWKSet(new URL(c.jwks_uri));})();return jwksPromise;}
async function authorized(req){const t=String(req.headers?.['x-vercel-oidc-token']||'');if(!t)return false;try{const {payload}=await jwtVerify(t,await jwks(),{issuer:ISSUER,audience:AUDIENCE});return payload.sub===SUBJECT&&payload.project==='aton-innovex-readonly'&&payload.environment==='production';}catch{return false;}}

export default async function handler(req,res){
  if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});
  if(!(await authorized(req)))return reply(res,401,{error:'unauthorized'});
  const q=req.query||{};
  const method=String(q.method||'GET').toUpperCase();
  const path=String(q.path||'');
  if(!METHODS.has(method))return reply(res,400,{error:'unsupported_method'});
  if(!safePath(path))return reply(res,400,{error:'invalid_path'});
  let token;try{token=loadToken();}catch{return reply(res,503,{error:'token_unavailable'});}
  let body;try{body=decodeBody(q.body);}catch{return reply(res,400,{error:'invalid_body'});}
  const header=process.env.ATON_TOKEN_HEADER||'Authorization';
  const prefix=process.env.ATON_TOKEN_PREFIX??'';
  const headers={Accept:'application/json',[header]:`${prefix}${token}`};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(process.env.ATON_INTEGRADOR)headers.Integrador=process.env.ATON_INTEGRADOR;
  const url=new URL(`${ATON_BASE}${path}`);
  for(const [k,v] of Object.entries(q)){if(k.startsWith('qp_')&&v!==undefined&&v!==null)url.searchParams.set(k.slice(3),String(v));}
  try{
    const upstream=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    const text=await upstream.text();let data;try{data=JSON.parse(text);}catch{data={data:text.slice(0,20000)}}
    return reply(res,upstream.status,{ok:upstream.ok,status:upstream.status,method,path,data});
  }catch(e){return reply(res,502,{error:'upstream_unavailable',message:e?.message||null});}
}
