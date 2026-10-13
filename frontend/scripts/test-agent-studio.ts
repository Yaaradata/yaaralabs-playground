/**
 * Tests for the Day 2 Agent Studio's pure logic: stage → sidebar, stage → project type, routing of agents vs old
 * guest projects, "Start from" options, and citation chip parsing.
 * Run: npm run test:agent-studio
 */

import assert from 'node:assert/strict';
import { citedNumbers, citeNumbers, parseAnswer } from '../components/AgentStudio/answerText';
import {
  DAY2_OPTIONS,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  TYPE_STAGE,
  defaultStartFrom,
  sidebarFor,
  stageToType,
  startFromOptions,
} from '../components/AgentStudio/stages';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test('sidebar by stage: no Settings or Teach anywhere', () => {
  assert.deepEqual(sidebarFor('assistant').map((s) => s.id), ['persona', 'guardrails', 'actions']);
  assert.deepEqual(sidebarFor('rag').map((s) => s.id), ['persona', 'guardrails', 'actions', 'knowledge']);
  assert.deepEqual(sidebarFor('agent').map((s) => s.id), ['persona', 'guardrails', 'actions', 'knowledge', 'tools']);
  assert.deepEqual(sidebarFor('agent').map((s) => s.label), ['AI PERSONA', 'RULES & GUARDRAILS', 'ACTIONS', 'KNOWLEDGE BASE', 'TOOLS']);
  assert.equal(sidebarFor('rag')[3].hint, 'The documents it answers from');
});

test('stage → project type, legacy agents stay Custom AI Agents', () => {
  assert.equal(stageToType('assistant'), 'custom-ai-agent');
  assert.equal(stageToType('rag'), 'rag-chatbot');
  assert.equal(stageToType('agent'), 'ai-agent');
  assert.equal(stageToType(undefined), 'custom-ai-agent');
  assert.equal(stageToType(null), 'custom-ai-agent');
  assert.equal(stageToType('legacy'), 'custom-ai-agent');
});

test('create screen: Day 2 options in order, each maps to a stage', () => {
  assert.deepEqual(DAY2_OPTIONS.map(([, label]) => label), ['Custom AI Agent (Ex 6)', 'RAG Chatbot (Ex 7)', 'AI Agent (Ex 8)']);
  assert.deepEqual(DAY2_OPTIONS.map(([type]) => TYPE_STAGE[type]), ['assistant', 'rag', 'agent']);
});

test('routing: agents with a stage open the studio, old guest projects keep their Labs', () => {
  // mirrors app/projects/[userid]/[projectid]/page.tsx
  const opens = (p: { type: string; agent_id?: string; stage?: string | null }) =>
    p.agent_id && p.stage ? 'AgentStudio' : p.type === 'custom-ai-agent' ? 'legacy agent UI'
      : p.type === 'rag-chatbot' && !p.agent_id ? 'RagChatbotLab' : p.type === 'ai-agent' && !p.agent_id ? 'AiAgentLab' : 'other';
  assert.equal(opens({ type: 'rag-chatbot', agent_id: 'AGENT_1', stage: 'rag' }), 'AgentStudio');
  assert.equal(opens({ type: 'custom-ai-agent', agent_id: 'AGENT_2', stage: null }), 'legacy agent UI');
  assert.equal(opens({ type: 'rag-chatbot' }), 'RagChatbotLab');
  assert.equal(opens({ type: 'ai-agent' }), 'AiAgentLab');
});

test('start from: previous stage first, newest first; AI Agent also lists assistants', () => {
  const agents = [
    { agent_id: 'a1', stage: 'assistant', name: 'A1', created_at: '2026-10-01' },
    { agent_id: 'a2', stage: 'assistant', name: 'A2', created_at: '2026-10-02' },
    { agent_id: 'r1', stage: 'rag', name: 'R1', created_at: '2026-10-01' },
  ];
  assert.deepEqual(startFromOptions(agents, 'rag').map((a) => a.agent_id), ['a2', 'a1']);
  assert.deepEqual(startFromOptions(agents, 'agent').map((a) => a.agent_id), ['r1', 'a2', 'a1']);
  assert.equal(defaultStartFrom(agents, 'rag'), 'a2');
  assert.equal(defaultStartFrom(agents, 'agent'), 'r1');
  assert.equal(defaultStartFrom([agents[0]], 'agent'), ''); // no RAG chatbot yet: start fresh
});

test('models: three choices; Flash for AI Agent', () => {
  assert.deepEqual(MODEL_OPTIONS.map(([v]) => v), ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.equal(DEFAULT_MODEL.assistant, 'gemini-2.5-flash-lite');
  assert.equal(DEFAULT_MODEL.agent, 'gemini-2.5-flash');
});

test('citation chips: [2], [1, 3], [2-4], bold, and out-of-range numbers', () => {
  assert.deepEqual(citeNumbers('[1, 3]'), [1, 3]);
  assert.deepEqual(citeNumbers('[2-4]'), [2, 3, 4]);
  const pieces = parseAnswer('Due **23 Sep 2026** [1]. See [2, 5].', 4);
  assert.deepEqual(pieces, [
    { kind: 'text', text: 'Due ' },
    { kind: 'bold', text: '23 Sep 2026' },
    { kind: 'text', text: ' ' },
    { kind: 'cite', n: 1, ok: true },
    { kind: 'text', text: '. See ' },
    { kind: 'cite', n: 2, ok: true },
    { kind: 'cite', n: 5, ok: false },
    { kind: 'text', text: '.' },
  ]);
  assert.deepEqual(citedNumbers('A [2]. B [1, 2]. C [3-4].'), [2, 1, 3, 4]);
  assert.deepEqual(parseAnswer('No citations here.', 0), [{ kind: 'text', text: 'No citations here.' }]);
});

console.log(`\n${passed} tests passed`);
