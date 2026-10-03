import assert from 'node:assert/strict';
import { makeBank, DOMAINS } from '../src/curriculum.mjs';
import { emptyData, questionScore, domainSummary, priorities, sessionCSV, validateBackup, validMetrics, mergeBackup, loadData, csvCell } from '../src/engine.mjs';
import { align, metrics } from '../src/reader/scoring.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const lang of ['en-IN', 'hi-IN']) {
  for (const level of [1, 2, 3]) {
    for (const form of ['A', 'B']) {
      const bank = makeBank(lang, level, form);
      assert.equal(bank.length, 13);
      assert.equal(new Set(bank.map(q => q.id)).size, bank.length);
      assert.deepEqual(new Set(bank.map(q => q.domain)), new Set(DOMAINS.filter(d => d.id !== 'fluency').map(d => d.id)));
      for (const q of bank.filter(q => q.kind === 'choice')) {
        assert.ok(q.answer >= 0 && q.answer < q.options.length);
        assert.equal(questionScore(q, q.answer, false), 2);
        assert.equal(questionScore(q, q.answer, true), 1);
      }
    }
  }
}

const data = emptyData();
data.learners.push({ id: 'l1', code: 'Reader 01' });
const item = makeBank('en-IN', 1, 'A')[0];
data.sessions.push({ id: 's1', learner: 'l1', lang: 'en-IN', level: 1, mode: 'diagnostic', form: 'A', at: '2026-09-12T00:00:00Z', responses: [{ item: item.id, domain: item.domain, score: 1, supported: true, response: 'Supported', note: '', tag: item.tag }] });
data.sessions.push({ id: 'p1', learner: 'l1', lang: 'en-IN', level: 1, mode: 'practice', domain: item.domain, form: 'A', at: '2026-09-12T01:00:00Z', responses: [{ item: item.id, domain: item.domain, score: 2, supported: false, response: 'Practice', note: '', tag: item.tag }] });
const summary = domainSummary(data, 'l1', 'en-IN', 1);
assert.equal(summary.find(d => d.id === item.domain).guided, 1, 'practice must not overwrite diagnostic evidence');
assert.equal(priorities(summary)[0].id, item.domain);
assert.ok(sessionCSV(data, 'l1').includes('Reader 01'));
assert.ok(validateBackup(data));
assert.equal(validateBackup({ ...data, version: 99 }), false);
const reading = {id:'f1', learner:'l1',lang:'en-IN',level:1,mode:'fluency',domain:'fluency',form:'reader',at:'2026-09-12T02:00:00Z',responses:[],seconds:60,passage:'Test reading',metrics:{correct:8,error:1,skipped:1,attempted:10,cwpm:8,accuracy:80}};
assert.ok(validMetrics(reading.metrics,reading.seconds));
assert.equal(validMetrics({...reading.metrics,correct:'<img>'},60),false);
assert.equal(validMetrics({...reading.metrics,cwpm:999},60),false);
const readingData={...data,sessions:[...data.sessions,reading,{...reading,id:'rp1',mode:'practice',at:'2026-09-12T03:00:00Z',metrics:{correct:10,error:0,skipped:0,attempted:10,cwpm:10,accuracy:100}}]};
assert.ok(validateBackup(readingData));
assert.equal(domainSummary(readingData,'l1','en-IN',1).find(d=>d.id==='fluency').latest.id,'f1');
assert.equal(validateBackup({...data,sessions:[...data.sessions,data.sessions[0]]}),false);
assert.throws(()=>mergeBackup(data,{...data,learners:[{id:'l1',code:'A different learner'}]}),/conflict/);
assert.equal(mergeBackup(data,data).sessions.length,data.sessions.length);
assert.throws(()=>loadData({getItem:()=>'{invalid'}));
assert.equal(csvCell('  =SUM(A1:A2)'),'"\'  =SUM(A1:A2)"');
const aligned=align('The cat sat on a mat','The cat sat');
assert.deepEqual(aligned.states,['correct','correct','correct','unread','unread','unread']);
assert.deepEqual(metrics(aligned.states,30),{correct:3,error:0,skipped:0,attempted:3,cwpm:6,accuracy:100});
assert.deepEqual(align('राम घर गया','राम घर').states,['correct','correct','unread']);
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const cloudBootstrap='<script>window.CLOUD_MODE=true;</script>';
assert.ok(html.includes(cloudBootstrap),'Browser-served HTML must enable account-backed storage');
assert.equal((html.replace(cloudBootstrap,'').match(/<\/script>/g)||[]).length,1,'Only the known bootstrap and outer script should be literal markup');
assert.ok(!html.includes('<!-- SCRIPTS -->'));
const bundle=html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:bundle,encoding:'utf8'});
assert.equal(check.status,0,check.stderr);
console.log('Passed: all 156 content items, scoring, reading alignment, practice separation, backup validation, CSV safety, and bundled script syntax.');
