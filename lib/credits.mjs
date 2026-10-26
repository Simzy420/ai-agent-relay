// Server-only balance lookup. The browser never sees provider keys.

export const DEFAULT_SUPABASE_URL = 'https://inlqueorerrsmfnaryzj.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_j83rvcf4ApFRj9k_ZlzmBw_1CqfaRmj';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function blank(reason, status) {
  return {
    connected: false,
    status,
    reason,
    balance: null,
    currency: 'USD',
    burnPerHour: null,
    burnNote: '',
    balanceNote: '',
    used: null,
    usedToday: null
  };
}

function hiddenProviders(reason) {
  return { runpod: blank(reason, 'not_connected'), openrouter: blank(reason, 'not_connected') };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function loadRunpod(env, fetchImpl) {
  if (!env.RUNPOD_API_KEY) return blank('RUNPOD_API_KEY is not set', 'not_connected');
  try {
    const response = await fetchImpl('https://api.runpod.io/graphql?api_key=' + encodeURIComponent(env.RUNPOD_API_KEY), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query { myself { clientBalance currentSpendPerHr } }' }),
      signal: AbortSignal.timeout(12000)
    });
    const body = await readJson(response);
    const myself = body?.data?.myself;
    if (!response.ok || body?.errors || !myself || typeof myself.clientBalance !== 'number') {
      return blank('RunPod did not return a balance.', 'error');
    }
    const burn = typeof myself.currentSpendPerHr === 'number' ? myself.currentSpendPerHr : null;
    return {
      connected: true,
      status: 'live',
      reason: '',
      balance: myself.clientBalance,
      currency: 'USD',
      burnPerHour: burn,
      burnNote: burn == null ? 'RunPod did not return currentSpendPerHr.' : 'Current spend per hour from RunPod.',
      balanceNote: 'Client balance from RunPod.',
      used: null,
      usedToday: null
    };
  } catch {
    return blank('Could not reach RunPod.', 'error');
  }
}

async function loadOpenrouter(env, fetchImpl) {
  if (!env.OPENROUTER_API_KEY) return blank('OPENROUTER_API_KEY is not set', 'not_connected');
  const headers = { authorization: `Bearer ${env.OPENROUTER_API_KEY}` };
  try {
    const keyResponse = await fetchImpl('https://openrouter.ai/api/v1/key', { headers, signal: AbortSignal.timeout(12000) });
    const keyBody = await readJson(keyResponse);
    if (!keyResponse.ok || !keyBody?.data) return blank('OpenRouter rejected the key endpoint.', 'error');
    const data = keyBody.data;
    let account = null;
    try {
      const creditResponse = await fetchImpl('https://openrouter.ai/api/v1/credits', { headers, signal: AbortSignal.timeout(12000) });
      const creditBody = await readJson(creditResponse);
      if (creditResponse.ok && typeof creditBody?.data?.total_credits === 'number' && typeof creditBody?.data?.total_usage === 'number') {
        account = creditBody.data.total_credits - creditBody.data.total_usage;
      }
    } catch {
      account = null;
    }
    const capped = typeof data.limit_remaining === 'number' ? data.limit_remaining : null;
    const balance = account == null ? capped : account;
    let balanceNote = 'This OpenRouter key has no spend cap, and the credits endpoint did not return an account balance.';
    if (account != null) balanceNote = 'Account credits left (purchased minus used) from OpenRouter.';
    else if (capped != null) balanceNote = 'Remaining spend cap on this OpenRouter key.';
    const usedToday = typeof data.usage_daily === 'number' ? data.usage_daily : null;
    return {
      connected: true,
      status: 'live',
      reason: '',
      balance,
      currency: 'USD',
      burnPerHour: null,
      burnNote: usedToday == null
        ? 'OpenRouter does not report an hourly burn rate.'
        : 'OpenRouter does not report an hourly burn rate. Used today (UTC) is shown instead.',
      balanceNote,
      used: typeof data.usage === 'number' ? data.usage : null,
      usedToday
    };
  } catch {
    return blank('Could not reach OpenRouter.', 'error');
  }
}

export async function handleCredits(request, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const env = deps.env || process.env;
  if (request.method !== 'GET') return json({ ok: false, message: 'Use GET.' }, 405);
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return json({
      ok: false,
      signedIn: false,
      owner: false,
      message: 'Sign in as the owner to load live balances.',
      providers: hiddenProviders('Sign in as the owner to load live balances.')
    }, 401);
  }
  const supabaseUrl = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  const supabaseKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;
  let user;
  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      return json({
        ok: false,
        signedIn: false,
        owner: false,
        message: 'That sign-in expired. Sign in again to load live balances.',
        providers: hiddenProviders('Sign in again.')
      }, 401);
    }
    user = await readJson(response);
  } catch {
    return json({
      ok: false,
      signedIn: false,
      owner: false,
      message: 'Could not reach Supabase to check the sign-in.',
      providers: hiddenProviders('Could not reach Supabase.')
    }, 502);
  }
  const email = String(user?.email || '').toLowerCase();
  const ownerEmail = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!ownerEmail) {
    return json({
      ok: false,
      signedIn: true,
      owner: false,
      message: 'OWNER_EMAIL is not set on the server, so live balances stay hidden.',
      providers: hiddenProviders('OWNER_EMAIL is not set on the server.')
    }, 200);
  }
  if (email !== ownerEmail) {
    return json({
      ok: false,
      signedIn: true,
      owner: false,
      message: 'This signed-in account cannot view live balances.',
      providers: hiddenProviders('This account cannot view live balances.')
    }, 403);
  }
  const [runpod, openrouter] = await Promise.all([loadRunpod(env, fetchImpl), loadOpenrouter(env, fetchImpl)]);
  return json({ ok: true, signedIn: true, owner: true, message: '', providers: { runpod, openrouter } }, 200);
}
