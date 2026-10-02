const { Schema, model } = require('mongoose');
const schema = new Schema({ key:{type:String,default:'default',unique:true}, store_name:{type:String,default:'Garment Pattern Store'}, logo_url:String, main_website_url:String, contact_email:String,contact_phone:String,whatsapp_number:String,address:String,footer_text:String,homepage_heading:String,homepage_subheading:String },{timestamps:true});
const { defaults, content, valid } = require('../../config/appearance');
schema.add({launch_contacts_version:{type:Number,default:0}});
for (const [key, value] of Object.entries({ ...defaults, ...content })) {
  schema.add({ [key]: { type: key === 'base_font_size' ? Number : String, default: value,
    validate: { validator: input => valid(key, input), message: `Invalid ${key}` } } });
}
const linkedin=require('../../config/linkedin');
for(const [key,value] of Object.entries(linkedin.defaults))schema.add({[key]:{type:typeof value==='boolean'?Boolean:String,default:value,...(typeof value==='string'?{validate:linkedin.validUrl}:{})}});
module.exports=model('SiteSettings',schema);
