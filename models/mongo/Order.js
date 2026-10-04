const { Schema, model } = require('mongoose');

const { schema: OrderItemSchema } = require('./OrderItem');

const OrderSchema = new Schema(
  {
    ...require('./communicationFields'),
    courier_payment_separate: {type:Boolean,default:false},
    customer_snapshot: {name:String,email:String,phone:String},
    account_customer_id: {type:Schema.Types.ObjectId,ref:'Customer',index:true},
    shipping_address:String,shipping_city:String,shipping_state:String,
    courier_id:String,courier_name:String,
    customer_selected_courier:{type:Boolean,default:false},
    delivery_flow_version:Number,
    destination_region_id:String,destination_region:String,dispatch_location:String,
    tracking_number:{type:String,maxlength:100},tracking_url:String,dispatch_date:Date,
    shipping_status:{type:String,enum:['Confirmed','Preparing','Ready to Dispatch','Shipped','Delivered','Cancelled','Pending','Packed','In Transit','Returned'],default:'Pending'},
    shipping_version:{type:Number,default:0},shipping_notification_keys:{type:[String],default:[]},
    shipping_arranged_separately:{type:Boolean,default:false},
    download_token:{type:String,select:false},download_expires_at:Date,
    download_assets:{type:[new Schema({name:String,file:String,watermark_pdf:Boolean},{_id:false})],select:false,default:undefined},
    customer_id: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },

    items: {
      type: [OrderItemSchema],
      default: [],
    },

    subtotal: {
      type: Number,
      default: 0,
    },

    addon_total: {
      type: Number,
      default: 0,
    },

    physical_total: {
      type: Number,
      default: 0,
    },

    trial_total: {
      type: Number,
      default: 0,
    },

    // Delivery
    delivery_charge: {
      type: Number,
    },

    delivery_pincode: {
      type: String,
      default: '',
    },
    delivery_zone: {
      type: String,
      default: '',
    },

    delivery_state: { type: String, default: '' },
    delivery_district: { type: String, default: '' },
    delivery_min_days: { type: Number },
    delivery_max_days: { type: Number },
    estimated_delivery_from: { type: Date },
    estimated_delivery_to: { type: Date },

    // GST / Tax
    tax_rate: {
      type: Number,
      default: 0,
    },

    tax_amount: {
      type: Number,
      default: 0,
    },

    grand_total: {
      type: Number,
      default: 0,
    },

    order_status: {
      type: String,
      default: 'pending',
    },

    payment_status: {
      type: String,
      default: 'unpaid',
    },

    payment_reference: {
      type: String,
    },
    // Keep the gateway order reference after payment, so callbacks can be retried safely.
    razorpay_order_id: { type: String, index: true },

    payment_gateway: {
      type: String,
      enum: ['razorpay'],
    },
  },
  {
    timestamps: true,
  }
);

OrderSchema.index({download_token:1},{unique:true,partialFilterExpression:{download_token:{$type:'string'}}});
module.exports = model('Order', OrderSchema);
