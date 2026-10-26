// Pure relay logic. No DOM, no network. Safe to import from the page and from node tests.

export const STORAGE_KEY = 'relay-v1';

export const PRESETS = [
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', icon: '/icons/chatgpt.svg', tile: '#111111', full: false },
  { key: 'base44', name: 'Base44', url: 'https://base44.com', icon: '/icons/base44.png', tile: '#111111', full: true },
  { key: 'cursor', name: 'Cursor', url: 'https://cursor.com', icon: '/icons/cursor.svg', tile: '#111111', full: false },
  { key: 'buffer', name: 'Buffer', url: 'https://buffer.com', icon: '/icons/buffer.svg', tile: '#1b3bff', full: false },
  { key: 'linear', name: 'Linear', url: 'https://linear.app', icon: '/icons/linear.svg', tile: '#151516', full: false },
  { key: 'replit', name: 'Replit', url: 'https://replit.com', icon: '/icons/replit.svg', tile: '#111111', full: false },
  { key: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai', icon: '/icons/perplexity.svg', tile: '#111111', full: false },
  { key: 'link', name: 'Link', url: 'https://link.com', icon: '/icons/link.png', tile: '#06281c', full: true, hint: 'Stripe' },
  { key: 'claude', name: 'Claude', url: 'https://claude.ai', icon: '/icons/claude.svg', tile: '#1a1412', full: false },
  { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', icon: '/icons/gemini.png', tile: '#111111', full: true },
  { key: 'github', name: 'GitHub', url: 'https://github.com', icon: '/icons/github.svg', tile: '#111111', full: false },
  { key: 'vercel', name: 'Vercel', url: 'https://vercel.com', icon: '/icons/vercel.svg', tile: '#111111', full: false },
  { key: 'supabase', name: 'Supabase', url: 'https://supabase.com', icon: '/icons/supabase.svg', tile: '#111111', full: false },
  { key: 'runpod', name: 'RunPod', url: 'https://www.runpod.io', icon: '/icons/runpod.png', tile: '#111111', full: true },
  { key: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai', icon: '/icons/openrouter.svg', tile: '#111111', full: false },
  { key: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', icon: '/icons/deepseek.svg', tile: '#111111', full: false },
  { key: 'boundless', name: 'Boundless', url: 'https://boundless.network', icon: '/icons/boundless.svg', tile: '#111111', full: false }
];

// Slots for a later in-app call. Nothing here sends a request.
export const adapters = {
  openrouter: {
    id: 'openrouter',
    canCallInApp: false,
    unavailableReason: 'In-app OpenRouter calls are not connected in this version.'
  },
  runpod: {
    id: 'runpod',
    canCallInApp: false,
    unavailableReason: 'In-app RunPod calls are not connected in this version.'
  }
};

export const CAPTURE_PROMPT = `Prepare a self-contained technical handoff for another AI with no access to our chat. Include: project goal and stack; current implementation; exact task, failing workflows and errors; relevant filenames and complete relevant code or logs; attempted fixes and outcomes; constraints; confirmed facts versus guesses; decisions already made; and the single next task. End with a section titled "Decisions:" listing every decision the next AI must keep. Do not assume the next AI can see this conversation.`;

const HANDOFF_KEYS = ['goal', 'summary', 'error', 'attempts', 'source', 'links', 'constraints', 'next'];

export function uid() {
  return crypto.randomUUID();
}

export function emptyHandoff() {
  return { goal: '', summary: '', error: '', attempts: '', source: '', links: '', constraints: '', next: '', files: [] };
}

export function emptyPacket() {
  return { goal: '', state: '', decisions: '', files: [], hops: [] };
}

export function emptyFlow() {
  return { rules: [], steps: [] };
}

export function emptyState() {
  const project = emptyProject('My first project');
  return { version: 3, projects: [project], active: project.id, history: [], onboardingDismissed: false };
}

export function emptyProject(name) {
  const handoff = emptyHandoff();
  const packet = emptyPacket();
  packet.files = handoff.files;
  return {
    id: uid(),
    name,
    notes: '',
    tools: [],
    handoff,
    packet,
    flow: emptyFlow(),
    draftHistoryId: '',
    legacyHandoffLogged: false
  };
}

export function safeUrl(text) {
  try {
    const u = new URL(String(text || '').trim());
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function presetForUrl(url, presets = PRESETS) {
  const host = hostOf(url);
  if (!host) return null;
  return presets.find(preset => {
    const presetHost = hostOf(preset.url);
    return host === presetHost || host.endsWith('.' + presetHost);
  }) || null;
}

export function nameFromUrl(raw, presets = PRESETS) {
  const direct = safeUrl(raw);
  const prefixed = direct || safeUrl('https://' + String(raw || '').trim());
  const url = direct || (String(raw || '').includes(' ') ? null : prefixed);
  if (!url) return '';
  const preset = presetForUrl(url, presets);
  if (preset) return preset.name;
  const host = hostOf(url);
  const parts = host.split('.').filter(Boolean);
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return String(label || '').replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, char => char.toUpperCase());
}

export function coerceUrl(text) {
  const raw = String(text || '').trim();
  if (!raw) return { url: '', error: '' };
  if (/^https?:\/\//i.test(raw)) {
    const url = safeUrl(raw);
    return url ? { url, error: '' } : { url: '', error: 'That website needs to start with http:// or https:// and be a real link.' };
  }
  if (!raw.includes(' ') && raw.includes('.')) {
    const url = safeUrl('https://' + raw);
    return url ? { url, error: '' } : { url: '', error: 'That website link could not be read.' };
  }
  return { url: '', error: 'That does not look like a website. Leave the website blank to save a name only, or paste a full link.' };
}

function normalizeUrl(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname.replace(/\/$/, '');
  return `${u.protocol}//${host}${path}${u.search}`;
}

export function findDuplicate(tools, { name, url, exceptId }) {
  const wantedName = String(name || '').trim().toLowerCase();
  const wantedUrl = url ? normalizeUrl(url) : '';
  for (const tool of tools) {
    if (tool.id === exceptId) continue;
    if (wantedUrl && tool.url && normalizeUrl(tool.url) === wantedUrl) return { tool, reason: 'url' };
    if (wantedName && String(tool.name || '').trim().toLowerCase() === wantedName) return { tool, reason: 'name' };
  }
  return null;
}

export function providerKind(tool) {
  const name = String(tool?.name || '').toLowerCase();
  const url = String(tool?.url || '').toLowerCase();
  if (name.includes('runpod') || url.includes('runpod.io')) return 'runpod';
  if (name.includes('openrouter') || url.includes('openrouter.ai')) return 'openrouter';
  return 'manual';
}

export function adapterFor(tool) {
  return adapters[providerKind(tool)] || null;
}

export function localDay(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nextReset(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

export function rollQuota(tool, now = new Date()) {
  const day = localDay(now);
  if (tool.dailyDay !== day) {
    tool.dailyUsed = 0;
    tool.hitLimit = false;
    tool.dailyDay = day;
    return true;
  }
  return false;
}

export function toolHasQuota(tool, live, now = new Date()) {
  rollQuota(tool, now);
  if (tool.hitLimit) return false;
  if (tool.dailyLimit != null && tool.dailyLimit !== '' && Number(tool.dailyUsed) >= Number(tool.dailyLimit)) return false;
  if (live && live.connected === true && typeof live.balance === 'number' && live.balance <= 0) return false;
  return true;
}

export function nextInChain(tools, fromId, liveFor, now = new Date()) {
  if (!tools?.length) return null;
  let start = 0;
  if (fromId) {
    const index = tools.findIndex(tool => tool.id === fromId);
    if (index >= 0) start = index + 1;
  }
  for (let step = 0; step < tools.length; step += 1) {
    const tool = tools[(start + step) % tools.length];
    const live = typeof liveFor === 'function' ? liveFor(tool) : null;
    if (toolHasQuota(tool, live, now)) return tool;
  }
  return null;
}

export function nextByAllowance(tools, fromId) {
  if (!tools?.length) return null;
  let start = 0;
  if (fromId) {
    const index = tools.findIndex(tool => tool.id === fromId);
    if (index >= 0) start = index + 1;
  }
  for (let step = 0; step < tools.length; step += 1) {
    const tool = tools[(start + step) % tools.length];
    if (Number(tool.limit) > Number(tool.used)) return tool;
  }
  return null;
}

export function reorder(list, fromIndex, toIndex) {
  const next = list.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function iconForTool(tool) {
  const preset = PRESETS.find(item => item.key === tool?.preset) || presetForUrl(tool?.url || '');
  const letter = String(tool?.name || '?').trim().slice(0, 1).toUpperCase() || '?';
  if (preset) return { src: preset.icon, tile: preset.tile, full: preset.full, remote: '', letter, label: preset.name };
  if (tool?.url) {
    const host = hostOf(tool.url);
    if (host) {
      return {
        src: '',
        tile: '#15182a',
        full: false,
        remote: `https://icon.horse/icon/${encodeURIComponent(host)}`,
        letter,
        label: tool.name || host
      };
    }
  }
  return { src: '', tile: tileColor(tool?.name || letter), full: false, remote: '', letter, label: tool?.name || 'Tool' };
}

function tileColor(name) {
  const colors = ['#123044', '#2a1840', '#143024', '#332410', '#241428'];
  let hash = 0;
  for (const char of String(name)) hash = (hash + char.charCodeAt(0)) % colors.length;
  return colors[hash];
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function cleanFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(file => file && typeof file.name === 'string' && typeof file.text === 'string').map(file => ({ name: file.name, text: file.text }));
}

function handoffHasContent(handoff) {
  if (!handoff) return false;
  if (cleanFiles(handoff.files).length) return true;
  return HANDOFF_KEYS.some(key => typeof handoff[key] === 'string' && handoff[key].trim());
}

export function migrate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid backup: no projects');
  if (!Array.isArray(input.projects) || !input.projects.length) throw new Error('Invalid backup: no projects');
  const projects = input.projects.map(migrateProject);
  const active = projects.some(project => project.id === input.active) ? input.active : projects[0].id;
  const state = {
    version: 3,
    projects,
    active,
    history: Array.isArray(input.history) ? input.history.filter(isHistoryRow).map(row => ({ ...row })) : [],
    onboardingDismissed: input.onboardingDismissed === true
  };
  for (const project of state.projects) {
    if (!project.legacyHandoffLogged && handoffHasContent(project.handoff)) {
      project.legacyHandoffLogged = true;
      state.history.unshift({
        id: uid(),
        projectId: project.id,
        projectName: project.name,
        agentId: '',
        agentName: '',
        status: 'ready',
        kind: 'handoff',
        hopId: '',
        title: project.handoff.goal || project.packet.goal || project.name,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        remoteId: '',
        snapshot: snapshotPacket(project)
      });
    }
  }
  return state;
}

function isHistoryRow(row) {
  return row && typeof row.id === 'string' && typeof row.projectId === 'string';
}

function migrateProject(project) {
  if (!project || typeof project.id !== 'string' || typeof project.name !== 'string' || typeof project.notes !== 'string' || !Array.isArray(project.tools)) {
    throw new Error('Invalid project data');
  }
  if (project.handoff != null && (typeof project.handoff !== 'object' || Array.isArray(project.handoff))) throw new Error('Invalid handoff');
  if (project.handoff?.files != null && (!Array.isArray(project.handoff.files) || !project.handoff.files.every(file => file && typeof file.name === 'string' && typeof file.text === 'string'))) {
    throw new Error('Invalid source files');
  }
  const handoff = emptyHandoff();
  for (const key of HANDOFF_KEYS) handoff[key] = typeof project.handoff?.[key] === 'string' ? project.handoff[key] : '';
  const packetInput = project.packet && typeof project.packet === 'object' && !Array.isArray(project.packet) ? project.packet : {};
  const packet = emptyPacket();
  packet.goal = typeof packetInput.goal === 'string' ? packetInput.goal : '';
  packet.state = typeof packetInput.state === 'string' ? packetInput.state : '';
  packet.decisions = typeof packetInput.decisions === 'string' ? packetInput.decisions : '';
  packet.hops = Array.isArray(packetInput.hops) ? packetInput.hops.filter(hop => hop && typeof hop.id === 'string').map(normalizeHop) : [];
  const files = [];
  const seen = new Set();
  for (const file of [...cleanFiles(packetInput.files), ...cleanFiles(project.handoff?.files)]) {
    const marker = `${file.name}\0${file.text}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    files.push(file);
  }
  packet.files = files;
  handoff.files = files;
  if (!packet.goal && handoff.goal) packet.goal = handoff.goal;
  if (!handoff.goal && packet.goal) handoff.goal = packet.goal;
  const flowInput = project.flow && typeof project.flow === 'object' ? project.flow : {};
  const flow = {
    rules: Array.isArray(flowInput.rules) ? flowInput.rules.filter(rule => rule && typeof rule.id === 'string').map(rule => ({ id: rule.id, text: String(rule.text || '') })) : [],
    steps: Array.isArray(flowInput.steps) ? flowInput.steps.filter(step => step && typeof step.id === 'string').map(step => ({ id: step.id, text: String(step.text || '') })) : []
  };
  return {
    id: project.id,
    name: project.name,
    notes: project.notes,
    tools: project.tools.map(migrateTool),
    handoff,
    packet,
    flow,
    draftHistoryId: typeof project.draftHistoryId === 'string' ? project.draftHistoryId : '',
    legacyHandoffLogged: project.legacyHandoffLogged === true
  };
}

function normalizeHop(hop) {
  return {
    id: hop.id,
    toolId: typeof hop.toolId === 'string' ? hop.toolId : '',
    toolName: typeof hop.toolName === 'string' ? hop.toolName : '',
    toolUrl: typeof hop.toolUrl === 'string' ? hop.toolUrl : '',
    at: typeof hop.at === 'string' ? hop.at : '',
    direction: hop.direction === 'back' ? 'back' : 'out',
    note: typeof hop.note === 'string' ? hop.note : '',
    reply: typeof hop.reply === 'string' ? hop.reply : '',
    repliedAt: typeof hop.repliedAt === 'string' ? hop.repliedAt : '',
    done: hop.done === true,
    checks: hop.checks && typeof hop.checks === 'object' && !Array.isArray(hop.checks) ? { ...hop.checks } : {}
  };
}

function migrateTool(tool) {
  if (!tool || typeof tool.id !== 'string' || typeof tool.name !== 'string' || typeof tool.url !== 'string') throw new Error('Invalid tool data');
  const preset = typeof tool.preset === 'string' && tool.preset ? tool.preset : (presetForUrl(tool.url)?.key || '');
  return {
    id: tool.id,
    name: tool.name,
    url: tool.url,
    limit: asNumber(tool.limit, 0),
    used: asNumber(tool.used, 0),
    active: tool.active === true,
    type: typeof tool.type === 'string' ? tool.type : '',
    creditNotes: typeof tool.creditNotes === 'string' ? tool.creditNotes : '',
    dailyLimit: tool.dailyLimit == null || tool.dailyLimit === '' ? null : asNumber(tool.dailyLimit, 0),
    dailyUsed: asNumber(tool.dailyUsed, 0),
    dailyDay: typeof tool.dailyDay === 'string' ? tool.dailyDay : '',
    hitLimit: tool.hitLimit === true,
    quotaUnit: tool.quotaUnit === 'credits' ? 'credits' : 'messages',
    preset,
    lastHandoffAt: typeof tool.lastHandoffAt === 'string' ? tool.lastHandoffAt : ''
  };
}

export function makeTool({ name, url = '', type = '', creditNotes = '', preset = '' }) {
  return {
    id: uid(),
    name,
    url,
    limit: 0,
    used: 0,
    active: false,
    type,
    creditNotes,
    dailyLimit: null,
    dailyUsed: 0,
    dailyDay: localDay(),
    hitLimit: false,
    quotaUnit: 'messages',
    preset: preset || presetForUrl(url)?.key || '',
    lastHandoffAt: ''
  };
}

export function loadState(raw) {
  if (!raw) return { state: emptyState(), error: null };
  try {
    return { state: migrate(JSON.parse(raw)), error: null };
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'Your saved browser data could not be read. It is still stored in this browser, untouched.'
      : (error.message || 'Your saved browser data could not be read. It is still stored in this browser, untouched.');
    return { state: null, error: message };
  }
}

export function snapshotPacket(project) {
  return {
    goal: project.packet.goal,
    state: project.packet.state,
    decisions: project.packet.decisions,
    notes: project.notes,
    handoff: Object.fromEntries(HANDOFF_KEYS.map(key => [key, project.handoff[key] || ''])),
    files: project.packet.files.map(file => ({ name: file.name, text: file.text })),
    rules: project.flow.rules.map(rule => rule.text).filter(text => text.trim()),
    steps: project.flow.steps.map(step => step.text).filter(text => text.trim()),
    hops: project.packet.hops.map(hop => ({
      id: hop.id,
      toolName: hop.toolName,
      at: hop.at,
      direction: hop.direction,
      note: hop.note,
      reply: hop.reply,
      done: hop.done
    }))
  };
}

export function recordSession(state, project, { status, agent, title, kind }) {
  const now = new Date().toISOString();
  const snapshot = snapshotPacket(project);
  let row = null;
  if (status === 'draft' || status === 'ready') {
    row = state.history.find(item => item.id === project.draftHistoryId) || null;
    if (row && (row.status === 'copied' || row.status === 'shared')) row = null;
  }
  if (!row) {
    row = {
      id: uid(),
      projectId: project.id,
      projectName: project.name,
      agentId: agent?.id || '',
      agentName: agent?.name || '',
      status,
      kind: kind || 'handoff',
      hopId: '',
      title: title || project.packet.goal || project.name,
      createdAt: now,
      updatedAt: now,
      remoteId: '',
      snapshot
    };
    state.history.unshift(row);
    if (status === 'draft' || status === 'ready') project.draftHistoryId = row.id;
    return row;
  }
  row.status = status;
  row.updatedAt = now;
  row.projectName = project.name;
  row.agentId = agent?.id || row.agentId;
  row.agentName = agent?.name || row.agentName;
  row.title = title || row.title;
  row.kind = kind || row.kind;
  row.snapshot = snapshot;
  return row;
}

export function filledRules(project) {
  return project.flow.rules.map(rule => rule.text.trim()).filter(Boolean);
}

export function filledSteps(project) {
  return project.flow.steps.filter(step => step.text.trim());
}

export function canCompleteHop(project, hop) {
  const steps = filledSteps(project);
  if (!steps.length) return { ok: true, missing: [] };
  const missing = steps.filter(step => !hop.checks?.[step.id]);
  return { ok: missing.length === 0, missing };
}

export function buildPrompt(project, { tool } = {}) {
  const rules = filledRules(project);
  const steps = filledSteps(project);
  const lines = [
    'You are continuing an existing project. You cannot see the previous chat. Use only this packet.',
    '',
    `Project: ${project.name}`,
    tool ? `Continue in: ${tool.name}${tool.url ? ` (${tool.url})` : ''}` : '',
    '',
    '## Goal',
    project.packet.goal || project.handoff.goal || '(none yet)',
    '',
    '## Current state',
    project.packet.state || '(none yet)',
    '',
    '## Decisions',
    project.packet.decisions || '(none yet)',
    '',
    '## Must do',
    rules.length ? rules.map(rule => `- ${rule}`).join('\n') : '(none yet)',
    '',
    '## Required checklist',
    steps.length ? steps.map(step => `- [ ] ${step.text}`).join('\n') : '(none yet)',
    steps.length ? 'A person ticks these in AI Agent Relay before the hop can be marked done. Do not skip a required step.' : '',
    '',
    '## Outgoing summary',
    project.handoff.summary || '(none yet)',
    '',
    '## Exact error',
    project.handoff.error || '(none yet)',
    '',
    '## Changes already tried',
    project.handoff.attempts || '(none yet)',
    '',
    '## Relevant source notes',
    project.handoff.source || '(none yet)',
    '',
    '## Links',
    project.handoff.links || '(none yet)',
    '',
    '## Constraints',
    project.handoff.constraints || '(none yet)',
    '',
    '## Next task',
    project.handoff.next || '(none yet)',
    '',
    '## Project notes',
    project.notes || '(none yet)',
    '',
    '## Files',
    project.packet.files.length ? project.packet.files.map(file => `### ${file.name}\n\`\`\`\n${file.text}\n\`\`\``).join('\n\n') : '(none yet)',
    '',
    '## Hop log',
    project.packet.hops.length
      ? project.packet.hops.map((hop, index) => {
        const bits = [`${index + 1}. ${hop.toolName || 'Tool'} · ${hop.direction === 'back' ? 'pasted back' : 'sent'} · ${hop.done ? 'done' : 'open'} · ${hop.at || ''}`];
        if (hop.note) bits.push(hop.note);
        if (hop.reply) bits.push('Reply: ' + hop.reply);
        return bits.join('\n');
      }).join('\n\n')
      : '(no hops yet)',
    '',
    'Continue from here. Do the next task. Keep every decision and every must-do rule. Do not change the constraints.',
    'When you finish, end your reply with a Decisions: section listing any new decisions, then a short summary of what changed.'
  ];
  return lines.filter(line => line !== '').join('\n');
}

export function agentLinkPrompt(url) {
  return `Use this read-only handoff from AI Agent Relay. Open it and continue the work. Do not ask me to paste the old chat.\n\n${url}\n\nFollow the Must do rules and the required checklist in the handoff. When you finish, end with a Decisions: section and a short summary I can paste back into the relay.`;
}

export function mergePaste(packet, text, toolName, now = new Date()) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: 'Paste the reply first.' };
  const stamp = now.toLocaleString();
  packet.state = `${packet.state || ''}\n\n--- ${toolName} · ${stamp} ---\n${body}\n`;
  const match = body.match(/(?:^|\n)\s*decisions?\s*:\s*([\s\S]*)$/i);
  const decisions = match ? match[1].trim() : '';
  if (decisions) packet.decisions = `${packet.decisions ? packet.decisions.replace(/\s*$/, '') + '\n' : ''}${decisions}`;
  return { ok: true, decisionsAdded: Boolean(decisions) };
}

export function lastTouch(project, tool, history) {
  let best = null;
  const consider = (at, title) => {
    if (!at) return;
    if (!best || at > best.at) best = { at, title };
  };
  for (const hop of project.packet.hops) {
    if (hop.toolId !== tool.id) continue;
    consider(hop.repliedAt || hop.at, hop.reply ? 'Reply pasted back' : 'Handoff sent');
  }
  for (const row of history || []) {
    if (row.projectId !== project.id || row.agentId !== tool.id) continue;
    consider(row.updatedAt, row.title || row.status);
  }
  return best;
}

function haystackFor(parts) {
  return parts.filter(Boolean).join('\n').toLowerCase();
}

export function searchSessions(state, filters = {}) {
  const query = String(filters.q || '').trim().toLowerCase();
  const projectId = filters.projectId || '';
  const agent = String(filters.agent || '').trim().toLowerCase();
  const status = filters.status || '';
  const results = [];
  const push = (row, parts) => {
    const hay = haystackFor(parts);
    if (query && !hay.includes(query)) return;
    results.push(row);
  };
  for (const project of state.projects) {
    if (projectId && project.id !== projectId) continue;
    const names = project.tools.map(tool => tool.name.toLowerCase());
    if ((!status || status === 'current') && (!agent || names.includes(agent))) {
      push({
        id: `packet:${project.id}`,
        kind: 'packet',
        status: 'current',
        projectId: project.id,
        projectName: project.name,
        agentName: '',
        title: project.packet.goal || project.name,
        decisions: project.packet.decisions,
        excerpt: excerpt(project.packet.decisions || project.packet.state || project.notes || project.packet.goal, query),
        updatedAt: project.packet.hops.at(-1)?.at || ''
      }, [project.name, project.notes, project.packet.goal, project.packet.state, project.packet.decisions, ...project.flow.rules.map(rule => rule.text), ...project.flow.steps.map(step => step.text), ...project.packet.files.flatMap(file => [file.name, file.text])]);
    }
    for (const hop of project.packet.hops) {
      const hopStatus = hop.done ? 'done' : 'open';
      if (status && status !== hopStatus) continue;
      if (agent && hop.toolName.toLowerCase() !== agent) continue;
      push({
        id: `hop:${hop.id}`,
        kind: 'hop',
        status: hopStatus,
        projectId: project.id,
        projectName: project.name,
        agentName: hop.toolName,
        title: `${hop.toolName} · ${hop.direction === 'back' ? 'pasted back' : 'handoff sent'}`,
        decisions: project.packet.decisions,
        excerpt: excerpt(hop.reply || hop.note || project.packet.decisions, query),
        updatedAt: hop.repliedAt || hop.at,
        hopId: hop.id
      }, [hop.toolName, hop.note, hop.reply, project.packet.decisions, project.name]);
    }
  }
  for (const row of state.history) {
    if (projectId && row.projectId !== projectId) continue;
    if (status && row.status !== status) continue;
    if (agent && String(row.agentName || '').toLowerCase() !== agent) continue;
    const snap = row.snapshot || {};
    push({
      id: `history:${row.id}`,
      kind: 'history',
      status: row.status,
      projectId: row.projectId,
      projectName: row.projectName,
      agentName: row.agentName,
      title: row.title || row.projectName,
      decisions: snap.decisions || '',
      excerpt: excerpt(snap.decisions || snap.state || snap.goal || row.title, query),
      updatedAt: row.updatedAt,
      historyId: row.id
    }, [row.projectName, row.agentName, row.title, row.status, snap.goal, snap.state, snap.decisions, snap.notes, ...(snap.rules || []), ...(snap.steps || []), ...(snap.files || []).flatMap(file => [file.name, file.text])]);
  }
  results.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return results;
}

function excerpt(text, query) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (!query) return value.slice(0, 180);
  const at = value.toLowerCase().indexOf(query);
  if (at < 0) return value.slice(0, 180);
  const start = Math.max(0, at - 40);
  return (start ? '…' : '') + value.slice(start, start + 180);
}

export function explainSupabaseError(error) {
  const message = String(error?.message || error || '');
  const code = String(error?.code || '');
  const blob = `${code} ${message}`;
  if (/get_relay_handoff|relay_handoffs|PGRST202|PGRST205|42P01|schema cache|Could not find the/i.test(blob)) {
    return 'Shared links are not connected yet. In Supabase, open the SQL editor and run supabase/migrations/20261026120000_relay_handoffs.sql from this project. Then try the link again.';
  }
  if (/relay_workspaces/i.test(blob)) {
    return 'Cloud save could not find the relay_workspaces table. Your work is still saved in this browser.';
  }
  return message || 'Supabase returned an error.';
}

export function handoffIdFromLocation(locationLike) {
  const path = String(locationLike?.pathname || '');
  const match = path.match(/^\/h\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (match) return match[1];
  const params = new URLSearchParams(locationLike?.search || '');
  const query = params.get('h') || '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query)) return query;
  return '';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function quotaLabel(tool, now = new Date()) {
  rollQuota(tool, now);
  const unit = tool.quotaUnit === 'credits' ? 'credits' : 'messages';
  if (tool.hitLimit) return `Limit hit today. Resets at midnight (${localDay(now)} is today).`;
  if (tool.dailyLimit == null) return `No daily cap. Used today: ${tool.dailyUsed} ${unit}. Resets at midnight.`;
  const left = Math.max(0, Number(tool.dailyLimit) - Number(tool.dailyUsed));
  return `${left} ${unit} left today of ${tool.dailyLimit}. Used ${tool.dailyUsed}. Resets at midnight.`;
}
