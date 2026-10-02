const nodemailer=require('nodemailer');
const crypto=require('crypto');
const failure=(message,uncertain=false)=>Object.assign(new Error(message),{safeMessage:message,uncertain});
function createEmailService({env=process.env,createTransport=nodemailer.createTransport}={}){
  env = {...env, ...(env.GMAIL_USER && env.GMAIL_APP_PASSWORD ? {EMAIL_HOST:'smtp.gmail.com',EMAIL_PORT:'465',EMAIL_SECURE:'true',EMAIL_USER:env.GMAIL_USER,EMAIL_PASSWORD:env.GMAIL_APP_PASSWORD,EMAIL_FROM:env.EMAIL_FROM || env.GMAIL_USER} : {})};
  let transport;
  return async function send(log){
    const port=Number(env.EMAIL_PORT);
    if(!env.EMAIL_HOST || !Number.isInteger(port) || port<1 || port>65535 || !['true','false'].includes(env.EMAIL_SECURE) || !env.EMAIL_USER || !env.EMAIL_PASSWORD || !env.EMAIL_FROM)throw failure('SMTP is not configured. Set EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASSWORD and EMAIL_FROM.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(log.destination))throw failure('A valid customer email is required.');
    transport ||= createTransport({host:env.EMAIL_HOST,port,secure:env.EMAIL_SECURE==='true',requireTLS:env.EMAIL_SECURE!=='true',auth:{user:env.EMAIL_USER,pass:env.EMAIL_PASSWORD},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false});
    try{
      const result=await transport.sendMail({from:env.EMAIL_FROM,to:log.destination,subject:log.subject,text:log.message,messageId:`<${crypto.createHash('sha256').update(log.dedupe_key).digest('hex')}@notifications.local>`,disableFileAccess:true,disableUrlAccess:true});
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
module.exports={createEmailService};
