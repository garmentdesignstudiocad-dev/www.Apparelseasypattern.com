// Production startup smoke test with temporary MongoDB; notification worker disabled.
const assert=require('node:assert/strict'),net=require('node:net'),{spawn}=require('node:child_process');
const {MongoMemoryServer}=require('mongodb-memory-server');
async function run(){
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
 let child,output='';
 try{
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',PORT:String(port),MONGODB_URI:mongo.getUri(),SESSION_SECRET:require('node:crypto').randomBytes(32).toString('hex'),ADMIN_USERNAME:'startup-test',ADMIN_PASSWORD:'startup-test-only',APP_BASE_URL:'https://store.example.test',NOTIFICATIONS_WORKER_ENABLED:'false',DB_HOST:'127.0.0.1',DB_PORT:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const until=Date.now()+30000;
  while(!output.includes('MongoDB connected successfully.') && Date.now()<until){if(child.exitCode!==null)throw new Error('Production process exited');await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(output.includes('MongoDB connected successfully.'));
  for(const route of ['/products','/cart','/checkout','/admin/login']){
   const response=await fetch(`http://127.0.0.1:${port}${route}`);assert.equal(response.status,200,route);
  }
  assert.equal(child.exitCode,null);
  console.log('PASS: NODE_ENV=production, PORT, MongoDB connection and storefront/Admin login respond without startup crash.');
  if(output.includes('MemoryStore'))console.log('PRODUCTION BLOCKER: express-session MemoryStore is not a persistent production session store.');
 }finally{if(child && child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await mongo.stop();}
}
run().catch(error=>{console.error('FAIL: production startup',error.message);process.exitCode=1;});
