import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const ISSUER='https://oidc.vercel.com/bestshoplojaonline-3453s-projects';
const AUD='https://vercel.com/bestshoplojaonline-3453s-projects';
const SUB='owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production';
let J;
async function auth(req){try{const t=String(req.headers?.['x-vercel-oidc-token']||'');if(!t)return false;if(!J){const r=await fetch(`${ISSUER}/.well-known/openid-configuration`);const c=await r.json();J=createRemoteJWKSet(new URL(c.jwks_uri));}const {payload}=await jwtVerify(t,J,{issuer:ISSUER,audience:AUD});return payload.sub===SUB;}catch{return false;}}
function out(res,s,b){res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');return res.status(s).json(b);}
export default async function handler(req,res){if(req.method!=='GET')return out(res,405,{error:'method_not_allowed'});if(!(await auth(req)))return out(res,401,{error:'unauthorized'});const p=[0,1,2,3].map(i=>String(req.query?.['p'+i]||'')).join('');if(!/^[A-Fa-f0-9]{50}$/.test(p))return out(res,400,{error:'invalid_token_shape'});const secret=process.env.ATON_CONNECTOR_TOKEN;if(!secret)return out(res,503,{error:'connector_secret_missing'});const key=crypto.createHash('sha256').update(secret).digest();const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(p,'utf8'),c.final()]);return out(res,200,{v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')});}
