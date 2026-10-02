const crypto=require('crypto');
// Bind independent form tokens to the signed session ID. Issuing a form in one tab
// must not replace the token used by another tab or a payment retry.
const key=process.env.SESSION_SECRET || crypto.randomBytes(32);
const lifetime=60*60*1000;
function digest(req,scope,value){return crypto.createHmac('sha256',key).update(`${req.sessionID}|${scope}|${value}`).digest('hex');}
function issue(req,scope){
  const payload=Date.now().toString(16).padStart(12,'0')+crypto.randomBytes(24).toString('hex');
  return payload+digest(req,scope,payload);
}
function valid(req,scope,token){
  if(typeof token!=='string' || !/^[a-f0-9]{124}$/.test(token))return false;
  const time=parseInt(token.slice(0,12),16),age=Date.now()-time;
  if(age<0 || age>lifetime)return false;
  return crypto.timingSafeEqual(Buffer.from(token.slice(60),'hex'),Buffer.from(digest(req,scope,token.slice(0,60)),'hex'));
}
module.exports={issue,valid,digest,owner:req=>digest(req,'access-owner','')};
