const { Schema, model } = require('mongoose');
const schema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  author: { type: String, maxlength: 200, default: '' },
  description: { type: String, maxlength: 30000, default: '' },
  cover_url: String, topics: [String], pages: { type: Number, min: 1 },
  who_should_read: { type: String, maxlength: 5000, default: '' },
  amazon_url: String, ebook_url: {type:String,select:false},
  purchase_type: {type:String,enum:['external','direct','free'],default:'external'},
  price: {type:Number,min:0,max:1000000,default:null},
  active: { type: Boolean, default: false },
}, { timestamps: true });
module.exports = model('Book', schema);
