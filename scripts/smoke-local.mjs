import 'dotenv/config';

const base=process.env.SENTINEL_LOCAL_URL||`http://127.0.0.1:${process.env.PORT||5000}`;
const tenantId=process.env.SENTINEL_TENANT_ID||'sentinel-integration';
const userId=process.env.SENTINEL_SMOKE_USER_ID||'local-test-user';
const bootstrap=process.env.HORUS_BOOTSTRAP_TOKEN;

if(!bootstrap) throw new Error('HORUS_BOOTSTRAP_TOKEN is required in .env');

async function request(path,options={}){
  const response=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  const text=await response.text();
  let body; try{body=JSON.parse(text);}catch{body=text;}
  if(!response.ok) throw new Error(`${options.method||'GET'} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

console.log('1/6 health');
await request('/api/health');

console.log('2/6 bootstrap JWT');
const auth=await request('/api/auth/token',{
  method:'POST',
  headers:{'x-bootstrap-token':bootstrap},
  body:JSON.stringify({tenantId,userId}),
});
if(!auth.token) throw new Error('Token was not returned');
const authHeaders={
  authorization:`Bearer ${auth.token}`,
  'x-tenant-id':tenantId,
};

console.log('3/6 create smoke rule');
await request('/api/rules',{
  method:'POST',
  headers:authHeaders,
  body:JSON.stringify({
    name:`local-smoke-${Date.now()}`,
    definition:{minSeverity:'high'},
  }),
});

console.log('4/6 ingest two correlated signals');
const entityId=`local-smoke-${Date.now()}`;
const occurredAt=new Date().toISOString();
for(let i=0;i<2;i++){
  await request('/api/signals',{
    method:'POST',
    headers:{...authHeaders,'idempotency-key':`local-smoke-${Date.now()}-${i}`},
    body:JSON.stringify({
      type:'incident',
      severity:'high',
      source:'local-smoke',
      entityIds:[entityId],
      occurredAt,
      payload:{smokeTest:true,sequence:i+1},
    }),
  });
}

console.log('5/6 verify generated chain');
const [signals,predictions,correlations,cases]=await Promise.all([
  request('/api/signals',{headers:authHeaders}),
  request('/api/predictive-signals',{headers:authHeaders}),
  request('/api/correlations',{headers:authHeaders}),
  request('/api/cases',{headers:authHeaders}),
]);
if(!signals.items.some(x=>x.source==='local-smoke')) throw new Error('Smoke signals were not persisted');
if(!correlations.items.length) throw new Error('No correlation was generated');
if(!cases.items.length) throw new Error('No case was generated');

console.log('6/6 audit integrity');
const audit=await request('/api/audit/integrity',{headers:authHeaders});
if(!audit.valid) throw new Error(`Audit chain invalid: ${JSON.stringify(audit)}`);

console.log(JSON.stringify({
  ok:true,
  tenantId,
  signals:signals.items.filter(x=>x.source==='local-smoke').length,
  predictiveSignals:predictions.items.length,
  correlations:correlations.items.length,
  cases:cases.items.length,
  auditValid:audit.valid,
},null,2));
