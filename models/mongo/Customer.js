const { Schema, model } = require('mongoose');

const CustomerSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, trim:true, lowercase:true },
  phone: String,
  password_hash: {type:String,select:false},
  address: String,
  city: String,
  state: String,
  country: String,
  postal_code: String,
  pincode: String,
}, { timestamps: true });

module.exports = model('Customer', CustomerSchema);
