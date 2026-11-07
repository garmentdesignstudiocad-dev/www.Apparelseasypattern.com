const nodemailer=require('nodemailer');
const crypto=require('crypto');
const failure=(message,uncertain=false)=>Object.assign(new Error(message),{safeMessage:message,uncertain});
const smtpKeys=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','SMTP_FROM'];
const emailKeys=['EMAIL_HOST','EMAIL_PORT','EMAIL_SECURE','EMAIL_USER','EMAIL_PASSWORD','EMAIL_FROM'];
const present=(env,key)=>typeof env[key]==='string' && env[key].trim()!=='';
function validGroup(env,keys){
  return keys.every(key=>present(env,key)) && Number.isInteger(Number(env[keys[1]])) && Number(env[keys[1]])>=1 && Number(env[keys[1]])<=65535 && ['true','false'].includes(env[keys[2]]);
}
function resolveEmailConfig(env=process.env){
  if(validGroup(env,smtpKeys))return {configured:true,host:env.SMTP_HOST,port:Number(env.SMTP_PORT),secure:env.SMTP_SECURE==='true',user:env.SMTP_USER,pass:env.SMTP_PASS,from:env.SMTP_FROM};
  // Gmail App Password support does not require a second SMTP variable group.
  if(present(env,'GMAIL_USER') && present(env,'GMAIL_APP_PASSWORD'))return {configured:true,host:'smtp.gmail.com',port:465,secure:true,user:env.GMAIL_USER,pass:env.GMAIL_APP_PASSWORD,from:present(env,'EMAIL_FROM')?env.EMAIL_FROM:env.GMAIL_USER};
  if(validGroup(env,emailKeys))return {configured:true,host:env.EMAIL_HOST,port:Number(env.EMAIL_PORT),secure:env.EMAIL_SECURE==='true',user:env.EMAIL_USER,pass:env.EMAIL_PASSWORD,from:env.EMAIL_FROM};
  return {configured:false};
}
function createEmailService({env=process.env,createTransport=nodemailer.createTransport}={}){
  const config=resolveEmailConfig(env);
  let transport;
  return async function send(log){
    if(!config.configured)throw failure('SMTP is not configured. Set a complete SMTP_* group, GMAIL_USER and GMAIL_APP_PASSWORD, or the legacy EMAIL_* group.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(log.destination || ''))throw failure('A valid notification recipient email is required.');
    transport ||= createTransport({host:config.host,port:config.port,secure:config.secure,requireTLS:!config.secure,auth:{user:config.user,pass:config.pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false});
    try{
      const mailOptions={
        from:config.from,
        to:log.destination,
        subject:log.subject,
        text:log.message,
        messageId:`<${crypto.createHash('sha256').update(log.dedupe_key).digest('hex')}@notifications.local>`,
        disableFileAccess:true,
        disableUrlAccess:true
      };
      if(typeof log.html==='string' && log.html.trim().length>0)mailOptions.html=log.html;
      const replyTo=log.reply_to || log.replyTo;
      if(typeof replyTo==='string' && /^[^\r\n\s@]+@[^\r\n\s@]+\.[^\r\n\s@]+$/.test(replyTo.trim())){
        mailOptions.replyTo=replyTo.trim();
      }
      const result=await transport.sendMail(mailOptions);
      if(!result.accepted?.length)throw failure('SMTP did not accept the recipient.');
      if(typeof result.messageId!=='string' || !result.messageId)throw failure('SMTP accepted the message without a message ID. Check provider logs before retrying.',true);
      return result.messageId;
    }catch(error){
      if(error.safeMessage)throw error;
      // SMTP has no exactly-once delivery guarantee. Ambiguous responses require manual review.
      const definite=['EAUTH','EENVELOPE','EDNS','ECONNECTION'].includes(error.code) || Number(error.responseCode)>=400;
      throw failure(definite?'SMTP rejected the message or connection. Check sender, credentials and recipient.':'SMTP response was not confirmed. Check provider logs before retrying.',!definite);
    }
  };
}
module.exports={createEmailService,isConfigured:(env=process.env)=>resolveEmailConfig(env).configured,resolveEmailConfig};
