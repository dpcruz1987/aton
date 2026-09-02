import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./api/index.js", import.meta.url), "utf8");
assert.match(source, /code_challenge_methods_supported:\s*\["S256"\]/);
assert.match(source, /authorization_servers/);
assert.match(source, /refresh_token/);
assert.match(source, /AES|aes-256-gcm/i);
assert.doesNotMatch(source, /MELI_CLIENT_SECRET\s*=\s*["'][^"']+["']/);
console.log("Static security contract: OK");
