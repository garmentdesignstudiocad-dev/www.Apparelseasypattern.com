require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

const Pincode = require('../models/mongo/Pincode');

const CSV_FILE = path.join(
  __dirname,
  '..',
  '..',
  'pincode-dataset.csv'
);

async function importPincodes() {
  try {
    console.log('CSV file:', CSV_FILE);
    console.log('Connecting to MongoDB...');

    await mongoose.connect(
      process.env.MONGODB_URI
    );

    console.log('Connected to MongoDB');

    const records = [];

    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on('data', (row) => {

        const pincode = String(
          row.Pincode || ''
        )
          .replace(/\D/g, '')
          .trim();

        const district = String(
          row.District || ''
        ).trim();

        const state = String(
          row.StateName || ''
        ).trim();

        if (/^\d{6}$/.test(pincode)) {

          records.push({
            pincode,
            district,
            state,
            zone: '',
            delivery_charge: 0,
            active: true,
          });

        }
      })

      .on('end', async () => {

        try {

          console.log(
            `CSV records found: ${records.length}`
          );

          if (!records.length) {

            console.log(
              'No valid pincode records found.'
            );

            await mongoose.disconnect();

            return;
          }


          /*
          Remove duplicate pincodes
          */

          const uniqueMap = new Map();

          for (const record of records) {

            uniqueMap.set(
              record.pincode,
              record
            );

          }

          const uniqueRecords =
            Array.from(
              uniqueMap.values()
            );


          console.log(
            `Unique pincodes: ${uniqueRecords.length}`
          );


          /*
          Clear existing pincode data
          */

          await Pincode.deleteMany({});

          console.log(
            'Old pincode data cleared.'
          );


          /*
          Insert new data
          */

          await Pincode.insertMany(
            uniqueRecords,
            {
              ordered: false,
            }
          );


          console.log(
            `Successfully imported ${uniqueRecords.length} pincodes.`
          );


          await mongoose.disconnect();

          console.log(
            'MongoDB connection closed.'
          );

        } catch (error) {

          console.error(
            'Import error:',
            error
          );

          await mongoose.disconnect();

        }

      })

      .on('error', async (error) => {

        console.error(
          'CSV read error:',
          error
        );

        await mongoose.disconnect();

      });

  } catch (error) {

    console.error(
      'Pincode import failed:',
      error
    );

    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      // Ignore disconnect error
    }

  }
}

importPincodes();