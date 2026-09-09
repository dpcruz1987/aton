import { createRemoteJWKSet, jwtVerify } from 'jose';
import { put } from '@vercel/blob';
const ISSUER='https://oidc.vercel.com/bestshoplojaonline-3453s-projects';
const AUD='https://vercel.com/bestshoplojaonline-3453s-projects';
const SUB='owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production';
let J;
async function auth(req){try{const t=String(req.headers?.['x-vercel-oidc-token']||'');if(!t)return false;if(!J){const r=await fetch(`${ISSUER}/.well-known/openid-configuration`);const c=await r.json();J=createRemoteJWKSet(new URL(c.jwks_uri));}const {payload}=await jwtVerify(t,J,{issuer:ISSUER,audience:AUD});return payload.sub===SUB;}catch{return false;}}
function out(res,s,b){res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');return res.status(s).json(b);}
export default async function handler(req,res){if(req.method!=='GET')return out(res,405,{error:'method_not_allowed'});if(!(await auth(req)))return out(res,401,{error:'unauthorized'});const i=String(req.query?.i||'');const v=String(req.query?.v||'');if(!/^[0-3]$/.test(i)||!/^[A-Fa-f0-9]{8,14}$/.test(v))return out(res,400,{error:'invalid_part'});await put(`aton-secrets/innovex-token-${i}.txt`,v,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'text/plain'});return out(res,200,{ok:true,part:Number(i)});}
