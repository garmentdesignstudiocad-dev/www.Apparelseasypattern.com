const { Schema, model } = require('mongoose');

const ProductSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  import_source_key: { type: String, default: undefined },
  description: String,
  category: {type:String,trim:true,maxlength:80,default:''},
  status: {type:String,enum:['active','draft','coming_soon'],default:'active'},
  featured: {type:Boolean,default:false},
  available_sizes: {type:[String],default:[]},
  size_prices: {type:[new Schema({size:String,price:{type:Number,min:0,max:1000000}},{_id:false})],default:[]},
  pattern_options: {type:new Schema({printable:Boolean,physical:Boolean,trial:Boolean},{_id:false}),default:undefined},
  printable_dimensions: {type:String,maxlength:500,default:''},
  sample_image_url: {type:String,default:''},
  video_url: {type:String,default:''},
  digital_file:{type:String,select:false},
  size_information: {type:String,maxlength:3000,default:''},
  file_formats: {type:String,maxlength:500,default:''},
  delivery_information: {type:String,maxlength:3000,default:''},
  download_information: {type:String,maxlength:3000,default:''},
  seo_title: {type:String,maxlength:200,default:''},
  seo_description: {type:String,maxlength:320,default:''},
  amazon_listing_url: {type:String,default:'',validate:value=>!value || require('../../services/productMetadata').amazonUrl(value)},
  base_price: { type: Number, default: 0, min: 0, max: 1000000 },
  additional_size_price: { type: Number, default: 0, min: 0, max: 1000000 },
  physical_price: { type: Number, default: 0, min: 0, max: 1000000 },
  trial_price: { type: Number, default: 0, min: 0, max: 1000000 },
  images: { type: [String], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Product', ProductSchema);
