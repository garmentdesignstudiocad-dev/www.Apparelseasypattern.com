// Preload only for tests. Deny external sockets and prevent local .env loading.
require('dotenv').config=()=>({parsed:{}});
const net=require('node:net'),originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  let options=args[0];if(Array.isArray(options))options=options[0];
  const host=typeof options==='object'?options.host:typeof args[1]==='string'?args[1]:undefined;
  if(host && !['127.0.0.1','localhost','::1'].includes(host))throw new Error('Isolated test blocked a non-loopback connection.');
  return originalConnect.apply(this,args);
};
const mongoose=require('mongoose'),connect=mongoose.connect.bind(mongoose);
mongoose.connect=(uri,...args)=>{
  if(typeof uri!=='string' || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(uri))throw new Error('Isolated test requires a loopback MongoDB URI.');
  return connect(uri,...args);
};
