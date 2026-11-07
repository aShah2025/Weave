// The crew is defined by this template, so these rules are worth a test of their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const yaml = fs.readFileSync(new URL('../switch/weave-room.template.yaml', import.meta.url), 'utf8');

test('the template creates five agents, and only the producer takes notes from anyone', () => {
  const agents = [...yaml.matchAll(/- name: "\{team\}-(\w+)"[\s\S]*?addressing: ([\w-]+)/g)];
  assert.deepEqual(Object.fromEntries(agents.map((m) => [m[1], m[2]])), {
    producer: 'anyone',
    script: 'owner-agents',
    editor: 'owner-agents',
    vfx: 'owner-agents',
    qc: 'owner-agents',
  });
});

test('the producer is told that an agent cannot approve', () => {
  assert.match(yaml, /A cut is final only when a person/);
  assert.match(yaml, /An agent's approval does not count/);
});
