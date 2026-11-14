// Closed VM dependency allowlist: no database, environment loading or real providers.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../services/notificationService.js'),'utf8');
const safeLogSource=fs.readFileSync(path.join(__dirname,'../services/safeLog.js'),'utf8');
const stages=['lead reconciliation','digital delivery reconciliation','embedded jobs (product_order)','reminders','failure alerts','stale send recovery'];

function fixture(failures=[]){
  const visited=[],logs=[],sent=[];
  const records=['queued','pending','failed','uncertain','sending','sent','skipped'].map(status=>({
    _id:status,status,attempts:0,channel:'email',event:'order_payment_success',category:'payment_confirmation',reference_type:'fixture',dedupe_key:status
  }));
  const hit=stage=>{visited.push(stage);if(failures.includes(stage))throw Object.assign(new Error('secret-test-payload'),{code:'MOCK_FAILURE'});};
  const query=(rows,stage)=>({
    sort(){return this;},limit(){return this;},select(){return this;},lean(){return this;},
    cursor(){return {async *[Symbol.asyncIterator](){if(stage)hit(stage);yield* rows;}};}
  });
  const Log={
    find(filter){
      if(filter.status.$in.includes('queued'))return query(records.filter(row=>filter.status.$in.includes(row.status)));
      return query([],'failure alerts');
    },
    findById(id){return {lean:async()=>records.find(row=>row._id===id)};},
    async findOneAndUpdate(filter,update){
      assert.deepEqual(Array.from(filter.status.$in),['queued','pending']);
      assert.equal(update.$inc.attempts,1);
      const row=records.find(row=>row._id===filter._id && filter.status.$in.includes(row.status));
      if(!row)return null;
      Object.assign(row,update.$set);row.attempts+=update.$inc.attempts;return row;
    },
    async updateOne(filter,update){
      const row=records.find(row=>row._id===filter._id && row.status===filter.status);
      if(row)Object.assign(row,update.$set);
    },
    async updateMany(filter,update){
      hit('stale send recovery');
      assert.equal(filter.status,'sending');assert.equal(update.$set.status,'uncertain');
      // Fixture sending record is not stale; no record needs recovery.
    }
  };
  function Settings(){this.toObject=()=>({email_enabled:true,payment_confirmation:true});}
  Settings.findById=()=>({lean:async()=>null});
  const logger={module:{exports:{}},console:{error:(...args)=>logs.push(args)}};
  vm.runInNewContext(safeLogSource,logger);
  const stubs={
    crypto:{},'../models/mongo/NotificationLog':Log,'../models/mongo/NotificationSettings':Settings,'../models/mongo/SiteSettings':{},
    './receiptService':{types:{product_order:'Order'}},
    './notificationProviders':{createProviders:()=>({email:async row=>{
      assert.equal(row.status,'sending');assert.equal(row.attempts,1);
      sent.push(row._id);return 'mock-'+row._id;
    }})},
    './leadNotifications':{reconcile:async()=>hit('lead reconciliation'),ownerDestination:()=>'',enrichNotificationLog:()=>{}},
    './digitalDeliveryService':{reconcile:async()=>hit('digital delivery reconciliation')},
    '../models/mongo/Order':{find:()=>query([],'embedded jobs (product_order)')},
    '../models/mongo/Webinar':{find:()=>({select:()=>({lean:async()=>{hit('reminders');return [];}})})},
    '../models/mongo/WebinarRegistration':{},
    './siteSettingsService':{getSiteSettings:async()=>({})},'./safeLog':logger.module.exports
  };
  const context={module:{exports:{}},require(name){
    if(!Object.hasOwn(stubs,name))throw new Error('Blocked dependency: '+name);
    return stubs[name];
  }};
  vm.runInNewContext(source,context);
  return {service:context.module.exports,records,visited,logs,sent};
}

for(const failures of [[],...stages.map(stage=>[stage]),stages]){
  test(failures.length?'dispatch survives '+failures.join(', '):'normal dispatch',async()=>{
    const f=fixture(failures);
    await f.service.tick();
    assert.deepEqual(f.visited,stages);
    assert.deepEqual(f.sent,['queued','pending']);
    for(const row of f.records){
      const dispatched=['queued','pending'].includes(row._id);
      assert.equal(row.status,dispatched?'sent':row._id);
      assert.equal(row.attempts,dispatched?1:0);
      if(dispatched)assert.equal(row.provider_response_id,'mock-'+row._id);
    }
    assert.deepEqual(f.logs.map(entry=>entry[0]),failures.map(stage=>`Notification worker ${stage} deferred:`));
    assert.ok(!JSON.stringify(f.logs).includes('secret-test-payload'));
    for(const [,details] of f.logs){assert.equal(details.name,'Error');assert.equal(details.code,'MOCK_FAILURE');}
    await f.service.tick();
    assert.deepEqual(f.sent,['queued','pending'],'later tick must not resend completed or retry failed/uncertain records');
  });
}
