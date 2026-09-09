import { createRemoteJWKSet, jwtVerify } from 'jose';

function decodePart(part){
  try { return JSON.parse(Buffer.from(part.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')); }
  catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const names = Object.keys(req.headers || {}).sort();
  const token = String(req.headers?.['x-vercel-oidc-token'] || '');
  const parts = token.split('.');
  const header = parts.length === 3 ? decodePart(parts[0]) : null;
  const payload = parts.length === 3 ? decodePart(parts[1]) : null;
  let verify = { ok: false, error: 'missing_token' };
  if (token) {
    try {
      const issuer = 'https://oidc.vercel.com/bestshoplojaonline-3453s-projects';
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } });
      const discoveryText = await discovery.text();
      if (!discovery.ok) throw new Error(`discovery_${discovery.status}:${discoveryText.slice(0,120)}`);
      const config = JSON.parse(discoveryText);
      const jwks = createRemoteJWKSet(new URL(config.jwks_uri));
      const result = await jwtVerify(token, jwks, {
        issuer,
        audience: 'https://vercel.com/bestshoplojaonline-3453s-projects'
      });
      verify = {
        ok: result.payload.sub === 'owner:bestshoplojaonline-3453s-projects:project:aton-innovex-readonly:environment:production',
        sub: result.payload.sub ?? null,
        jwks_uri: config.jwks_uri ?? null
      };
    } catch (e) {
      verify = { ok: false, error: `${e?.name || 'Error'}:${e?.message || 'unknown'}` };
    }
  }
  return res.status(200).json({
    ok: true,
    headers: names,
    oidc: token ? {
      present: true,
      header,
      payload: payload ? {
        iss: payload.iss ?? null,
        sub: payload.sub ?? null,
        aud: payload.aud ?? null,
        exp: payload.exp ?? null,
        iat: payload.iat ?? null,
        owner: payload.owner ?? null,
        project: payload.project ?? null,
        environment: payload.environment ?? null
      } : null
    } : { present: false },
    verify
  });
}
