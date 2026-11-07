// Bounded per-process IP limiter supplements form CSRF, consent and session limits.
const buckets=new Map();
module.exports=(req,res,next)=>{
  if(req.method!=='POST' || !/^\/(enquiries|classes\/enquiry|pattern-updates|books\/notify|consulting\/[^/]+\/access)\/?$/.test(req.path))return next();
  const now=Date.now();
  for(const [key,value] of buckets)if(value.until<=now)buckets.delete(key);
  const key=req.ip;let bucket=buckets.get(key);
  if(!bucket){if(buckets.size>=10000)return res.status(429).send('Please try again later.');bucket={until:now+600000,count:0};buckets.set(key,bucket);}
  if(++bucket.count>10){res.set('Retry-After',String(Math.ceil((bucket.until-now)/1000)));return res.status(429).send('Too many enquiries. Please try again later.');}
  if(req.body?.website)return res.status(400).send('Unable to submit this enquiry.');
  next();
};
