import {
  STORAGE_KEY, PRESETS, CAPTURE_PROMPT, loadState, emptyProject, emptyState, makeTool,
  nameFromUrl, coerceUrl, findDuplicate, presetForUrl, providerKind, adapterFor, iconForTool,
  nextInChain, nextByAllowance, rollQuota, quotaLabel, buildPrompt, agentLinkPrompt, mergePaste,
  canCompleteHop, filledSteps, recordSession, searchSessions, lastTouch, explainSupabaseError,
  handoffIdFromLocation, escapeHtml, formatMoney, uid, reorder
} from './relay-core.mjs';

const SUPABASE_URL = 'https://inlqueorerrsmfnaryzj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_j83rvcf4ApFRj9k_ZlzmBw_1CqfaRmj';
const FILE_OK = /\.(txt|md|html|js|jsx|ts|tsx|json|sql|css|py|log|csv)$/i;

let state = null;
let saveBlocked = false;
let corruptRaw = '';
let dbPromise = null;
let nameDirty = false;
let toastTimer = 0;
const ui = { preview: '', q: '', projectId: '', agent: '', status: '', credits: null, creditsLoading: false, blockMessage: '' };

function current() {
  let project = state.projects.find(item => item.id === state.active);
  if (!project) {
    project = state.projects[0];
    state.active = project.id;
  }
  return project;
}

function persist() {
  if (saveBlocked || !state) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    toast('Browser save failed. Export a backup now. ' + error.message);
    return false;
  }
}

function getDb() {
  if (!dbPromise) {
    dbPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY))
      .catch(error => {
        dbPromise = null;
        throw error;
      });
  }
  return dbPromise;
}

function toast(message) {
  const node = document.getElementById('toast');
  node.hidden = false;
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function liveFor(tool) {
  const kind = providerKind(tool);
  if (kind === 'manual') return null;
  return ui.credits?.providers?.[kind] || null;
}

function logoHtml(tool, active) {
  const icon = iconForTool(tool);
  const cls = `logo-tile${active ? ' is-active' : ''}${icon.full ? ' is-full' : ''}`;
  if (icon.src) return `<span class="${cls}" style="background:${icon.tile}"><img src="${escapeHtml(icon.src)}" alt="" width="44" height="44"></span>`;
  if (icon.remote) return `<span class="${cls}" style="background:${icon.tile}"><img src="${escapeHtml(icon.remote)}" alt="" width="44" height="44" data-letter="${escapeHtml(icon.letter)}" referrerpolicy="no-referrer"></span>`;
  return `<span class="${cls}" style="background:${icon.tile}"><span class="letter">${escapeHtml(icon.letter)}</span></span>`;
}

function whenLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function creditInner(tool) {
  const kind = providerKind(tool);
  if (kind === 'manual') {
    return `<p class="badge">Manual</p><p class="muted">No balance API. Manual allowance ${Number(tool.used)} used / ${Number(tool.limit)}. ${escapeHtml(tool.creditNotes || '')}</p>`;
  }
  const live = ui.credits?.providers?.[kind];
  if (!ui.credits) return `<p class="badge">Live</p><p class="muted">Sign in as the owner, then refresh live balances.</p>`;
  if (!live) return `<p class="badge warn">Not connected</p><p class="muted">${escapeHtml(ui.credits.message || 'Live balance is unavailable.')}</p>`;
  if (!live.connected) {
    const label = live.status === 'not_connected' ? 'Not connected' : 'Could not load';
    return `<p class="badge warn">${label}</p><p class="muted">${escapeHtml(live.reason || '')}</p>`;
  }
  const balance = formatMoney(live.balance);
  const burn = typeof live.burnPerHour === 'number' ? `${formatMoney(live.burnPerHour)} / hour` : '';
  return `<p class="badge">Live</p>
    <p>${balance ? `Balance ${escapeHtml(balance)}` : 'No balance number was returned.'}</p>
    <p class="muted">${escapeHtml(live.balanceNote || '')}</p>
    <p>${burn ? `Burn rate ${escapeHtml(burn)}` : escapeHtml(live.burnNote || '')}</p>
    ${live.usedToday != null ? `<p>Used today (UTC) ${escapeHtml(formatMoney(live.usedToday))}</p>` : ''}`;
}

function paintCredits() {
  for (const slot of document.querySelectorAll('[data-credit-for]')) {
    const tool = current()?.tools.find(item => item.id === slot.dataset.creditFor);
    if (tool) slot.innerHTML = creditInner(tool);
  }
  const note = document.getElementById('credits-note');
  if (note) note.textContent = ui.creditsLoading ? 'Checking live balances…' : (ui.credits?.message || 'Live balances load for the signed-in owner only.');
}

function syncDock() {
  const dock = document.getElementById('dock');
  const button = document.getElementById('continue-button');
  const note = document.getElementById('continue-note');
  const publicId = handoffIdFromLocation(location);
  const hide = saveBlocked || !state || Boolean(publicId);
  dock.hidden = hide;
  document.body.classList.toggle('no-dock', hide);
  if (hide || !button) return;
  const project = current();
  for (const tool of project.tools) rollQuota(tool);
  const active = project.tools.find(tool => tool.active);
  const next = nextInChain(project.tools, active?.id || '', liveFor);
  const adapter = next ? adapterFor(next) : null;
  button.textContent = next ? `Continue in ${next.name}` : 'Continue in next tool';
  const honest = 'This page cannot read the other tool’s chat or switch it for you. One tap copies the handoff and opens the next tool.';
  const extra = adapter && adapter.canCallInApp === false ? ` ${adapter.unavailableReason}` : '';
  note.textContent = next ? `Next: ${next.name}. ${quotaLabel(next)} ${honest}${extra}` : `No tool has quota left today. ${honest}`;
}

function onboardHtml(project) {
  if (state.onboardingDismissed) return `<p><button type="button" data-action="show-onboarding">Show setup steps</button></p>`;
  const handed = project.packet.hops.length > 0 || state.history.some(row => row.projectId === project.id && (row.status === 'copied' || row.status === 'shared'));
  const steps = [
    ['Name the project', project.name.trim() ? 'Saved name: ' + project.name : 'Add a name below.', Boolean(project.name.trim())],
    ['Add the tools you hop between', project.tools.length ? `${project.tools.length} in this chain.` : 'Use + Add AI tool.', project.tools.length > 0],
    ['Hand the work off', handed ? 'A handoff is in the history.' : 'Use Continue in next tool, or create a share link.', handed]
  ];
  return `<section class="card" id="setup"><h2>Set up in 3 steps</h2><div class="steps">${steps.map((step, index) => `<div class="step"><b>${step[2] ? 'Done' : index + 1}</b><div><strong>${escapeHtml(step[0])}</strong><p class="fine">${escapeHtml(step[1])}</p></div></div>`).join('')}</div><div class="row"><button type="button" data-action="scroll-to" data-target="tools">Add a tool</button><button type="button" data-action="copy-agent-prompt">Copy the prompt for your agent</button><button type="button" data-action="dismiss-onboarding">Hide setup</button></div></section>`;
}

function projectHtml(project) {
  const options = state.projects.map(item => `<option value="${escapeHtml(item.id)}"${item.id === project.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  return `<section class="card" id="projects"><h2>Projects</h2><label>Project<select id="project-select">${options}</select></label><label>Project name<input id="project-name" value="${escapeHtml(project.name)}" maxlength="120"></label><div class="row"><input id="new-project" placeholder="New project name" maxlength="120"><button type="button" data-action="add-project">Add project</button></div><label>Project notes<textarea id="project-notes">${escapeHtml(project.notes)}</textarea></label></section>`;
}

function packetHtml(project) {
  const files = project.packet.files.map((file, index) => `<p>${escapeHtml(file.name)} (${file.text.length.toLocaleString()} characters) <button type="button" data-action="remove-file" data-index="${index}">Remove</button></p>`).join('');
  return `<section class="card" id="packet"><h2>Living context packet</h2><p class="muted">This packet is what the next tool receives. Decisions stay in their own box so they are not buried in the log.</p><label>Goal<textarea id="packet-goal">${escapeHtml(project.packet.goal)}</textarea></label><label>Current state<textarea id="packet-state">${escapeHtml(project.packet.state)}</textarea></label><label>Decisions<textarea id="packet-decisions">${escapeHtml(project.packet.decisions)}</textarea></label><label>Import text or code files<input id="file-input" type="file" multiple accept=".txt,.md,.html,.js,.jsx,.ts,.tsx,.json,.sql,.css,.py,.log,.csv"></label><p class="fine">Text and code only, under 250 KB each. Review files for secrets before a share link.</p><div id="file-list">${files}</div></section>`;
}

function flowHtml(project) {
  const rules = project.flow.rules.map(rule => `<div class="row"><input data-rule="${escapeHtml(rule.id)}" value="${escapeHtml(rule.text)}" placeholder="Must do…" maxlength="240"><button type="button" data-action="remove-rule" data-id="${escapeHtml(rule.id)}">Remove</button></div>`).join('');
  const steps = project.flow.steps.map(step => `<div class="row"><input data-step="${escapeHtml(step.id)}" value="${escapeHtml(step.text)}" placeholder="Required step…" maxlength="240"><button type="button" data-action="remove-step" data-id="${escapeHtml(step.id)}">Remove</button></div>`).join('');
  const gate = project.flow.steps.some(step => step.text.trim())
    ? 'A hop cannot be marked done until every required step is ticked. You tick them. This page does not watch the other tool.'
    : 'Add a required step if you want a human gate. With no steps, you can mark a hop done yourself.';
  return `<section class="card" id="flow"><h2>Required steps and must-do rules</h2><p class="muted">${escapeHtml(gate)} These lines are injected into every handoff.</p><h3>Must do</h3>${rules}<button type="button" data-action="add-rule">Add a must-do</button><h3>Checklist</h3>${steps}<button type="button" data-action="add-step">Add a required step</button></section>`;
}

function chainHtml(project) {
  const strip = project.tools.length
    ? `<ol class="timeline">${project.tools.map((tool, index) => `<li class="chain-row">${logoHtml(tool, tool.active)}<span>${index + 1}. ${escapeHtml(tool.name)}${tool.active ? ' · in use' : ''}</span></li>`).join('')}</ol>`
    : '<p class="muted">Add a tool and it joins the chain.</p>';
  const hopItems = project.packet.hops.map((hop, index) => {
    const tool = { name: hop.toolName, url: hop.toolUrl, preset: presetForUrl(hop.toolUrl)?.key || '' };
    const steps = filledSteps(project);
    const checks = steps.map(step => `<label class="check"><input type="checkbox" data-action="toggle-check" data-hop="${escapeHtml(hop.id)}" data-step="${escapeHtml(step.id)}"${hop.checks?.[step.id] ? ' checked' : ''}> ${escapeHtml(step.text)}</label>`).join('');
    const gate = canCompleteHop(project, hop);
    const gateText = gate.ok ? 'Checklist clear.' : 'Still needed: ' + gate.missing.map(step => step.text).join(', ');
    return `<li id="hop-${escapeHtml(hop.id)}">${logoHtml(tool, false)}<div><strong>${index + 1}. ${escapeHtml(hop.toolName || 'Tool')}</strong><p class="fine">${hop.direction === 'back' ? 'Pasted back' : 'Handoff sent'} · ${hop.done ? 'done' : 'open'} · ${escapeHtml(whenLabel(hop.at))}</p>${hop.note ? `<p>${escapeHtml(hop.note)}</p>` : ''}${hop.reply ? `<p>${escapeHtml(hop.reply)}</p>` : ''}${hop.direction === 'out' ? checks + `<button type="button" data-action="mark-done" data-hop="${escapeHtml(hop.id)}">Mark hop done</button><p class="fine" data-gate>${escapeHtml(gateText)}</p>` : ''}</div></li>`;
  }).join('');
  const hops = hopItems ? `<ol class="timeline">${hopItems}</ol>` : '<p class="muted">No hops yet. Continue in the next tool and the first hop appears here.</p>';
  const pasteOptions = project.tools.map(tool => `<option value="${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</option>`).join('');
  return `<section class="card" id="chain"><h2>Relay chain</h2>${strip}<h3>Hops</h3>${hops}<h3>Paste back</h3><p class="muted">After the other tool replies, paste its summary here. A Decisions: section is added to Decisions.</p><label>Which tool replied<select id="paste-tool">${pasteOptions}</select></label><label>Reply<textarea id="paste-back" placeholder="Paste the final reply or summary"></textarea></label><div class="row"><button type="button" data-action="paste-back">Merge into the packet</button><button type="button" data-action="capture-copy">Copy summarize-for-handoff prompt</button></div></section>`;
}

function handoffHtml(project) {
  const fields = [['summary', 'Outgoing AI summary'], ['error', 'Exact error and failing workflow'], ['attempts', 'Changes tried and results'], ['source', 'Relevant source notes'], ['links', 'Links'], ['constraints', 'What must not change'], ['next', 'Next specific task']];
  const boxes = fields.map(([key, label]) => `<label>${escapeHtml(label)}<textarea data-handoff="${key}">${escapeHtml(project.handoff[key] || '')}</textarea></label>`).join('');
  const share = [...state.history].find(row => row.projectId === project.id && row.remoteId);
  const url = share ? `${location.origin}/h/${share.remoteId}` : '';
  return `<section class="card" id="handoff"><h2>Complete handoff</h2><p class="muted">Relay cannot read private chats. Get the outgoing summary, then bring it here. Goal and decisions are in the context packet.</p><div class="row"><button type="button" data-action="capture-copy">1. Copy summary request for outgoing AI</button></div>${boxes}<div class="row"><button type="button" data-action="preview">2. Preview full handoff</button><button type="button" data-action="copy-handoff">3. Copy full handoff</button><button type="button" data-action="download-handoff">Download handoff document</button></div><label>Preview<textarea id="preview" readonly placeholder="Preview appears here"></textarea></label><div id="share-block"><button type="button" data-action="share-link">Create a read-only share link</button>${url ? `<p class="fine">Latest link: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><button type="button" data-action="copy-agent-prompt">Copy the prompt for your agent</button>` : '<p class="fine">A share link needs you to be signed in, and the Supabase SQL from the project README. If the table is missing, the button says so.</p>'}</div></section>`;
}

function sessionResultsHtml() {
  const rows = searchSessions(state, { q: ui.q, projectId: ui.projectId, agent: ui.agent, status: ui.status });
  if (!rows.length) return '<p class="muted">Nothing matched. Handoffs, hops, and decisions show up here after you save them.</p>';
  return rows.slice(0, 40).map(row => `<button type="button" class="result" data-action="open-session" data-project="${escapeHtml(row.projectId)}" data-hop="${escapeHtml(row.hopId || '')}"><span><strong>${escapeHtml(row.title || 'Session')}</strong><span class="fine">${escapeHtml(row.projectName)} · ${escapeHtml(row.agentName || 'packet')} · ${escapeHtml(row.status)}</span>${row.decisions ? `<span class="fine">Decisions: ${escapeHtml(row.decisions.slice(0, 160))}</span>` : ''}<span class="fine">${escapeHtml(row.excerpt)}</span></span></button>`).join('');
}

function searchHtml() {
  const projects = ['<option value="">All projects</option>'].concat(state.projects.map(project => `<option value="${escapeHtml(project.id)}"${ui.projectId === project.id ? ' selected' : ''}>${escapeHtml(project.name)}</option>`)).join('');
  const agents = new Set();
  for (const project of state.projects) {
    for (const tool of project.tools) agents.add(tool.name);
    for (const hop of project.packet.hops) if (hop.toolName) agents.add(hop.toolName);
  }
  const agentOptions = ['<option value="">All tools</option>'].concat([...agents].map(name => `<option${ui.agent === name ? ' selected' : ''}>${escapeHtml(name)}</option>`)).join('');
  const statuses = ['', 'current', 'open', 'done', 'draft', 'ready', 'copied', 'shared'].map(status => `<option value="${status}"${ui.status === status ? ' selected' : ''}>${status || 'Any status'}</option>`).join('');
  return `<section class="card" id="sessions"><h2>Search sessions</h2><p class="muted">Searches this browser’s saved packets, decisions, hops, and handoff history across projects.</p><label>Search<input id="session-q" value="${escapeHtml(ui.q)}" placeholder="Decision, error, file, tool…"></label><div class="row"><label>Project<select id="session-project">${projects}</select></label><label>Tool<select id="session-agent">${agentOptions}</select></label><label>Status<select id="session-status">${statuses}</select></label></div><div id="session-results">${sessionResultsHtml()}</div></section>`;
}

function toolsHtml(project) {
  const chips = PRESETS.map(preset => `<button type="button" class="chip" data-action="add-preset" data-key="${preset.key}">${logoHtml({ name: preset.name, url: preset.url, preset: preset.key }, false)}<span>${escapeHtml(preset.name)}${preset.hint ? `<small>${escapeHtml(preset.hint)}</small>` : ''}</span></button>`).join('');
  const options = PRESETS.map(preset => `<option value="${preset.key}">${escapeHtml(preset.name)}</option>`).join('');
  const cards = project.tools.map((tool, index) => {
    const touch = lastTouch(project, tool, state.history);
    const open = tool.url ? `<a class="tool-link" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">Open tool</a>` : '<span class="fine">No website saved.</span>';
    return `<article class="tool-card" data-tool-id="${escapeHtml(tool.id)}"><header>${logoHtml(tool, tool.active)}<div><h3>${escapeHtml(tool.name)}</h3><p class="fine">Chain ${index + 1} of ${project.tools.length}${tool.type ? ' · ' + escapeHtml(tool.type) : ''}${tool.active ? ' · in use' : ''}</p></div><span class="handle" draggable="true" data-drag-id="${escapeHtml(tool.id)}" title="Drag to reorder">⋮⋮</span></header><p class="fine">${touch ? `Last handoff: ${escapeHtml(touch.title)} · ${escapeHtml(whenLabel(touch.at))}` : 'Last handoff: none yet'}</p><div data-credit-for="${escapeHtml(tool.id)}"></div><p class="fine">${escapeHtml(quotaLabel(tool))} This daily counter is what you tap. It is not read from the provider.</p><label>Daily limit<input data-daily="${escapeHtml(tool.id)}" type="number" min="0" step="1" placeholder="No cap" value="${tool.dailyLimit == null ? '' : escapeHtml(tool.dailyLimit)}"></label><label>Used today<input data-used-today="${escapeHtml(tool.id)}" type="number" min="0" step="1" value="${escapeHtml(tool.dailyUsed)}"></label><label>Count as<select data-unit="${escapeHtml(tool.id)}"><option value="messages"${tool.quotaUnit !== 'credits' ? ' selected' : ''}>messages</option><option value="credits"${tool.quotaUnit === 'credits' ? ' selected' : ''}>credits</option></select></label><label>Manual allowance<input data-allowance="${escapeHtml(tool.id)}" type="number" min="0" value="${escapeHtml(tool.limit)}"></label><label>Manual used<input data-used="${escapeHtml(tool.id)}" type="number" min="0" value="${escapeHtml(tool.used)}"></label><div class="row">${open}<button type="button" data-action="quota-plus" data-id="${escapeHtml(tool.id)}">+1 used</button><button type="button" data-action="quota-hit" data-id="${escapeHtml(tool.id)}">I hit the limit</button><button type="button" data-action="quota-clear" data-id="${escapeHtml(tool.id)}">Clear today’s limit flag</button>${index ? `<button type="button" data-action="move-tool" data-id="${escapeHtml(tool.id)}" data-dir="-1">Move up</button>` : ''}${index < project.tools.length - 1 ? `<button type="button" data-action="move-tool" data-id="${escapeHtml(tool.id)}" data-dir="1">Move down</button>` : ''}<button type="button" data-action="make-active" data-id="${escapeHtml(tool.id)}">Make active</button><button type="button" data-action="edit-tool" data-id="${escapeHtml(tool.id)}">Edit</button><button type="button" class="danger" data-action="delete-tool" data-id="${escapeHtml(tool.id)}">Remove</button></div></article>`;
  }).join('');
  return `<section class="card" id="tools"><h2>AI tools and agents</h2><p id="credits-note" class="fine"></p><div class="row"><button type="button" class="primary" id="add-tool" data-action="open-add">+ Add AI tool</button><button type="button" data-action="refresh-credits">Refresh live balances</button><button type="button" data-action="switch-allowance">Switch to next available</button></div><div class="chips">${chips}</div><div class="row"><select id="preset-select">${options}</select><button type="button" data-action="add-preset" data-from="select">Quick add preset</button></div><div class="tool-grid">${cards || '<p class="muted">No tools in this project yet.</p>'}</div></section>`;
}

function backupHtml() {
  return `<section class="card" id="backup"><h2>Backup</h2><div class="row"><button type="button" data-action="backup">Export backup</button></div><label>Restore backup<input id="restore-file" type="file" accept=".json,application/json"></label><p class="fine">Back up before loading cloud data or clearing browser storage. The same browser and website address keep your local projects.</p></section>`;
}

function accountHtml() {
  return `<section class="card" id="account"><h2>Account and sync</h2><p id="account-status">Local mode. Checking the cloud connection…</p><label>Email<input id="email" type="email" autocomplete="email"></label><label>Password<input id="password" type="password" autocomplete="current-password" placeholder="At least 6 characters"></label><div class="row"><button type="button" data-action="signup">Create account</button><button type="button" data-action="login">Sign in</button><button type="button" data-action="logout">Sign out</button><button type="button" data-action="cloud-save">Save to cloud</button><button type="button" data-action="cloud-load">Load from cloud</button></div><p class="fine">Tools, hops, and handoffs save on this device immediately. Save to cloud copies the whole relay. Cloud load replaces this browser’s copy. Use one editing session at a time.</p></section>`;
}

function recoveryHtml() {
  return `<section class="card"><h2>Saved data was not changed</h2><p>${escapeHtml(ui.blockMessage)}</p><div class="row"><button type="button" data-action="download-raw">Download the unread backup</button><button type="button" data-action="replace-corrupt">Start a new relay on this device</button></div></section>`;
}

function publicShell() {
  return `<section class="card" id="public-view"><p class="fine">Read-only handoff</p><h2 id="public-title">Loading handoff…</h2><p id="public-meta" class="muted"></p><p id="public-status" class="warn"></p><h3>Decisions</h3><p id="public-decisions"></p><pre id="public-text"></pre><button type="button" data-action="copy-public">Copy handoff</button> <a href="/">Back to the relay</a></section>`;
}

function render() {
  const root = document.getElementById('app');
  const y = window.scrollY;
  const publicId = handoffIdFromLocation(location);
  if (saveBlocked) {
    root.innerHTML = recoveryHtml();
    syncDock();
    window.scrollTo(0, y);
    return;
  }
  if (publicId) {
    root.innerHTML = publicShell();
    syncDock();
    loadPublic(publicId);
    return;
  }
  let rolled = false;
  for (const tool of current().tools) if (rollQuota(tool)) rolled = true;
  if (rolled) persist();
  root.innerHTML = [onboardHtml(current()), projectHtml(current()), packetHtml(current()), flowHtml(current()), chainHtml(current()), handoffHtml(current()), searchHtml(), toolsHtml(current()), backupHtml(), accountHtml()].join('');
  const preview = document.getElementById('preview');
  if (preview) preview.value = ui.preview;
  const status = document.getElementById('account-status');
  if (status && ui.accountText) status.textContent = ui.accountText;
  syncDock();
  paintCredits();
  window.scrollTo(0, y);
}

async function loadPublic(id) {
  const status = document.getElementById('public-status');
  try {
    const db = await getDb();
    const { data, error } = await db.rpc('get_relay_handoff', { handoff_id: id });
    if (error) throw error;
    if (!data) {
      status.textContent = 'No handoff was found for this link.';
      document.getElementById('public-title').textContent = 'Handoff not found';
      return;
    }
    const payload = data.payload || {};
    document.getElementById('public-title').textContent = data.title || data.project_name || 'Handoff';
    document.getElementById('public-meta').textContent = [data.project_name, data.agent_name, whenLabel(data.created_at)].filter(Boolean).join(' · ');
    document.getElementById('public-decisions').textContent = payload.decisions || 'No decisions were saved on this link.';
    document.getElementById('public-text').textContent = payload.text || '';
    status.textContent = '';
  } catch (error) {
    document.getElementById('public-title').textContent = 'Handoff link unavailable';
    status.textContent = explainSupabaseError(error);
  }
}

function openSheet(tool) {
  nameDirty = Boolean(tool);
  const sheet = document.getElementById('sheet');
  sheet.hidden = false;
  sheet.dataset.id = tool?.id || '';
  document.body.classList.add('sheet-open');
  document.getElementById('sheet-title').textContent = tool ? `Edit ${tool.name}` : 'Add AI tool';
  document.getElementById('sheet-name').value = tool?.name || '';
  document.getElementById('sheet-url').value = tool?.url || '';
  document.getElementById('sheet-type').value = tool?.type || '';
  document.getElementById('sheet-notes').value = tool?.creditNotes || '';
  document.getElementById('sheet-error').hidden = true;
  document.getElementById('sheet-dup').hidden = true;
  document.getElementById('sheet-delete').hidden = !tool;
  updateSheetIcon();
  document.getElementById('sheet-name').focus();
}

function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}

function showSheetError(message) {
  const node = document.getElementById('sheet-error');
  node.hidden = false;
  node.textContent = message;
}

function updateSheetIcon() {
  const coerced = coerceUrl(document.getElementById('sheet-url').value);
  const name = document.getElementById('sheet-name').value.trim() || (coerced.url ? nameFromUrl(coerced.url) : 'Tool');
  document.getElementById('sheet-preview').innerHTML = logoHtml({ name, url: coerced.url || '', preset: presetForUrl(coerced.url || '')?.key || '' }, false);
}

function saveSheet(event) {
  event.preventDefault();
  const nameInput = document.getElementById('sheet-name');
  const urlInput = document.getElementById('sheet-url');
  const type = document.getElementById('sheet-type').value;
  const notes = document.getElementById('sheet-notes').value.trim();
  const editing = document.getElementById('sheet').dataset.id || '';
  const coerced = coerceUrl(urlInput.value);
  if (coerced.error) return showSheetError(coerced.error);
  let name = nameInput.value.trim();
  if (!name && coerced.url) name = nameFromUrl(coerced.url);
  if (!name) return showSheetError('Type a name or paste a website.');
  if (!['', 'chat', 'coding', 'image', 'agent', 'other'].includes(type)) return showSheetError('Pick a type from the list.');
  const dup = findDuplicate(current().tools, { name, url: coerced.url, exceptId: editing });
  if (dup) {
    showSheetError(dup.reason === 'url' ? `You already have ${dup.tool.name} for that website.` : `You already have a tool named ${dup.tool.name}.`);
    const button = document.getElementById('sheet-dup');
    button.hidden = false;
    button.dataset.id = dup.tool.id;
    return;
  }
  if (editing) {
    const tool = current().tools.find(item => item.id === editing);
    if (!tool) return closeSheet();
    tool.name = name;
    tool.url = coerced.url;
    tool.type = type;
    tool.creditNotes = notes;
    tool.preset = presetForUrl(coerced.url)?.key || '';
  } else {
    current().tools.push(makeTool({ name, url: coerced.url, type, creditNotes: notes }));
  }
  persist();
  closeSheet();
  render();
  toast('Saved on this device.');
  persistCloud();
}

async function persistCloud() {
  try {
    const db = await getDb();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;
    const { error } = await db.from('relay_workspaces').upsert({ user_id: user.id, data: state, updated_at: new Date().toISOString() });
    if (error) throw error;
    ui.accountText = `Signed in as ${user.email}. Cloud copy updated.`;
    const status = document.getElementById('account-status');
    if (status) status.textContent = ui.accountText;
  } catch (error) {
    toast('Saved on this device. Cloud save failed: ' + explainSupabaseError(error));
  }
}

function copyNow(text) {
  const box = document.getElementById('copy-fallback');
  box.value = text;
  let synced = false;
  const pending = navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard'));
  try {
    box.classList.add('is-open');
    box.focus();
    box.select();
    synced = document.execCommand('copy');
  } catch {
    synced = false;
  }
  pending.then(() => {
    box.classList.remove('is-open');
    toast('Copied.');
  }).catch(() => {
    box.classList.add('is-open');
    box.focus();
    box.select();
    if (!synced) toast('The handoff is in the text box. Select it and copy.');
  });
  if (synced) box.classList.remove('is-open');
}

function continueNext() {
  const project = current();
  for (const tool of project.tools) rollQuota(tool);
  if (!project.tools.length) {
    toast('Add a tool first.');
    document.getElementById('tools')?.scrollIntoView();
    return;
  }
  const active = project.tools.find(tool => tool.active);
  const next = nextInChain(project.tools, active?.id || '', liveFor);
  if (!next) {
    toast('No tool has quota left today. Raise a daily limit, tap Clear today’s limit flag, or add another tool.');
    return;
  }
  const prompt = buildPrompt(project, { tool: next });
  const popup = next.url ? window.open(next.url, '_blank', 'noopener') : null;
  copyNow(prompt);
  project.packet.hops.push({
    id: uid(), toolId: next.id, toolName: next.name, toolUrl: next.url, at: new Date().toISOString(),
    direction: 'out', note: project.handoff.next || project.packet.goal || '', reply: '', repliedAt: '', done: false, checks: {}
  });
  next.lastHandoffAt = project.packet.hops.at(-1).at;
  project.tools.forEach(tool => { tool.active = tool.id === next.id; });
  recordSession(state, project, { status: 'copied', agent: next, title: project.packet.goal || next.name, kind: 'hop' });
  persist();
  render();
  persistCloud();
  if (!next.url) toast(`${next.name} has no website saved. The handoff text is ready to copy.`);
  else if (!popup) toast(`Pop-up blocked. The handoff is copied. Open ${next.name}: ${next.url}`);
}

function addPreset(key) {
  const preset = PRESETS.find(item => item.key === key);
  if (!preset) return;
  const dup = findDuplicate(current().tools, { name: preset.name, url: preset.url, exceptId: '' });
  if (dup) {
    toast(`${dup.tool.name} is already in this project.`);
    openSheet(dup.tool);
    return;
  }
  current().tools.push(makeTool({ name: preset.name, url: preset.url, preset: preset.key }));
  persist();
  render();
  toast(`${preset.name} added.`);
  persistCloud();
}

function toolById(id) {
  return current().tools.find(tool => tool.id === id);
}

function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button || saveBlocked && !['download-raw', 'replace-corrupt'].includes(button.dataset.action)) return;
  const action = button.dataset.action;
  const project = state ? current() : null;
  if (action === 'scroll-to') document.getElementById(button.dataset.target)?.scrollIntoView();
  if (action === 'dismiss-onboarding') { state.onboardingDismissed = true; persist(); render(); }
  if (action === 'show-onboarding') { state.onboardingDismissed = false; persist(); render(); }
  if (action === 'open-add') openSheet(null);
  if (action === 'edit-tool') openSheet(toolById(button.dataset.id));
  if (action === 'add-preset') addPreset(button.dataset.key || document.getElementById('preset-select').value);
  if (action === 'add-project') {
    const name = document.getElementById('new-project').value.trim();
    if (!name) return toast('Type a project name.');
    const created = emptyProject(name);
    state.projects.push(created);
    state.active = created.id;
    persist();
    render();
    toast('Project added on this device.');
  }
  if (action === 'delete-tool') {
    const tool = toolById(button.dataset.id);
    if (!tool) return;
    if (!confirm(`Remove ${tool.name}? Past handoffs stay in history.`)) return;
    project.tools = project.tools.filter(item => item.id !== tool.id);
    persist();
    closeSheet();
    render();
    toast('Removed on this device.');
    persistCloud();
  }
  if (action === 'move-tool') {
    const index = project.tools.findIndex(tool => tool.id === button.dataset.id);
    const dir = Number(button.dataset.dir);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= project.tools.length) return;
    project.tools = reorder(project.tools, index, target);
    persist();
    render();
  }
  if (action === 'make-active') {
    project.tools.forEach(tool => { tool.active = tool.id === button.dataset.id; });
    persist();
    render();
  }
  if (action === 'quota-plus') {
    const tool = toolById(button.dataset.id);
    rollQuota(tool);
    tool.dailyUsed = Number(tool.dailyUsed) + 1;
    if (tool.dailyLimit != null && tool.dailyUsed >= Number(tool.dailyLimit)) tool.hitLimit = true;
    persist();
    render();
  }
  if (action === 'quota-hit') {
    const tool = toolById(button.dataset.id);
    rollQuota(tool);
    tool.hitLimit = true;
    if (tool.dailyLimit != null) tool.dailyUsed = Math.max(Number(tool.dailyUsed), Number(tool.dailyLimit));
    persist();
    render();
    toast(`${tool.name} is marked out of quota until midnight.`);
  }
  if (action === 'quota-clear') {
    const tool = toolById(button.dataset.id);
    tool.hitLimit = false;
    persist();
    render();
    toast('Cleared the limit flag. If used is still at the daily cap, raise the cap or wait until midnight.');
  }
  if (action === 'switch-allowance') {
    const active = project.tools.find(tool => tool.active);
    const next = nextByAllowance(project.tools, active?.id || '');
    if (!next) return toast('No tool has remaining manual allowance. Enter an allowance higher than used, or use Continue in next tool for today’s quota.');
    project.tools.forEach(tool => { tool.active = tool.id === next.id; });
    persist();
    render();
    toast(`${next.name} is active. Copy the handoff and paste it into that chat.`);
  }
  if (action === 'add-rule') { project.flow.rules.push({ id: uid(), text: '' }); persist(); render(); }
  if (action === 'remove-rule') { project.flow.rules = project.flow.rules.filter(rule => rule.id !== button.dataset.id); persist(); render(); }
  if (action === 'add-step') { project.flow.steps.push({ id: uid(), text: '' }); persist(); render(); }
  if (action === 'remove-step') { project.flow.steps = project.flow.steps.filter(step => step.id !== button.dataset.id); persist(); render(); }
  if (action === 'mark-done') {
    const hop = project.packet.hops.find(item => item.id === button.dataset.hop);
    if (!hop) return;
    const gate = canCompleteHop(project, hop);
    if (!gate.ok) return toast('Still needed before this hop can be marked done: ' + gate.missing.map(step => step.text).join(', '));
    hop.done = true;
    persist();
    render();
    toast('Hop marked done.');
    persistCloud();
  }
  if (action === 'continue') continueNext();
  if (action === 'paste-back') {
    const text = document.getElementById('paste-back').value;
    const tool = toolById(document.getElementById('paste-tool').value) || project.tools.find(item => item.active) || project.tools[0];
    const merged = mergePaste(project.packet, text, tool?.name || 'Tool');
    if (!merged.ok) return toast(merged.error);
    let hop = [...project.packet.hops].reverse().find(item => item.direction === 'out' && !item.reply && (!tool || item.toolId === tool.id));
    if (!hop) {
      hop = { id: uid(), toolId: tool?.id || '', toolName: tool?.name || 'Tool', toolUrl: tool?.url || '', at: new Date().toISOString(), direction: 'back', note: '', reply: '', repliedAt: '', done: false, checks: {} };
      project.packet.hops.push(hop);
    }
    hop.reply = text.trim();
    hop.repliedAt = new Date().toISOString();
    recordSession(state, project, { status: 'ready', agent: tool, title: 'Pasted back', kind: 'paste' });
    persist();
    render();
    toast(merged.decisionsAdded ? 'Merged into the packet, including Decisions.' : 'Merged into the current state.');
    persistCloud();
  }
  if (action === 'capture-copy') copyNow(CAPTURE_PROMPT);
  if (action === 'preview') {
    ui.preview = buildPrompt(project, { tool: project.tools.find(tool => tool.active) });
    recordSession(state, project, { status: 'ready', agent: project.tools.find(tool => tool.active), title: project.packet.goal || project.name });
    persist();
    render();
    toast('Preview ready.');
  }
  if (action === 'copy-handoff' || action === 'download-handoff') {
    const text = buildPrompt(project, { tool: project.tools.find(tool => tool.active) });
    if (action === 'copy-handoff') copyNow(text);
    else downloadText(text, `handoff-${project.name.replace(/[^\w.-]+/g, '-') || 'relay'}.md`);
    recordSession(state, project, { status: 'copied', agent: project.tools.find(tool => tool.active), title: project.packet.goal || project.name });
    persist();
  }
  if (action === 'share-link') shareLink();
  if (action === 'copy-agent-prompt') copyAgentPrompt();
  if (action === 'copy-public') {
    const text = document.getElementById('public-text')?.textContent || '';
    if (!text.trim()) return toast('There is no handoff text to copy on this page.');
    copyNow(text);
  }
  if (action === 'refresh-credits') refreshCredits();
  if (action === 'backup') downloadText(JSON.stringify(state, null, 2), 'ai-agent-relay-backup.json');
  if (action === 'signup') auth('signup');
  if (action === 'login') auth('login');
  if (action === 'logout') logout();
  if (action === 'cloud-save') cloudSave(true);
  if (action === 'cloud-load') cloudLoad();
  if (action === 'remove-file') {
    project.packet.files.splice(Number(button.dataset.index), 1);
    persist();
    render();
  }
  if (action === 'open-session') {
    state.active = button.dataset.project;
    ui.projectId = '';
    persist();
    render();
    const hop = button.dataset.hop ? document.getElementById(`hop-${button.dataset.hop}`) : document.getElementById('packet');
    hop?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  if (action === 'download-raw') downloadText(corruptRaw, 'ai-agent-relay-unread-backup.txt');
  if (action === 'replace-corrupt') {
    if (!confirm('This replaces the unreadable saved data with a new project. Download the old data first if you might need it.')) return;
    state = emptyState();
    saveBlocked = false;
    persist();
    render();
  }
}

function onInput(event) {
  if (saveBlocked || !state) return;
  const project = current();
  const target = event.target;
  if (target.id === 'project-name') {
    project.name = target.value;
    const option = document.querySelector(`#project-select option[value="${CSS.escape(project.id)}"]`);
    if (option) option.textContent = target.value;
    persist();
  }
  if (target.id === 'project-notes') { project.notes = target.value; persist(); }
  if (target.id === 'packet-goal') { project.packet.goal = target.value; project.handoff.goal = target.value; persist(); }
  if (target.id === 'packet-state') { project.packet.state = target.value; persist(); }
  if (target.id === 'packet-decisions') { project.packet.decisions = target.value; persist(); }
  if (target.dataset.handoff) { project.handoff[target.dataset.handoff] = target.value; persist(); }
  if (target.dataset.rule) {
    const rule = project.flow.rules.find(item => item.id === target.dataset.rule);
    if (rule) rule.text = target.value;
    persist();
  }
  if (target.dataset.step) {
    const step = project.flow.steps.find(item => item.id === target.dataset.step);
    if (step) step.text = target.value;
    persist();
  }
  if (target.id === 'session-q') {
    ui.q = target.value;
    document.getElementById('session-results').innerHTML = sessionResultsHtml();
  }
  if (target.id === 'sheet-name') {
    nameDirty = true;
    updateSheetIcon();
  }
  if (target.id === 'sheet-url') {
    const coerced = coerceUrl(target.value);
    if ((!nameDirty || !document.getElementById('sheet-name').value.trim()) && coerced.url) {
      const guessed = nameFromUrl(coerced.url);
      if (guessed) document.getElementById('sheet-name').value = guessed;
    }
    updateSheetIcon();
  }
}

function setNumber(tool, key, raw, label) {
  if (raw === '' && key === 'dailyLimit') {
    tool.dailyLimit = null;
    persist();
    render();
    return;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return toast(`${label} must be zero or more.`);
  tool[key] = value;
  if (key === 'dailyUsed' && tool.dailyLimit != null && value >= Number(tool.dailyLimit)) tool.hitLimit = true;
  persist();
  render();
}

function onChange(event) {
  if (saveBlocked || !state) return;
  const project = current();
  const target = event.target;
  if (target.id === 'project-select') { state.active = target.value; persist(); render(); }
  if (target.id === 'restore-file') restore(target.files[0]);
  if (target.id === 'file-input') importFiles(target.files);
  if (target.id === 'session-project' || target.id === 'session-agent' || target.id === 'session-status') {
    ui.projectId = document.getElementById('session-project').value;
    ui.agent = document.getElementById('session-agent').value;
    ui.status = document.getElementById('session-status').value;
    document.getElementById('session-results').innerHTML = sessionResultsHtml();
  }
  if (target.dataset.daily != null) setNumber(toolById(target.dataset.daily), 'dailyLimit', target.value, 'Daily limit');
  if (target.dataset.usedToday != null) setNumber(toolById(target.dataset.usedToday), 'dailyUsed', target.value, 'Used today');
  if (target.dataset.allowance != null) setNumber(toolById(target.dataset.allowance), 'limit', target.value, 'Allowance');
  if (target.dataset.used != null) setNumber(toolById(target.dataset.used), 'used', target.value, 'Used');
  if (target.dataset.unit) {
    const tool = toolById(target.dataset.unit);
    tool.quotaUnit = target.value === 'credits' ? 'credits' : 'messages';
    persist();
    render();
  }
  if (target.dataset.action === 'toggle-check') {
    const hop = project.packet.hops.find(item => item.id === target.dataset.hop);
    if (!hop) return;
    hop.checks[target.dataset.step] = target.checked;
    persist();
    const gate = canCompleteHop(project, hop);
    const note = target.closest('li')?.querySelector('[data-gate]');
    if (note) note.textContent = gate.ok ? 'Checklist clear.' : 'Still needed: ' + gate.missing.map(step => step.text).join(', ');
  }
}

async function importFiles(list) {
  const input = document.getElementById('file-input');
  try {
    const pending = [];
    for (const file of list || []) {
      if (file.size > 250000) throw new Error('Each text file must be under 250 KB.');
      if (!FILE_OK.test(file.name)) throw new Error('Text and code files only.');
      const text = await file.text();
      if (text.includes('\u0000') || text.includes('\ufffd')) throw new Error('Unreadable text file: ' + file.name);
      pending.push({ name: file.name, text });
    }
    const total = [...current().packet.files, ...pending].reduce((sum, file) => sum + file.text.length, 0);
    if (total > 1000000) throw new Error('Keep total imported text below one million characters.');
    current().packet.files.push(...pending);
    persist();
    render();
    toast('Source text imported. Review it for secrets before sharing.');
  } catch (error) {
    toast(error.message);
  } finally {
    if (input) input.value = '';
  }
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restore(file) {
  if (!file) return;
  try {
    const loaded = loadState(await file.text());
    if (!loaded.state) throw new Error(loaded.error || 'Invalid backup');
    if (!confirm('Replace this browser’s relay data with this backup?')) return;
    state = loaded.state;
    saveBlocked = false;
    persist();
    render();
    toast('Backup restored on this device.');
  } catch (error) {
    toast(error.message);
  } finally {
    const input = document.getElementById('restore-file');
    if (input) input.value = '';
  }
}

async function auth(mode) {
  try {
    const db = await getDb();
    const credentials = { email: document.getElementById('email').value.trim(), password: document.getElementById('password').value };
    const { error } = mode === 'signup' ? await db.auth.signUp(credentials) : await db.auth.signInWithPassword(credentials);
    if (error) throw error;
    document.getElementById('password').value = '';
    await refreshAccount();
    if (mode === 'signup') toast('Account created. Check your email if a confirmation link is required.');
  } catch (error) {
    toast(error.message || 'Sign-in failed.');
  }
}

async function logout() {
  try {
    const db = await getDb();
    await db.auth.signOut();
    ui.credits = null;
    await refreshAccount();
    render();
  } catch (error) {
    toast(error.message || 'Sign-out failed.');
  }
}

async function refreshAccount() {
  try {
    const db = await getDb();
    const { data: { user } } = await db.auth.getUser();
    ui.accountText = user ? `Signed in as ${user.email}. Save and Load copy this browser’s data.` : 'Local mode. Sign in when you want a cloud copy.';
    const status = document.getElementById('account-status');
    if (status) status.textContent = ui.accountText;
    if (user) refreshCredits();
    else paintCredits();
  } catch {
    ui.accountText = 'Cloud is unavailable. This device still saves your work.';
    const status = document.getElementById('account-status');
    if (status) status.textContent = ui.accountText;
  }
}

async function cloudSave(ask) {
  try {
    const db = await getDb();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return toast('Sign in first.');
    if (ask && !confirm('Overwrite your cloud copy with this browser data?')) return;
    const { error } = await db.from('relay_workspaces').upsert({ user_id: user.id, data: state, updated_at: new Date().toISOString() });
    if (error) throw error;
    toast('Saved to cloud.');
  } catch (error) {
    toast(explainSupabaseError(error));
  }
}

async function cloudLoad() {
  try {
    const db = await getDb();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return toast('Sign in first.');
    if (!confirm('Replace this browser’s data with your cloud copy? Export a backup first if you need this copy.')) return;
    const { data, error } = await db.from('relay_workspaces').select('data').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data?.data) return toast('No cloud copy yet.');
    const loaded = loadState(JSON.stringify(data.data));
    if (!loaded.state) return toast(loaded.error);
    state = loaded.state;
    persist();
    render();
    toast('Loaded from cloud onto this device.');
  } catch (error) {
    toast(explainSupabaseError(error));
  }
}

async function shareLink() {
  const project = current();
  if (!confirm('Anyone with the link can read this handoff, including notes and files. Create it?')) return;
  try {
    const db = await getDb();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return toast('Sign in first. The link is stored in your Supabase account.');
    const text = buildPrompt(project, { tool: project.tools.find(tool => tool.active) });
    const { data, error } = await db.from('relay_handoffs').insert({
      user_id: user.id,
      project_name: project.name,
      agent_name: project.tools.find(tool => tool.active)?.name || '',
      title: project.packet.goal || project.name,
      status: 'shared',
      payload: { text, decisions: project.packet.decisions, rules: project.flow.rules.map(rule => rule.text).filter(Boolean), steps: filledSteps(project).map(step => step.text) }
    }).select('id').single();
    if (error) throw error;
    const row = recordSession(state, project, { status: 'shared', agent: project.tools.find(tool => tool.active), title: project.packet.goal || project.name, kind: 'share' });
    row.remoteId = data.id;
    persist();
    render();
    toast('Link ready. Copy the prompt for your agent.');
    persistCloud();
  } catch (error) {
    toast(explainSupabaseError(error));
  }
}

function copyAgentPrompt() {
  const project = state ? current() : null;
  const share = project && [...state.history].find(row => row.projectId === project.id && row.remoteId);
  if (!share) {
    toast('Create a share link first. The prompt includes that link.');
    document.getElementById('share-block')?.scrollIntoView();
    return;
  }
  copyNow(agentLinkPrompt(`${location.origin}/h/${share.remoteId}`));
}

async function refreshCredits() {
  ui.creditsLoading = true;
  paintCredits();
  try {
    const db = await getDb();
    const { data } = await db.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      ui.credits = { ok: false, message: 'Sign in as the owner to load live balances.', providers: null };
      return;
    }
    const response = await fetch('/api/credits', { headers: { authorization: `Bearer ${token}` } });
    ui.credits = await response.json();
  } catch {
    ui.credits = { ok: false, message: 'Live balances could not be loaded from /api/credits.', providers: null };
  } finally {
    ui.creditsLoading = false;
    paintCredits();
    syncDock();
  }
}

let dragId = '';

function bind() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.getElementById('sheet-form').addEventListener('submit', saveSheet);
  document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
  document.getElementById('sheet-delete').addEventListener('click', () => {
    const id = document.getElementById('sheet').dataset.id;
    const tool = id && toolById(id);
    if (!tool) return;
    if (!confirm(`Remove ${tool.name}? Past handoffs stay in history.`)) return;
    current().tools = current().tools.filter(item => item.id !== tool.id);
    persist();
    closeSheet();
    render();
    toast('Removed on this device.');
    persistCloud();
  });
  document.getElementById('sheet-dup').addEventListener('click', () => {
    const tool = toolById(document.getElementById('sheet-dup').dataset.id);
    if (tool) openSheet(tool);
  });
  document.getElementById('sheet').addEventListener('click', event => {
    if (event.target.id === 'sheet') closeSheet();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('sheet').hidden) closeSheet();
  });
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.letter) return;
    const tile = image.closest('.logo-tile');
    if (!tile || tile.querySelector('.letter')) return;
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = image.dataset.letter;
    image.replaceWith(letter);
  }, true);
  document.addEventListener('dragstart', event => {
    const handle = event.target.closest?.('[data-drag-id]');
    if (!handle) return;
    dragId = handle.dataset.dragId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragId);
  });
  document.addEventListener('dragover', event => {
    if (!dragId || !event.target.closest?.('[data-tool-id]')) return;
    event.preventDefault();
  });
  document.addEventListener('drop', event => {
    const card = event.target.closest?.('[data-tool-id]');
    if (!card || !dragId || saveBlocked) return;
    event.preventDefault();
    const tools = current().tools;
    const from = tools.findIndex(tool => tool.id === dragId);
    const to = tools.findIndex(tool => tool.id === card.dataset.toolId);
    dragId = '';
    if (from < 0 || to < 0 || from === to) return;
    current().tools = reorder(tools, from, to);
    persist();
    render();
  });
}

function startHero() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  let width = 0;
  let height = 0;
  let particles = [];
  let running = true;
  let frame = 0;
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(width < 700 ? 28 : 54, 54);
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - .5) * .35,
      vy: (Math.random() - .5) * .35,
      color: ['#3df0ff', '#ff3bd4', '#c6ff4d'][Math.floor(Math.random() * 3)]
    }));
  };
  const draw = () => {
    if (!running) {
      frame = 0;
      return;
    }
    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (particle.x < 0 || particle.x > width) particle.vx *= -1;
      if (particle.y < 0 || particle.y > height) particle.vy *= -1;
      context.fillStyle = particle.color;
      context.globalAlpha = .75;
      context.beginPath();
      context.arc(particle.x, particle.y, 1.6, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = .18;
    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const a = particles[i];
        const b = particles[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 92) {
          context.strokeStyle = a.color;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;
    frame = requestAnimationFrame(draw);
  };
  const ensure = () => { if (running && !frame) frame = requestAnimationFrame(draw); };
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    ensure();
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      running = entries[0].isIntersecting && !document.hidden;
      ensure();
    });
    observer.observe(canvas);
  }
  ensure();
}

function boot() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const loaded = loadState(raw);
  if (loaded.error) {
    saveBlocked = true;
    corruptRaw = raw || '';
    ui.blockMessage = loaded.error;
  } else {
    state = loaded.state;
    persist();
  }
  bind();
  startHero();
  render();
  if (!saveBlocked && !handoffIdFromLocation(location)) refreshAccount();
}

boot();
