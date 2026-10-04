const crypto=require('crypto'),Lead=require('../models/mongo/Lead');
async function save(data) {
  const identity=data.source==='\u002fclasses/enquiry'?JSON.stringify([data.email,data.profession,data.experience,data.message,data.studying,data.current_role]):data.email;
  const signup_key=crypto.createHash('sha256').update(data.source+'|'+identity).digest('hex');
  try {return await Lead.findOneAndUpdate({signup_key},{$setOnInsert:{...data,signup_key,consent_at:new Date(),consent_text:data.interest==='Online Classes'?'Contact me about my online pattern making class enquiry.':'Send me updates about '+(data.interest==='Books'?'book availability.':'new ready-to-use patterns.')}},{upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true});}
  catch(error){if(error.code===11000)return Lead.findOne({signup_key});throw error;}
}
module.exports={save};
