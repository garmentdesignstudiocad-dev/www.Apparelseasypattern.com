// Read-only source export. No restore, collection updates, indexes, or credential exports.
const fs=require('node:fs'),path=require('node:path'),{MongoClient,BSON}=require('mongodb');
require('dotenv').config();
const catalog=new Set(['products','addons','productfiles','sitesettings','taxsettings','pricingsettings','featuresettings','deliverysettings','deliveryzones','cityroutes','pincodes','couriers','notificationsettings','paidaccesssettings','classsessions','courses','books','webinars','articles','coupons','consultingservices']);
async function run(){
 const uri=process.env.MONGODB_URI||process.env.MONGODB_URL||process.env.MONGO_URL||process.env.MONGO_URI;
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:15000});
 try{
  await client.connect();const db=client.db();
  const root=path.resolve('D:/garments/db-backup',db.databaseName.replace(/[^a-zA-Z0-9_-]/g,'_'),new Date().toISOString().replace(/[:.]/g,'-'));
  if(root.startsWith(path.resolve(__dirname,'..')+path.sep))throw new Error('Export must be outside repository');
  const secrets=Object.entries(process.env).filter(([key,value])=>/PASSWORD|SECRET|TOKEN|MONGO.*URI|MONGODB_URL|MONGO_URL/.test(key)&&value&&value.length>8).map(([,value])=>value);
  let redactions=0;
  const clean=value=>{if(typeof value==='string'){for(const secret of secrets)if(value.includes(secret)){value=value.split(secret).join('[REDACTED_ENV_SECRET]');redactions++;}return value;}if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]));return value;};
  const inventory=[];
  for(const {name} of await db.listCollections({}, {nameOnly:true}).toArray()){
   if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Unsupported collection name');
   const group=catalog.has(name)?'configuration-catalog':'transactional-user';
   const folder=path.join(root,group);fs.mkdirSync(folder,{recursive:true});
   const rows=await db.collection(name).find().toArray();
   fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(clean(BSON.EJSON.serialize(rows,{relaxed:false})),null,2));
   inventory.push({collection:name,count:rows.length,group});
  }
  const summary={database:db.databaseName,path:root,format:'Canonical MongoDB Extended JSON arrays',environmentSecretRedactions:redactions,collections:inventory};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(summary,null,2));
  fs.writeFileSync(path.join(root,'IMPORT.md'),'# Manual import\n\nSource is the database configured in the local project; it may be remotely hosted. No destination has been modified.\n\nInstall MongoDB Database Tools. Use a protected config YAML outside Git with `uri: "<DESTINATION_MONGODB_URI>"`; never commit that file. Use a fresh destination database and review catalog files first.\n\nPowerShell example (replace placeholders):\n\n```powershell\nGet-ChildItem -LiteralPath "<EXPORT_PATH>\\configuration-catalog" -Filter *.json | ForEach-Object {\n  mongoimport --config "<PRIVATE_CONFIG_YAML>" --db "<DESTINATION_DB>" --collection $_.BaseName --file $_.FullName --jsonArray --mode=insert --stopOnError\n  if ($LASTEXITCODE -ne 0) { throw "Import stopped; inspect destination before retrying." }\n}\n```\n\nNo --drop or automatic replacement. Existing IDs cause an error rather than overwrite. Only deliberately import transactional-user files after reviewing privacy, ownership, receipts and notification queues; importing queued jobs into a running notification worker can send messages. Keep the destination worker disabled during import/reconciliation. JSON data does not recreate indexes: apply existing Mongoose indexes in a controlled deployment step. Private digital files and uploaded assets need a separate secure transfer. Treat the export as confidential. Cross-collection consistency is not a transaction snapshot.\n');
  console.log(JSON.stringify(summary));
  for(const name of ['taxsettings','deliveryzones','couriers','featuresettings','notificationsettings','sitesettings']){
   const rows=await db.collection(name).find().toArray();
   console.log(JSON.stringify({collection:name,summary:name==='taxsettings'?rows.map(r=>({key:r.key,enabled:r.enabled,percentage:r.percentage})):name==='deliveryzones'?rows.map(r=>({id:r._id,hub:r.dispatch_location,states:r.states,partner_ids:r.partner_ids})):name==='couriers'?rows.map(r=>({id:r._id,name:r.name,enabled:r.active})):name==='sitesettings'?{count:rows.length,configured:rows.some(r=>r.key==='default')}:rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k,v])=>k==='_id'||typeof v==='boolean')))}));
  }
 }finally{await client.close();}
}
run().catch(error=>{console.error('Export failed:',error.name);process.exitCode=1;});

