// Check production gate in isolated Node processes. Never connects to a database.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const run=(label,variables,exercise,{mustFail=false}={})=>{
  const env={...process.env,NODE_ENV:'test',AUTH_MODE:'dev',
    DATABASE_URL:'postgres://unused:unused@127.0.0.1:5432/unused',
    MONITOR_PILOT_ENABLED:'false',MONITOR_PILOT_USER_IDS:'',
    ...variables
  };
  const result=spawnSync(process.execPath,['--input-type=module','-e',exercise],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:15000
  });
  if(mustFail){
    assert.notEqual(result.status,0,label+' must refuse activation');
  } else {
    assert.equal(result.status,0,label+': '+result.stderr+result.stdout);
  }
  console.log('MONITOR_GATE_CHECK_PASS: '+label);
};
const check=[
  "import {monitorPilotGate} from './src/middleware/monitorPilotGate.js';",
  "const identity = process.env.TEST_IDENTITY || 'user-1';",
  "let response={statusCode:200,body:null};",
  "const res={status(code){response.statusCode=code;return this;},json(json){response.body=json;return this;}};",
  "let called=0;",
  "monitorPilotGate({auth:{userId:identity}},res,()=>called++);",
  "const expected=Number(process.env.TEST_EXPECTED_STATUS);",
  "if(response.statusCode!==expected||called!==(expected===200?1:0))throw Error(JSON.stringify({response,called,expected}));"
].join('\n');
run('disabled by default',{TEST_EXPECTED_STATUS:'404'},check);
run('enabled user allowed',{
  MONITOR_PILOT_ENABLED:'true',MONITOR_PILOT_USER_IDS:'user-1',
  TEST_IDENTITY:'user-1',TEST_EXPECTED_STATUS:'200'
},check);
run('unauthorized user denied',{
  MONITOR_PILOT_ENABLED:'true',MONITOR_PILOT_USER_IDS:'user-1',
  TEST_IDENTITY:'user-2',TEST_EXPECTED_STATUS:'403'
},check);
run('production refuses pilot enabled without allowlist',{
  NODE_ENV:'production',AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'fixture-project',
  MONITOR_PILOT_ENABLED:'true',MONITOR_PILOT_USER_IDS:''
},"await import('./src/config.js')",{mustFail:true});
