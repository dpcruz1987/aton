import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { configuredOperations, configuredParameters } from '../api/aton.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function request(body, authorization = 'Bearer connector-secret') {
  return { method: 'POST', body, query: {}, headers: { authorization } };
}

test.beforeEach(() => {
  process.env.ATON_CONNECTOR_TOKEN = 'connector-secret';
  process.env.ATON_BASE_URL = 'https://aton.example/';
  process.env.ATON_TOKEN = 'upstream-secret';
  process.env.ATON_READ_OPERATIONS = JSON.stringify({ produto: '/produtos/consulta' });
  process.env.ATON_READ_PARAMETERS = JSON.stringify({ produto: ['codigo', 'ean'] });
});

test('filters unsafe configured paths', () => {
  process.env.ATON_READ_OPERATIONS = JSON.stringify({ produto: '/produtos', escape: '/../admin', invalid: 'relative' });
  assert.deepEqual(configuredOperations(), { produto: '/produtos' });
});

test('normalizes configured parameter allowlists', () => {
  process.env.ATON_READ_PARAMETERS = JSON.stringify({ produto: ['codigo', 123], invalido: 'codigo' });
  assert.deepEqual(configuredParameters(), { produto: ['codigo'], invalido: [] });
});

test('rejects missing connector credentials', async () => {
  const res = response();
  await handler(request({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ''), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
});

test('implements MCP initialize', async () => {
  const res = response();
  await handler(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.protocolVersion, '2025-06-18');
  assert.equal(res.body.result.serverInfo.name, 'aton-innovex-readonly');
});

test('lists allowlisted operations as read-only MCP tools', async () => {
  const res = response();
  await handler(request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), res);
  assert.equal(res.body.result.tools.length, 1);
  assert.equal(res.body.result.tools[0].name, 'produto');
  assert.equal(res.body.result.tools[0].annotations.readOnlyHint, true);
});

test('sends allowlisted read parameters as a POST JSON body upstream', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const res = response();
    await handler(request({ operation: 'produto', params: { codigo: '001', ean: '789', ignored: 'x' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.options.body), { codigo: '001', ean: '789' });
    assert.equal(new URL(captured.url).search, '');
  } finally {
    global.fetch = originalFetch;
  }
});

