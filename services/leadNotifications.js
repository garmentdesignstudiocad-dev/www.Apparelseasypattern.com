const crypto=require('crypto');
const Lead=require('../models/mongo/Lead'),Log=require('../models/mongo/NotificationLog');
const event='admin_lead_enquiry';

const KNOWN_KEYS=new Set([
  'Customer Name',
  'Email Address',
  'Phone Number',
  'Enquiry Type',
  'Product or Service',
  'Customer Message',
  'Profession / Status',
  'Studying',
  'Current Role',
  'Years of Experience',
  'Company Name',
  'Employee Count',
  'Location',
  'Requested time',
  'Booking state',
  'Submission Date and Time',
  'Reference ID',
  'Enquiry Source'
]);

function ownerDestination(site={},lead=false){
  return (lead?process.env.LEAD_NOTIFICATION_TO || process.env.ADMIN_NOTIFICATION_EMAIL:process.env.ADMIN_NOTIFICATION_EMAIL || process.env.LEAD_NOTIFICATION_TO) || site.contact_email || '';
}

function escapeHtml(str){
  if(str===null || str===undefined)return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function isValidEmail(email){
  return typeof email==='string' && /^[^\r\n\s@]+@[^\r\n\s@]+\.[^\r\n\s@]+$/.test(email.trim());
}

function buildLeadHtml(fields,customerEmail,subject='New Lead Enquiry - Apparel Easy Patterns'){
  const cleanEmail=isValidEmail(customerEmail)?customerEmail.trim():null;
  const cleanSubject=subject.replace(/[\r\n]+/g,' ').trim();
  const rows=Object.entries(fields)
    .filter(([key,val])=>val!==undefined && val!==null && String(val).trim()!=='' && key!=='Customer Message')
    .map(([key,val])=>`<tr><td style="padding:10px 14px;border-bottom:1px solid #ede8e3;color:#625c56;font-size:13px;font-weight:500;width:38%;vertical-align:top;">${escapeHtml(key)}</td><td style="padding:10px 14px;border-bottom:1px solid #ede8e3;color:#1c1917;font-size:14px;vertical-align:top;font-weight:${key==='Customer Name'?'600':'400'};">${escapeHtml(val)}</td></tr>`).join('');
  const messageText=fields['Customer Message'];
  const messageBlock=messageText?`<div style="margin-top:20px;padding:16px;background-color:#faf7f4;border:1px solid #ede8e3;border-radius:6px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#78716c;margin-bottom:8px;">Customer Message / Requirements</div><div style="font-size:14px;line-height:1.6;color:#1c1917;white-space:pre-wrap;">${escapeHtml(messageText)}</div></div>`:'';
  const replyAction=cleanEmail?`<div style="margin-top:28px;text-align:center;padding:20px;background-color:#f7f3ef;border-radius:8px;"><a href="mailto:${escapeHtml(encodeURIComponent(cleanEmail).replace(/%40/g,'@'))}?subject=${encodeURIComponent('Re: '+cleanSubject)}" style="display:inline-block;background-color:#62392d;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:4px;font-size:14px;font-weight:600;letter-spacing:0.3px;">Reply to Customer (${escapeHtml(cleanEmail)})</a><p style="margin:10px 0 0;font-size:12px;color:#78716c;">Clicking Gmail's native <strong>Reply</strong> will also address <strong>${escapeHtml(cleanEmail)}</strong> directly.</p></div>`:'';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(cleanSubject)}</title></head><body style="margin:0;padding:24px 12px;background-color:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e7e2dc;box-shadow:0 2px 8px rgba(0,0,0,0.04);"><tr><td style="background-color:#62392d;padding:22px 28px;text-align:left;"><h1 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">Apparel Easy Patterns</h1><p style="margin:4px 0 0;font-size:13px;color:#e5ded7;">New Customer Enquiry</p></td></tr><tr><td style="padding:24px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows}</table>${messageBlock}${replyAction}</td></tr><tr><td style="padding:18px 28px;background-color:#faf7f4;border-top:1px solid #ede8e3;font-size:12px;color:#a8a29e;text-align:center;">Apparel Easy Patterns Studio Ordering Portal &middot; Reference: ${escapeHtml(fields['Reference ID'] || '')}</td></tr></table></td></tr></table></body></html>`;
}

function parseEnquiryMessage(message=''){
  const fields={};
  if(typeof message!=='string')return fields;
  const lines=message.split('\n');
  let currentKey=null;
  const multiline=[];
  for(const line of lines){
    const idx=line.indexOf(': ');
    if(idx!==-1){
      const candidateKey=line.slice(0,idx).trim();
      if(KNOWN_KEYS.has(candidateKey)){
        if(currentKey){
          fields[currentKey]=multiline.join('\n').trim();
          multiline.length=0;
        }
        currentKey=candidateKey;
        multiline.push(line.slice(idx+2));
        continue;
      }
    }
    if(currentKey){
      multiline.push(line);
    }
  }
  if(currentKey){
    fields[currentKey]=multiline.join('\n').trim();
  }
  return fields;
}

function enrichEnquiryLog(log,customerEmail){
  if(!log || typeof log!=='object')return log;
  const fields=parseEnquiryMessage(log.message);
  // Dispatch supplies the saved contact; free-form message labels are not identity.
  const source=customerEmail && typeof customerEmail==='object'?customerEmail:null;
  const email=arguments.length>1?(source?source.email:customerEmail):fields['Email Address'] || log.customer_email || '';
  if(source){fields['Customer Name']=source.name || source.full_name || '';fields['Customer Message']=source.message || source.notes || '';}
  const cleanEmail=isValidEmail(email)?email.trim():null;
  delete log.reply_to;
  delete log.replyTo;
  if(arguments.length>1)fields['Email Address']=cleanEmail || '';
  if(cleanEmail)log.reply_to=cleanEmail;
  log.html=buildLeadHtml(fields,cleanEmail,log.subject || 'New Lead Enquiry - Apparel Easy Patterns');
  return log;
}

function enrichNotificationLog(log,replyTo){
  delete log.reply_to;delete log.replyTo;
  if(isValidEmail(replyTo))log.reply_to=replyTo.trim();
  const reply=log.reply_to?`<p><a href="mailto:${escapeHtml(encodeURIComponent(log.reply_to).replace(/%40/g,'@'))}">Reply</a></p>`:'';
  log.html=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;padding:20px;background:#f5f2ed;font-family:Arial,sans-serif;color:#1c1917"><table role="presentation" width="100%" style="max-width:620px;margin:auto;background:#fff"><tr><td style="padding:24px"><h1 style="font-size:20px">Apparel Easy Patterns</h1><h2 style="font-size:16px">${escapeHtml(log.subject)}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6">${escapeHtml(log.message)}</div>${reply}</td></tr></table></body></html>`;
  return log;
}

async function enqueue(row,type='course_enquiry') {
  await Log.init();
  // A pre-existing owner record from the earlier type-specific key is already
  // the notification for this enquiry. Keep it and let Admin retry if needed.
  const existing=await Log.findOne({event,reference_id:row._id}).select('_id').lean();
  if(existing){
    if(type!=='consultation_booking')await Lead.updateOne({_id:row._id},{$set:{business_notification_pending:false}});
    return existing;
  }
  // The job type may differ between the request path and the worker recovery
  // path, but the lead has one owner email regardless of which path queues it.
  const dedupe_key=crypto.createHash('sha256').update('business-lead|'+row._id).digest('hex');
  const fields={
    'Customer Name':row.name || row.full_name,'Email Address':row.email,'Phone Number':row.whatsapp,
    'Enquiry Type':row.interest || (type==='consultation_booking'?'Technical Consulting':'General Enquiry'),
    'Product or Service':row.interested_course || row.item_name || row.interest,
    ...(row.profession?{'Profession / Status':row.profession}:{}),
    ...(row.studying?{'Studying':row.studying}:{}),
    ...(row.current_role?{'Current Role':row.current_role}:{}),
    ...(row.experience?{'Years of Experience':String(row.experience)}:{}),
    ...(row.company_name?{'Company Name':row.company_name}:{}),
    ...(row.employee_count?{'Employee Count':String(row.employee_count)}:{}),
    ...(row.location?{'Location':row.location}:{}),
    'Customer Message':row.message || row.notes,
    'Submission Date and Time':row.createdAt?new Date(row.createdAt).toISOString():new Date().toISOString(),
    'Reference ID':String(row._id),'Enquiry Source':row.source || (type==='consultation_booking'?'/consulting':undefined),
    ...(type==='consultation_booking'?{'Requested time':`${row.preferred_date} ${row.preferred_time} Asia/Kolkata (UTC+05:30)`,'Booking state':row.scheduling_status?'Booking request — Admin availability decision required':row.status}:{}),
  };
  const destination=ownerDestination(await require('./siteSettingsService').getSiteSettings(),true);
  const cleanEmail=isValidEmail(row.email)?row.email.trim():null;
  const subject='New Lead Enquiry - Apparel Easy Patterns';
  const html=buildLeadHtml(fields,cleanEmail,subject);
  const payload={dedupe_key,channel:'email',event,category:event,reference_type:type,reference_id:row._id,
    customer:row.name || row.full_name || '',destination,status:'queued',
    subject,
    message:Object.entries(fields).filter(([,value])=>value!==undefined && value!==null && String(value).trim()!=='').map(([key,value])=>key+': '+value).join('\n')};
  if(cleanEmail)payload.reply_to=cleanEmail;
  payload.html=html;
  try {await Log.updateOne({dedupe_key},{$setOnInsert:payload},{upsert:true,runValidators:true});}
  catch(error){if(error.code!==11000)throw error;}
  if(type!=='consultation_booking')await Lead.updateOne({_id:row._id},{$set:{business_notification_pending:false}});
}

async function reconcile() {
  // Only new records opt in. Never bulk-notify historical enquiries.
  for await(const row of Lead.find({business_notification_pending:true}).limit(100).lean().cursor())await enqueue(row);
}

async function statuses(rows) {
  const logs=await Log.find({event,reference_id:{$in:rows.map(row=>row._id)}}).select('reference_id status').lean();
  const states=new Map(logs.map(log=>[String(log.reference_id),log.status]));
  for(const row of rows){const state=states.get(String(row._id));row.email_status=state==='sent'?'Email Sent':state==='uncertain'?'Needs review':['failed','skipped'].includes(state)?'Email Failed':'Pending';}
}

module.exports={event,enqueue,reconcile,statuses,ownerDestination,buildLeadHtml,escapeHtml,isValidEmail,parseEnquiryMessage,enrichEnquiryLog,enrichNotificationLog};
