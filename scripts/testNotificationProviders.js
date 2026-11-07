const assert=require('node:assert/strict');
const {createProviders}=require('../services/notificationProviders');
const {normalizeE164}=require('../services/phoneNumber');
const emailService=require('../services/emailService');
async function run(){
  const env={EMAIL_HOST:'smtp.gmail.com',EMAIL_PORT:'587',EMAIL_SECURE:'false',EMAIL_USER:'test@example.test',EMAIL_PASSWORD:'private-test-password',EMAIL_FROM:'Studio <test@example.test>',WHATSAPP_PHONE_NUMBER_ID:'12345',WHATSAPP_ACCESS_TOKEN:'private-test-token',WHATSAPP_API_VERSION:'v23.0',WHATSAPP_TEMPLATE_NAME:'studio_service_update'};
  const log={dedupe_key:'test',destination:'customer@example.test',subject:'Payment confirmed',message:'Verified payment; private download link',parameters:['Customer','ref','INR 100','Paid','Next step','Link']};
  let smtpOptions,mail,wa;
  const providers=createProviders({env,createTransport:options=>{smtpOptions=options;return {sendMail:async input=>{mail=input;return {messageId:'smtp-id',accepted:[input.to]};}};},fetchImpl:async(url,options)=>{wa={url,...JSON.parse(options.body)};return {ok:true,json:async()=>({messages:[{id:'meta-id'}]})};}});
  const gmail=createProviders({env:{GMAIL_USER:'studio@example.test',GMAIL_APP_PASSWORD:'test-only'},createTransport:options=>{assert.equal(options.host,'smtp.gmail.com');assert.equal(options.port,465);assert.equal(options.secure,true);return {sendMail:async()=>({messageId:'gmail-mock',accepted:['customer@example.test']})};}});
  assert.equal(await gmail.email(log),'gmail-mock');
  const gmailWithPartialSmtp=createProviders({env:{SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_SECURE:'false',GMAIL_USER:'studio@example.test',GMAIL_APP_PASSWORD:'test-only'},createTransport:options=>{assert.equal(options.host,'smtp.gmail.com');assert.equal(options.port,465);return {sendMail:async()=>({messageId:'gmail-partial-mock',accepted:['customer@example.test']})};}});
  assert.equal(emailService.isConfigured({SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_SECURE:'false',GMAIL_USER:'studio@example.test',GMAIL_APP_PASSWORD:'test-only'}),true);
  assert.equal(await gmailWithPartialSmtp.email(log),'gmail-partial-mock');
  assert.equal(await providers.email(log),'smtp-id');assert.equal(smtpOptions.secure,false);assert.equal(smtpOptions.requireTLS,true);assert.equal(mail.text,log.message);assert.equal(mail.disableFileAccess,true);
  const messageId=mail.messageId;await providers.email(log);assert.equal(mail.messageId,messageId);
  assert.equal(await providers.whatsapp({...log,destination:'9791753067'}),'meta-id');assert.equal(wa.to,'919791753067');assert.equal(wa.type,'template');assert.ok(wa.url.startsWith('https://graph.facebook.com/'));
  assert.equal(normalizeE164('+44 7700 900123'),'+447700900123');assert.equal(normalizeE164('00919791753067'),'+919791753067');assert.equal(normalizeE164('invalid'),'');
  for(const [error,uncertain] of [[{code:'EAUTH',message:env.EMAIL_PASSWORD},false],[{code:'ETIMEDOUT',message:env.EMAIL_PASSWORD},true]]){
    const failing=createProviders({env,createTransport:()=>({sendMail:async()=>{throw error;}})});
    await assert.rejects(()=>failing.email(log),e=>e.uncertain===uncertain && !e.message.includes(env.EMAIL_PASSWORD));
  }
  await assert.rejects(()=>createProviders({env:{}}).email(log),/SMTP is not configured/);
  const rejected=createProviders({env,fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:env.WHATSAPP_ACCESS_TOKEN})})});
  await assert.rejects(()=>rejected.whatsapp({...log,destination:'+919791753067'}),e=>!e.uncertain && !e.message.includes(env.WHATSAPP_ACCESS_TOKEN));
  const timeout=createProviders({env,fetchImpl:async()=>{throw new Error(env.WHATSAPP_ACCESS_TOKEN);}});
  await assert.rejects(()=>timeout.whatsapp({...log,destination:'+919791753067'}),e=>e.uncertain && !e.message.includes(env.WHATSAPP_ACCESS_TOKEN));
  const leadNotifications=require('../services/leadNotifications');
  const htmlLog={dedupe_key:'html-test',destination:'garmentdesignstudiocad@gmail.com',subject:'New Lead Enquiry - Apparel Easy Patterns',message:'Customer Name: Test Customer\nEmail Address: customer@example.test\nPhone Number: +919876543210\nEnquiry Type: Fit Blocks\nProduct or Service: Women\'s Pant\nCustomer Message: <script>alert("xss")</script> Need fit development\nSubmission Date and Time: 2026-11-07T13:00:00.000Z\nReference ID: 672c8f1234567890\nEnquiry Source: /contact'};
  leadNotifications.enrichEnquiryLog(htmlLog);
  assert.equal(htmlLog.reply_to,'customer@example.test');
  assert.ok(htmlLog.html.includes('Test Customer'));
  assert.ok(htmlLog.html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert.ok(htmlLog.html.includes('href="mailto:customer@example.test?subject=Re%3A%20New%20Lead%20Enquiry%20-%20Apparel%20Easy%20Patterns"'));
  assert.ok(htmlLog.html.includes('Reply to Customer (customer@example.test)'));
  await providers.email(htmlLog);
  assert.equal(mail.to,'garmentdesignstudiocad@gmail.com');
  assert.equal(mail.replyTo,'customer@example.test');
  assert.equal(mail.text,htmlLog.message);
  assert.equal(mail.html,htmlLog.html);
  for(const badEmail of ['invalid','bad\r\ncc:attacker@test.com','bad\ncc:attacker@test.com','']){
    const badLog={dedupe_key:'bad-test-'+badEmail,destination:'garmentdesignstudiocad@gmail.com',subject:'New Lead Enquiry',message:'Customer Name: Bad Email\nEmail Address: '+badEmail+'\nPhone Number: +919876543210\nCustomer Message: Testing'};
    leadNotifications.enrichEnquiryLog(badLog);
    assert.equal(badLog.reply_to,undefined);
    assert.ok(!badLog.html.includes('mailto:'));
    assert.ok(!badLog.html.includes('Reply to Customer'));
    await providers.email(badLog);
    assert.equal(mail.replyTo,undefined);
    assert.equal(mail.text,badLog.message);
  }
  for(const interest of ['Fit Blocks','Online Classes','Training','Technical Consulting','Other Services']){
    const catHtml=leadNotifications.buildLeadHtml({'Customer Name':'Cat Customer','Email Address':'cat@example.test','Enquiry Type':interest,'Customer Message':'Cat message'},'cat@example.test');
    assert.ok(catHtml.includes(interest));
    assert.ok(catHtml.includes('Cat Customer'));
    assert.ok(catHtml.includes('mailto:cat@example.test'));
  }
  console.log('PASS: mocked SMTP/Meta success, stable email Message-ID, TLS, E.164, provider rejection, timeout handling, HTML enquiry rendering, customer Reply-To, mailto links, header injection guard, and secret-safe errors. No messages sent.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
