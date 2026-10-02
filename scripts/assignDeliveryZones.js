require('dotenv').config();

const mongoose = require('mongoose');
const Pincode = require('../models/mongo/Pincode');

const RATES = {
  BENGALURU: 100,
  SAME_STATE: 200,
  SOUTH_INDIA: 300,
  WEST_INDIA: 400,
  NORTH_INDIA: 450,
  EAST_INDIA: 450,
  NORTHEAST: 500,
};

const SOUTH_INDIA = [
  'Tamil Nadu',
  'Kerala',
  'Andhra Pradesh',
  'Telangana',
  'Puducherry',
];

const WEST_INDIA = [
  'Maharashtra',
  'Gujarat',
  'Goa',
];

const NORTH_INDIA = [
  'Delhi',
  'Punjab',
  'Haryana',
  'Himachal Pradesh',
  'Uttarakhand',
  'Uttar Pradesh',
  'Rajasthan',
  'Jammu and Kashmir',
  'Ladakh',
  'Chandigarh',
];

const EAST_INDIA = [
  'West Bengal',
  'Odisha',
  'Bihar',
  'Jharkhand',
];

const NORTHEAST_INDIA = [
  'Assam',
  'Arunachal Pradesh',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Tripura',
  'Sikkim',
];

function normalizeState(state) {
  return String(state || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getZone(record) {
  const state = normalizeState(record.state);

  const pincode = String(
    record.pincode || ''
  ).trim();

  // Bengaluru
  if (
    state === 'Karnataka' &&
    pincode.startsWith('560')
  ) {
    return {
      zone: 'Bengaluru',
      delivery_charge: RATES.BENGALURU,
    };
  }

  // Other Karnataka
  if (state === 'Karnataka') {
    return {
      zone: 'Same State',
      delivery_charge: RATES.SAME_STATE,
    };
  }

  // South India
  if (SOUTH_INDIA.includes(state)) {
    return {
      zone: 'South India',
      delivery_charge: RATES.SOUTH_INDIA,
    };
  }

  // West India
  if (WEST_INDIA.includes(state)) {
    return {
      zone: 'West India',
      delivery_charge: RATES.WEST_INDIA,
    };
  }

  // North India
  if (NORTH_INDIA.includes(state)) {
    return {
      zone: 'North India',
      delivery_charge: RATES.NORTH_INDIA,
    };
  }

  // East India
  if (EAST_INDIA.includes(state)) {
    return {
      zone: 'East India',
      delivery_charge: RATES.EAST_INDIA,
    };
  }

  // Northeast India
  if (NORTHEAST_INDIA.includes(state)) {
    return {
      zone: 'Northeast',
      delivery_charge: RATES.NORTHEAST,
    };
  }

  // Unknown state
  return {
    zone: 'South India',
    delivery_charge: RATES.SOUTH_INDIA,
  };
}

async function assignDeliveryZones() {
  try {
    console.log('Connecting to MongoDB...');

    await mongoose.connect(
      process.env.MONGODB_URI
    );

    console.log('Connected to MongoDB');

    const pincodes = await Pincode.find({
      active: true,
    }).lean();

    console.log(
      `Pincodes found: ${pincodes.length}`
    );

    if (!pincodes.length) {
      console.log('No pincodes found.');
      await mongoose.disconnect();
      return;
    }

    const BATCH_SIZE = 500;

    let totalMatched = 0;
    let totalModified = 0;

    for (
      let i = 0;
      i < pincodes.length;
      i += BATCH_SIZE
    ) {
      const batch =
        pincodes.slice(
          i,
          i + BATCH_SIZE
        );

      const operations = batch.map(
        (record) => {
          const result =
            getZone(record);

          return {
            updateOne: {
              filter: {
                _id: record._id,
              },

              update: {
                $set: {
                  zone:
                    result.zone,

                  delivery_charge:
                    result.delivery_charge,
                },
              },
            },
          };
        }
      );

      const result =
        await Pincode.bulkWrite(
          operations,
          {
            ordered: false,
          }
        );

      totalMatched +=
        result.matchedCount || 0;

      totalModified +=
        result.modifiedCount || 0;

      console.log(
        `Processed ${Math.min(
          i + BATCH_SIZE,
          pincodes.length
        )} / ${pincodes.length}`
      );
    }

    console.log('');
    console.log(
      '================================='
    );
    console.log(
      'ZONE ASSIGNMENT COMPLETED'
    );
    console.log(
      '================================='
    );
    console.log(
      `Matched: ${totalMatched}`
    );
    console.log(
      `Modified: ${totalModified}`
    );

    const samples =
      await Pincode.find({
        active: true,
      })
        .limit(10)
        .lean();

    console.log('');
    console.log('Sample records:');

    samples.forEach((item) => {
      console.log(
        `${item.pincode} | ${item.district} | ${item.state} | ${item.zone} | ₹${item.delivery_charge}`
      );
    });

    await mongoose.disconnect();

    console.log('');
    console.log(
      'MongoDB connection closed.'
    );

  } catch (error) {
    console.error(
      'Zone assignment failed:',
      error
    );

    try {
      await mongoose.disconnect();
    } catch (e) {}
  }
}

assignDeliveryZones();