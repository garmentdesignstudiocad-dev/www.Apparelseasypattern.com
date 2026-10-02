// Provider responses are deliberately reduced to IDs/codes: never persist tokens or raw bodies.
function failure(message,uncertain=false){return Object.assign(new Error(message),{safeMessage:message,uncertain});}
function createProviders({fetchImpl=global.fetch,env=process.env,createTransport}={}){
  async function post(url,headers,body){
    let response;
    try{response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}
    catch{throw failure('Provider response was not received. Check provider logs before retrying.',true);}
    let data;try{data=await response.json();}catch{throw failure('Provider returned an unreadable response. Check provider logs.',true);}
    if(!response.ok)throw failure(`Provider rejected the request (HTTP ${Number(response.status)}). Check configuration, recipient and template.`,response.status>=500);
    return data;
  }
  return {
    email:require('./emailService').createEmailService({env,createTransport}),
    async whatsapp(log){
      if(!env.WHATSAPP_ACCESS_TOKEN || !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || '') || !/^v\d+\.\d+$/.test(env.WHATSAPP_API_VERSION || '') || !/^[a-z0-9_]+$/.test(env.WHATSAPP_TEMPLATE_NAME || ''))throw failure('WhatsApp provider is not configured. Set the token, phone number ID, API version and approved template.');
      const normalized=require('./phoneNumber').normalizeE164(log.destination,env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91');
      if(!normalized)throw failure('WhatsApp requires a valid E.164 phone number.');
      const to=normalized.slice(1);
      const data=await post(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{Authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`},{messaging_product:'whatsapp',to,type:'template',template:{name:env.WHATSAPP_TEMPLATE_NAME,language:{code:env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'},components:[{type:'body',parameters:log.parameters.map(text=>({type:'text',text:String(text).replace(/\s+/g,' ').trim().slice(0,1024)}))}]}});
      const id=data.messages?.[0]?.id;if(typeof id!=='string')throw failure('Provider did not return a message ID. Check provider logs.',true);return id;
    },
  };
}
module.exports={createProviders};
