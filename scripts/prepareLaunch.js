require('dotenv').config();
const mongoose=require('mongoose');
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI||process.env.MONGODB_URL||process.env.MONGO_URL||process.env.MONGO_URI,{serverSelectionTimeoutMS:15000});
  console.log('Launch setup:',await require('../services/launchSetup').prepare());
})().catch(error=>{console.error('Launch setup failed:',error.name);process.exitCode=1;}).finally(()=>mongoose.disconnect());
