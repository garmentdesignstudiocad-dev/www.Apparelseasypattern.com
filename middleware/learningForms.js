const tokens=require('../services/sessionFormTokens');
function fresh(req,res){
  // Ensure saveUninitialized:false still saves a cookie for a first-time form.
  req.session.learningFormSession=true;
  res.set('Cache-Control','no-store');
  res.locals.learningCsrf=tokens.issue(req,'learning-csrf');
  return res.locals.learningCsrf;
}
function reject(req,res){
  const message='This form has expired. Reload the page and try again.';
  return req.is('application/json')?res.status(403).json({error:message,code:'FORM_EXPIRED'}):res.status(403).send(message);
}
function withRecovery(onInvalid=reject){return (req,res,next)=>{
  fresh(req,res);
  if(req.method==='POST' && !tokens.valid(req,'learning-csrf',req.body?._csrf)){
    return Promise.resolve().then(()=>onInvalid(req,res,next)).catch(next);
  }
  next();
};}
module.exports=withRecovery();
module.exports.withRecovery=withRecovery;
module.exports.fresh=fresh;
module.exports.reject=reject;
