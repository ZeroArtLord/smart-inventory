import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMonitorPilotSession } from '../src/replenishment/monitorPilotSession.js';

const access = () => ({
  user:{ id:'member-1',externalAuthId:'firebase-user-1' },
  selectedWorkspace:{id:'workspace-a',roleCode:'WAREHOUSE',permissions:['purchases.write']}
});
const args = {
  online:()=>false,
  syncConfig:async()=>({authMode:'firebase',workspaceId:'workspace-a'}),
  logoutLock:async()=>null,
  offlineAccess:async()=>access(),
  liveSession:async()=>{throw new Error('Must not call live API offline');}
};

test('reabre el piloto con acceso Firebase offline ya verificado y almacén correcto', async()=>{
  const session=await resolveMonitorPilotSession(args);
  assert.equal(session.workspaceId,'workspace-a');
  assert.equal(session.userId,'member-1');
  assert.equal(session.cachedOffline,true);
});
test('si está online consulta siempre el servidor, no lee caché offline', async()=>{
  let count=0;
  const s=await resolveMonitorPilotSession({...args,online:()=>true,
    liveSession:async()=>({workspaceId:'workspace-a',userId:'member-2',permissions:['catalog.view']}),
    offlineAccess:async()=>{count++;return access();}
  });
  assert.equal(s.userId,'member-2');
  assert.equal(count,0);
});
test('no permite abrir si hay bloqueo de sesión cerrada', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,logoutLock:async()=>({uid:'user-1'})}),
    e=>e.code==='MONITOR_OFFLINE_ACCESS_DENIED');
});
test('no permite abrir otro almacén distinto al autorizado', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,offlineAccess:async()=>({
    ...access(),selectedWorkspace:{id:'workspace-b',permissions:['purchases.write']}
  })}),/no coincide/);
});
test('no permite abrir si el acceso venció o fue revocado por el módulo existente', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,offlineAccess:async()=>{
    const e=new Error('Acceso vencido');e.code='OFFLINE_AUTH_EXPIRED';throw e;
  }}),e=>e.code==='OFFLINE_AUTH_EXPIRED');
});
test('no permite iniciar como usuario sin permisos', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,offlineAccess:async()=>({
    ...access(),selectedWorkspace:{id:'workspace-a',permissions:[]}
  })}),/permiso/);
});
test('rechaza si faltan identidad o almacén', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,offlineAccess:async()=>({
    ...access(),user:{},selectedWorkspace:{id:'workspace-a',permissions:['purchases.write']}
  })}),/identidad/);
});
test('rechaza modo desarrollo sin identidad offline verificada', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,syncConfig:async()=>({
    authMode:'dev',workspaceId:'workspace-a'
  })}),/Firebase/);
});
test('no permite offline sin almacén seleccionado', async()=>{
  await assert.rejects(resolveMonitorPilotSession({...args,syncConfig:async()=>({
    authMode:'firebase',workspaceId:null
  })}),/Firebase/);
});

test('rol de Surtidos puede entrar al piloto correspondiente sin permiso de compras',async()=>{
  const session=await resolveMonitorPilotSession({...args,
    requiredAnyPermissions:['supply.write'],
    offlineAccess:async()=>({
      ...access(),selectedWorkspace:{id:'workspace-a',permissions:['supply.write']}
    })
  });
  assert.equal(session.cachedOffline,true);
  await assert.rejects(resolveMonitorPilotSession({...args,
    requiredAnyPermissions:['reports.view'],
    offlineAccess:async()=>({
      ...access(),selectedWorkspace:{id:'workspace-a',permissions:['supply.write']}
    })
  }),/permiso/);
});
test('rol Reportes solo lee sus reportes y no queda autorizado para surtir',async()=>{
  const online={
    ...args,online:()=>true,
    liveSession:async()=>({workspaceId:'workspace-a',userId:'analyst-1',permissions:['reports.view']})
  };
  assert.equal((await resolveMonitorPilotSession({...online,requiredAnyPermissions:['reports.view']})).userId,'analyst-1');
  await assert.rejects(resolveMonitorPilotSession({...online,requiredAnyPermissions:['supply.write']}),/permiso/);
});
