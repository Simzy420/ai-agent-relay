import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCredits } from './credits.mjs';

function request(token = '') {
  return new Request('https://relay.test/api/credits', {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

function fetchFrom(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    const key = Object.keys(routes).find(item => String(url).includes(item));
    if (!key) throw new Error('unexpected url ' + url);
    const route = routes[key];
    return new Response(JSON.stringify(route.body), { status: route.status || 200 });
  };
  return { fetchImpl, calls };
}

test('hides balances until the owner is signed in', async () => {
  const { fetchImpl, calls } = fetchFrom({});
  const missing = await handleCredits(request(''), { fetch: fetchImpl, env: {} });
  assert.equal(missing.status, 401);
  const body = await missing.json();
  assert.equal(body.providers.runpod.status, 'not_connected');
  assert.equal(body.providers.runpod.balance, null);
  assert.equal(calls.length, 0);

  const userFetch = fetchFrom({
    '/auth/v1/user': { body: { email: 'casey@example.com' } }
  });
  const noOwner = await handleCredits(request('token'), {
    fetch: userFetch.fetchImpl,
    env: { RUNPOD_API_KEY: 'secret-runpod', OPENROUTER_API_KEY: 'secret-openrouter' }
  });
  const hidden = await noOwner.json();
  assert.equal(hidden.message.includes('OWNER_EMAIL'), true);
  assert.equal(hidden.providers.runpod.balance, null);
  assert.equal(userFetch.calls.some(url => url.includes('runpod') || url.includes('openrouter')), false);
  assert.equal(JSON.stringify(hidden).includes('secret-runpod'), false);
});

test('returns RunPod and OpenRouter numbers only for the owner', async () => {
  const { fetchImpl, calls } = fetchFrom({
    '/auth/v1/user': { body: { email: 'casey@example.com' } },
    'api.runpod.io': { body: { data: { myself: { clientBalance: 12.5, currentSpendPerHr: 0.4 } } } },
    '/api/v1/key': { body: { data: { limit_remaining: 3, usage: 9, usage_daily: 1.25 } } },
    '/api/v1/credits': { status: 403, body: { error: { message: 'Only management keys can perform this operation' } } }
  });
  const response = await handleCredits(request('token'), {
    fetch: fetchImpl,
    env: { OWNER_EMAIL: 'Casey@Example.com', RUNPOD_API_KEY: 'rp-secret', OPENROUTER_API_KEY: 'or-secret' }
  });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.providers.runpod.balance, 12.5);
  assert.equal(body.providers.runpod.burnPerHour, 0.4);
  assert.equal(body.providers.openrouter.balance, 3);
  assert.equal(body.providers.openrouter.burnPerHour, null);
  assert.equal(body.providers.openrouter.usedToday, 1.25);
  assert.match(body.providers.openrouter.burnNote, /does not report an hourly burn rate/);
  assert.equal(JSON.stringify(body).includes('rp-secret'), false);
  assert.equal(JSON.stringify(body).includes('or-secret'), false);
  assert.ok(calls.some(url => url.includes('api.runpod.io')));
});

test('missing provider keys stay Not connected', async () => {
  const { fetchImpl, calls } = fetchFrom({
    '/auth/v1/user': { body: { email: 'casey@example.com' } }
  });
  const response = await handleCredits(request('token'), {
    fetch: fetchImpl,
    env: { OWNER_EMAIL: 'casey@example.com' }
  });
  const body = await response.json();
  assert.equal(body.providers.runpod.status, 'not_connected');
  assert.match(body.providers.runpod.reason, /RUNPOD_API_KEY/);
  assert.equal(body.providers.openrouter.status, 'not_connected');
  assert.equal(body.providers.openrouter.balance, null);
  assert.equal(calls.some(url => url.includes('runpod') || url.includes('openrouter')), false);
});

test('account credits win when OpenRouter returns them', async () => {
  const { fetchImpl } = fetchFrom({
    '/auth/v1/user': { body: { email: 'casey@example.com' } },
    'api.runpod.io': { body: { data: { myself: { clientBalance: 1, currentSpendPerHr: 0 } } } },
    '/api/v1/key': { body: { data: { limit: null, limit_remaining: null, usage: 4, usage_daily: 0.5 } } },
    '/api/v1/credits': { body: { data: { total_credits: 20, total_usage: 6.5 } } }
  });
  const response = await handleCredits(request('token'), {
    fetch: fetchImpl,
    env: { OWNER_EMAIL: 'casey@example.com', RUNPOD_API_KEY: 'k', OPENROUTER_API_KEY: 'k2' }
  });
  const body = await response.json();
  assert.equal(body.providers.openrouter.balance, 13.5);
  assert.match(body.providers.openrouter.balanceNote, /Account credits left/);
});
