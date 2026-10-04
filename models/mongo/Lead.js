const { Schema, model } = require('mongoose');
const { interests, statuses } = require('../../config/business');
const fields = {};
for (const key of ['name', 'email', 'whatsapp', 'country', 'location', 'profession', 'experience', 'preferred_timing', 'source', 'company_name']) fields[key] = { type: String, trim: true, maxlength: 300, default: '' };
for (const key of ['name', 'email', 'whatsapp']) fields[key].required = function(){
  // Update validators run with a Query; document validators run with a Lead.
  const source=this.source ?? this.getUpdate?.()?.$setOnInsert?.source ?? this.getUpdate?.()?.$set?.source;
  return key==='email' || source!=='/books/notify';
};
const schema = new Schema({ ...fields,
  signup_key:{type:String},consent_at:Date,consent_text:{type:String,maxlength:500},
  studying:{type:String,maxlength:300,default:''},current_role:{type:String,maxlength:300,default:''},
  notification_jobs:{...require('./communicationFields').notification_jobs,default:()=>[]},
  interested_course:{type:String,trim:true,maxlength:300,default:'',index:true},
  interest: { type: String, enum: interests, required: true },
  message: { type: String, trim: true, maxlength: 5000, default: '' },
  status: { type: String, enum: statuses, default: 'New', index: true },
  employee_count: { type: Number, min: 1, max: 1000000 },
  preferred_date: Date,
}, { timestamps: true });
schema.index({ createdAt: -1 });
schema.index({signup_key:1},{unique:true,sparse:true});
module.exports = model('Lead', schema);
