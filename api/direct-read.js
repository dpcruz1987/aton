import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ATON_BASE = 'https://api.ambarxcall.com.br/AtonSNIsapi.dll/atonerp';
const DIRECT_PATHS = {
  products: '/produtos/listagemgeral',
  product_search: '/produtos/listagemgeral',
  product_stock: '/produtos/consultarestoque',
};
const ENCRYPTED_TOKEN={v:1,iv:'KHOkMypSrZ4d7qgo',tag:'4G2PS8LJIkErmc5voXSAag==',data:'ECmKM+fSDV2aegT7vv+XMLQ14lBdZvOdNyac4WStaYor10MF1vf7lnmHb9ke3C/6rIU='};
const ISSUER='https://oidc.vercel.com/bestshoplojaonline-3453s-projects';
const AUDIENCE='https://vercel.com/bestshoplojaonline-3453s-projects';
const SUBJECT='owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production';
let jwksPromise;
function parameters(){try{return JSON.parse(process.env.ATON_READ_PARAMETERS||'{}');}catch{return {};}}
async function jwks(){if(!jwksPromise)jwksPromise=(async()=>{const r=await fetch(`${ISSUER}/.well-known/openid-configuration`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('oidc_discovery_failed');const c=await r.json();return createRemoteJWKSet(new URL(c.jwks_uri));})();return jwksPromise;}
async function authorized(req){const t=String(req.headers?.['x-vercel-oidc-token']||'');if(!t)return false;try{const {payload}=await jwtVerify(t,await jwks(),{issuer:ISSUER,audience:AUDIENCE});return payload.sub===SUBJECT&&payload.project==='aton-innovex-readonly'&&payload.environment==='production';}catch{return false;}}
function reply(res,status,body){res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');return res.status(status).json(body);}
function loadToken(){const secret=process.env.ATON_CONNECTOR_TOKEN;if(!secret)throw new Error('connector_secret_missing');const key=crypto.createHash('sha256').update(secret).digest();const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ENCRYPTED_TOKEN.iv,'base64'));d.setAuthTag(Buffer.from(ENCRYPTED_TOKEN.tag,'base64'));return Buffer.concat([d.update(Buffer.from(ENCRYPTED_TOKEN.data,'base64')),d.final()]).toString('utf8');}
export default async function handler(req,res){if(req.method!=='GET')return reply(res,405,{error:'method_not_allowed'});if(!(await authorized(req)))return reply(res,401,{error:'unauthorized'});const q=req.query||{};const operation=String(q.operation||'');const path=DIRECT_PATHS[operation];if(!path)return reply(res,404,{error:'operation_not_allowed'});let token;try{token=loadToken();}catch{return reply(res,503,{error:'token_unavailable'});}const allowed=parameters()[operation]||[];const body={};for(const name of allowed){if(q[name]!==undefined&&q[name]!==null)body[name]=q[name];}const header=process.env.ATON_TOKEN_HEADER||'Authorization';const prefix=process.env.ATON_TOKEN_PREFIX??'';const headers={Accept:'application/json','Content-Type':'application/json',[header]:`${prefix}${token}`};if(process.env.ATON_INTEGRADOR)headers.Integrador=process.env.ATON_INTEGRADOR;try{const upstream=await fetch(`${ATON_BASE}${path}`,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(25000)});const text=await upstream.text();let data;try{data=JSON.parse(text);}catch{data={data:text.slice(0,12000)}}return reply(res,upstream.status,data);}catch(e){return reply(res,502,{error:'upstream_unavailable',message:e?.message||null});}}
