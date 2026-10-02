// Full suite in isolated MongoDB. Explicit blanks prevent dotenv loading live providers.
const {MongoMemoryServer}=require('mongodb-memory-server');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
 const results=[];
 try{
  const files=fs.readdirSync(__dirname).filter(name=>/^test.*\.js$/.test(name)&&!['testAll.js','testProductionStartup.js'].includes(name));
  for(const file of files){
   const env={...process.env,NODE_ENV:'development',MONGODB_URI:mongo.getUri(),NOTIFICATIONS_WORKER_ENABLED:'false',SESSION_SECRET:'isolated-suite-session-secret',DB_HOST:'127.0.0.1',DB_PORT:'1',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',EMAIL_HOST:'',EMAIL_USER:'',EMAIL_PASSWORD:'',EMAIL_FROM:'',WHATSAPP_ACCESS_TOKEN:'',RESEND_API_KEY:''};
   const result=await new Promise(resolve=>{let output='';const child=spawn(process.execPath,[path.join(__dirname,file)],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>child.kill(),180000);child.on('exit',code=>{clearTimeout(timer);resolve({file,code,output});});});
   results.push(result);console.log((result.code===0?'PASS ':'FAIL ')+file);if(result.code!==0)console.log(result.output.slice(-2200));
  }
 }finally{await mongo.stop();fs.mkdirSync('private/verification',{recursive:true});fs.writeFileSync('private/verification/full-tests.json',JSON.stringify(results,null,2));}
 const failures=results.filter(r=>r.code!==0);console.log(`${results.length-failures.length}/${results.length} suites passed`);if(failures.length)process.exitCode=1;
}
run().catch(error=>{console.error(error.name);process.exitCode=1;});
