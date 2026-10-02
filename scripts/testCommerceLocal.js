// Real, temporary MongoDB; gateway and SMTP remain mocked by the existing suites.
const {MongoMemoryServer}=require('mongodb-memory-server');
const {spawn}=require('node:child_process');
async function run(){
  const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  try{
    for(const script of ['testCommerce.js','testNotifications.js']){
      const code=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[require('node:path').join(__dirname,script)],{
          stdio:'inherit',env:{...process.env,MONGODB_URI:mongo.getUri(),NOTIFICATIONS_WORKER_ENABLED:'false'}
        });child.on('error',reject);child.on('exit',resolve);
      });
      if(code!==0)throw new Error(script+' failed.');
    }
  }finally{await mongo.stop();}
}
run().catch(error=>{console.error('Local regression failed:',error.name,error.code || 'See test output');process.exitCode=1;});
