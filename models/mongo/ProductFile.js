const { Schema, model } = require('mongoose');

const ProductFileSchema = new Schema({
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  import_source_key: { type: String, default: undefined },
  upload_slot:{type:String,enum:[
    'techpack','measurement','marker',
    'dxf_pdf','dxf_zip',
    'hpgl_pdf','hpgl_zip',
    'plt_pdf','plt_zip',
    'pdf_zip',
    'techpack_pdf','techpack_zip',
    'measurement_pdf','measurement_csv','measurement_zip',
    'basic_measurement_pdf','basic_measurement_csv','basic_measurement_zip',
    'marker_pdf','marker_zip',
  ],default:undefined},
  file_name: { type: String, required: true },
  watermark_pdf:{type:Boolean,default:false},
  purpose: {type:String,enum:['other','dxf','tech_pack','specs'],default:'other'},
  file_type: { type: String, required: true },
  file_price: { type: Number, default: 0, min: 0, max: 1000000 },
  price_per_selected_size: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  digital_file:{type:String,select:false},
}, { timestamps: true });

module.exports = model('ProductFile', ProductFileSchema);
