import test from 'node:test';
import assert from 'node:assert/strict';
import {isMonitorPilotEnabled} from '../src/ui/monitorPilotEnabled.js';

test('no muestra piloto sin opt-in de usuario, ni consulta servidor',async()=>{
  let sent=0;
  const available=await isMonitorPilotEnabled({search:'',fetcher:async()=>{
    sent++;return {ok:true,json:async()=>({monitorPilotEnabled:true})};
  }});
  assert.equal(available,false);
  assert.equal(sent,0);
});
test('servidor apagado no muestra el piloto aunque el usuario incluya el enlace',async()=>{
  const yes=await isMonitorPilotEnabled({
    search:'?vigiaMonitorPilot=1',
    fetcher:async()=>({ok:true,json:async()=>({monitorPilotEnabled:false})})
  });
  assert.equal(yes,false);
});
test('solo servidor habilitado mas opt-in muestran el piloto',async()=>{
  const yes=await isMonitorPilotEnabled({
    search:'?vigiaMonitorPilot=1',
    fetcher:async()=>({ok:true,json:async()=>({monitorPilotEnabled:true})})
  });
  assert.equal(yes,true);
});
test('no muestra el piloto si falla red, devuelve 404 o dato invalido',async()=>{
  for(const fetcher of [
    async()=>{throw Error('sin conexión');},
    async()=>({ok:false,json:async()=>({monitorPilotEnabled:true})}),
    async()=>({ok:true,json:async()=>({})})
  ]){
    const result=await isMonitorPilotEnabled({search:'?vigiaMonitorPilot=1',fetcher});
    assert.equal(result,false);
  }
});
