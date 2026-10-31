import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, migrate, loadState, makeTool, nameFromUrl, iconForTool, findDuplicate,
  nextInChain, nextByAllowance, toolHasQuota, rollQuota, buildPrompt, mergePaste,
  canCompleteHop, searchSessions, recordSession, emptyState, explainSupabaseError,
  handoffIdFromLocation, providerKind, adapterFor, quotaLabel,
  GUIDE_STEPS, currentGuideStep, advanceGuideState, confirmGuideStep, skipGuideStep, resetGuide
} from './relay-core.mjs';

test('keeps an older saved relay and does not invent history twice', () => {
  const old = {
    projects: [{
      id: 'p1',
      name: 'My first project',
      notes: 'keep these notes',
      tools: [{ id: 't1', name: 'ChatGPT', url: 'https://chatgpt.com', limit: 10, used: 3, active: true }],
      handoff: { goal: 'ship the relay', summary: 'halfway', files: [{ name: 'app.js', text: 'console.log(1)' }] }
    }],
    active: 'p1'
  };
  const once = migrate(old);
  assert.equal(once.projects[0].notes, 'keep these notes');
  assert.equal(once.projects[0].tools[0].limit, 10);
  assert.equal(once.projects[0].tools[0].used, 3);
  assert.equal(once.projects[0].tools[0].preset, 'chatgpt');
  assert.equal(once.projects[0].packet.goal, 'ship the relay');
  assert.equal(once.projects[0].packet.files[0].text, 'console.log(1)');
  assert.equal(once.projects[0].handoff.files, once.projects[0].packet.files);
  assert.equal(once.history.length, 1);
  const twice = migrate(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.history.length, 1);
  assert.equal(twice.projects[0].notes, 'keep these notes');
});

test('refuses unreadable saves instead of replacing them', () => {
  const broken = loadState('{');
  assert.equal(broken.state, null);
  assert.match(broken.error, /untouched/);
  const invalid = loadState(JSON.stringify({ projects: [] }));
  assert.equal(invalid.state, null);
});

test('screenshot tools resolve to real icon files', () => {
  for (const name of ['ChatGPT', 'Base44', 'Cursor', 'Buffer', 'Linear', 'Replit', 'Perplexity', 'Link']) {
    const preset = PRESETS.find(item => item.name === name);
    assert.ok(preset, name);
    assert.match(preset.icon, /^\/icons\//);
    const tool = makeTool({ name, url: preset.url });
    assert.equal(iconForTool(tool).src, preset.icon);
  }
  assert.equal(nameFromUrl('https://cursor.com/agents'), 'Cursor');
  assert.equal(nameFromUrl('notion.so'), 'Notion');
});

test('daily quota resets on the next local day and blocks a spent tool', () => {
  const tool = makeTool({ name: 'Cursor', url: 'https://cursor.com' });
  tool.dailyLimit = 2;
  tool.dailyUsed = 2;
  tool.dailyDay = '2020-01-01';
  tool.hitLimit = true;
  const later = new Date(2026, 9, 26, 15, 0, 0);
  assert.equal(rollQuota(tool, later), true);
  assert.equal(tool.dailyUsed, 0);
  assert.equal(tool.hitLimit, false);
  assert.equal(toolHasQuota(tool, null, later), true);
  tool.dailyUsed = 2;
  assert.equal(toolHasQuota(tool, null, later), false);
  tool.dailyUsed = 0;
  tool.hitLimit = true;
  assert.equal(toolHasQuota(tool, null, later), false);
  tool.hitLimit = false;
  assert.equal(toolHasQuota(tool, { connected: true, balance: 0 }, later), false);
  assert.equal(toolHasQuota(tool, { connected: true, balance: null }, later), true);
  assert.match(quotaLabel(tool, later), /left today|No daily cap|Limit hit/);
});

test('chains four tools and then stops when every quota is spent', () => {
  const tools = ['A', 'B', 'C', 'D'].map(name => makeTool({ name, url: `https://${name.toLowerCase()}.example.com` }));
  let from = '';
  const seen = [];
  for (let hop = 0; hop < 4; hop += 1) {
    const next = nextInChain(tools, from, () => null);
    assert.ok(next);
    seen.push(next.name);
    from = next.id;
  }
  assert.deepEqual(seen, ['A', 'B', 'C', 'D']);
  for (const tool of tools) tool.hitLimit = true;
  assert.equal(nextInChain(tools, from, () => null), null);
  tools[1].limit = 5;
  tools[1].used = 1;
  assert.equal(nextByAllowance(tools, tools[0].id).name, 'B');
});

test('prompt carries decisions, must-do rules, and the hop log', () => {
  const state = emptyState();
  const project = state.projects[0];
  project.packet.goal = 'Ship handoffs';
  project.packet.decisions = 'Keep the local save key.';
  project.flow.rules.push({ id: 'r1', text: 'Do not invent balances' });
  project.flow.steps.push({ id: 's1', text: 'Read the packet' });
  project.packet.hops.push({ id: 'h1', toolId: 't', toolName: 'ChatGPT', toolUrl: '', at: '2026-10-26T00:00:00.000Z', direction: 'out', note: 'first hop', reply: '', repliedAt: '', done: false, checks: {} });
  const prompt = buildPrompt(project, { tool: { name: 'Cursor', url: 'https://cursor.com' } });
  assert.match(prompt, /Keep the local save key/);
  assert.match(prompt, /Do not invent balances/);
  assert.match(prompt, /Read the packet/);
  assert.match(prompt, /ChatGPT/);
  assert.match(prompt, /Decisions:/);
  const gate = canCompleteHop(project, project.packet.hops[0]);
  assert.equal(gate.ok, false);
  project.packet.hops[0].checks.s1 = true;
  assert.equal(canCompleteHop(project, project.packet.hops[0]).ok, true);
});

test('paste back merges state and a decisions section', () => {
  const state = emptyState();
  const packet = state.projects[0].packet;
  const result = mergePaste(packet, 'Shipped the button.\nDecisions:\nUse one continue button.', 'Cursor', new Date('2026-10-26T12:00:00Z'));
  assert.equal(result.ok, true);
  assert.equal(result.decisionsAdded, true);
  assert.match(packet.state, /Shipped the button/);
  assert.match(packet.decisions, /Use one continue button/);
});

test('search finds decisions across projects and filters by agent and status', () => {
  const state = emptyState();
  const first = state.projects[0];
  first.name = 'Alpha';
  first.packet.decisions = 'periwinkle-decision stays';
  first.tools.push(makeTool({ name: 'Cursor', url: 'https://cursor.com' }));
  first.packet.hops.push({ id: 'h1', toolId: first.tools[0].id, toolName: 'Cursor', toolUrl: 'https://cursor.com', at: '2026-10-26T01:00:00.000Z', direction: 'out', note: 'hop one', reply: '', repliedAt: '', done: false, checks: {} });
  const second = {
    ...first,
    id: 'p2',
    name: 'Beta',
    packet: { goal: '', state: '', decisions: 'other-decision', files: [], hops: [] },
    handoff: first.handoff,
    tools: [makeTool({ name: 'Claude', url: 'https://claude.ai' })],
    flow: { rules: [], steps: [] }
  };
  second.handoff = { goal: '', summary: '', error: '', attempts: '', source: '', links: '', constraints: '', next: '', files: [] };
  second.packet.files = second.handoff.files;
  state.projects.push(second);
  recordSession(state, first, { status: 'copied', agent: first.tools[0], title: 'Alpha copy' });
  const all = searchSessions(state, { q: 'periwinkle-decision' });
  assert.ok(all.some(row => row.projectName === 'Alpha'));
  assert.equal(all.some(row => row.projectName === 'Beta'), false);
  const byAgent = searchSessions(state, { agent: 'Cursor', status: 'open' });
  assert.ok(byAgent.every(row => row.agentName === 'Cursor' && row.status === 'open'));
  const copied = searchSessions(state, { projectId: first.id, status: 'copied' });
  assert.ok(copied.some(row => row.title === 'Alpha copy'));
});

test('duplicates and provider kinds stay honest', () => {
  const tools = [makeTool({ name: 'RunPod', url: 'https://www.runpod.io/console' })];
  assert.equal(providerKind(tools[0]), 'runpod');
  assert.equal(adapterFor(tools[0]).canCallInApp, false);
  assert.equal(providerKind(makeTool({ name: 'DeepSeek', url: 'https://chat.deepseek.com' })), 'manual');
  assert.equal(providerKind(makeTool({ name: 'Boundless', url: 'https://boundless.network' })), 'manual');
  const dup = findDuplicate(tools, { name: 'Other', url: 'https://runpod.io/console', exceptId: '' });
  assert.equal(dup.reason, 'url');
  assert.match(explainSupabaseError({ code: 'PGRST205', message: 'Could not find the table public.relay_handoffs' }), /SQL/);
  assert.equal(handoffIdFromLocation({ pathname: '/h/11111111-1111-1111-1111-111111111111', search: '' }), '11111111-1111-1111-1111-111111111111');
  assert.equal(handoffIdFromLocation({ pathname: '/', search: '?h=11111111-1111-1111-1111-111111111111' }), '11111111-1111-1111-1111-111111111111');
});

test('walkthrough stays on one step until that step is ready', () => {
  let state = emptyState();
  const project = state.projects[0];
  assert.equal(state.guide.stepId, 'project');
  assert.equal(currentGuideStep(state, project).progress.ready, false);
  assert.equal(GUIDE_STEPS[0].id, 'project');

  state = confirmGuideStep(state, 'project');
  assert.equal(state.guide.stepId, 'tools');
  assert.equal(currentGuideStep(state, project).step.id, 'tools');

  project.tools.push(makeTool({ name: 'Cursor', url: 'https://cursor.com' }));
  let advanced = advanceGuideState(state, project);
  state = advanced.state;
  assert.equal(advanced.advanced, true);
  assert.equal(state.guide.stepId, 'packet');

  project.packet.goal = 'Ship the guide';
  project.packet.state = 'Guide tab in progress';
  project.packet.decisions = 'none yet';
  advanced = advanceGuideState(state, project);
  state = advanced.state;
  assert.equal(state.guide.stepId, 'flow');

  state = skipGuideStep(state, 'flow');
  assert.equal(state.guide.stepId, 'handoff');
  assert.equal(state.guide.skipped.flow, true);

  state = resetGuide(state);
  assert.equal(state.guide.stepId, 'project');
  assert.equal(state.guide.completed, false);
  assert.deepEqual(migrate({ ...state, guide: undefined }).guide.stepId, 'project');
});
