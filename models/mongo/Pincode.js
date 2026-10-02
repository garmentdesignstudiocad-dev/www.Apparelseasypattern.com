const { Schema, model } = require('mongoose');

const PincodeSchema = new Schema(
  {
    pincode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    district: {
      type: String,
      default: '',
      trim: true,
    },

    state: {
      type: String,
      default: '',
      trim: true,
    },

    zone: {
      type: String,
      default: '',
      trim: true,
    },

    delivery_charge: {
      type: Number,
      default: 0,
    },
    region_id: {type:String,default:''},

    // Optional pincode-specific ETA overrides. State/zone rules are used when absent.
    delivery_min_days: { type: Number, min: 1 },
    delivery_max_days: { type: Number, min: 1 },

    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = model('Pincode', PincodeSchema);
