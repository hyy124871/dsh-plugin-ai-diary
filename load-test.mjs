import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL('./src/index.mjs').href);
const calls = [];
const ctx = {
  tools: { register: (t) => calls.push(t.name) },
  get: () => undefined,
  effect: (fn) => fn(),
};
mod.apply(ctx);
console.log('name=' + mod.name + ' inject=' + JSON.stringify(mod.inject));
console.log('tools=' + calls.join(','));
const expected = [
  'ai_diary_topics',
  'ai_diary_plan',
  'ai_diary_render',
  'ai_diary_voice',
  'ai_diary_assets',
  'ai_diary_hailuo',
  'ai_diary_publish',
  'ai_diary_pick',
  'ai_diary_post',
  'ai_diary_comments',
  'ai_diary_local',
  'ai_diary_motion',
  'ai_diary_update',
  'pc_see',
  'pc_act',
];
const missing = expected.filter((n) => !calls.includes(n));
console.log(missing.length ? 'MISSING=' + missing.join(',') : 'ALL ' + expected.length + ' TOOLS OK');
process.exitCode = missing.length ? 1 : 0;
