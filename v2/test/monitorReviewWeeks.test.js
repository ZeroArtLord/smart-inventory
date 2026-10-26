import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { recentMonitorWeeks, isSelectableMonitorWeek } from '../src/replenishment/monitorReviewWeeks.js';

test('el lunes 26 permite volver a la revisión del 19 sin fijar la semana vieja',()=>{
  const weeks=recentMonitorWeeks(new Date(2026,9,26,12),8);
  assert.deepEqual(weeks.slice(0,2),['2026-10-26','2026-10-19']);
  assert.equal(isSelectableMonitorWeek('2026-10-19',weeks),true);
  assert.equal(isSelectableMonitorWeek('2026-10-12',weeks),true);
  assert.equal(isSelectableMonitorWeek('2026-11-02',weeks),false);
});

test('el cruce de año conserva lunes sin cambiar por UTC',()=>{
  assert.deepEqual(recentMonitorWeeks(new Date(2027,0,4,12),3),
    ['2027-01-04','2026-12-28','2026-12-21']);
});

test('PWA precarga la búsqueda y selector de semanas al actualizar el piloto',async()=>{
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const handlers={},preloaded=[];
  runInNewContext(sw,{
    self:{addEventListener:(name,handler)=>{handlers[name]=handler;},skipWaiting:async()=>{}},
    caches:{open:async()=>({addAll:async files=>{preloaded.push(...files);}})}
  });
  let installed;
  handlers.install({waitUntil:promise=>{installed=promise;}});
  await installed;
  assert.ok(preloaded.includes('./src/replenishment/monitorProductSearch.js'));
  assert.ok(preloaded.includes('./src/replenishment/monitorReviewWeeks.js'));
});
