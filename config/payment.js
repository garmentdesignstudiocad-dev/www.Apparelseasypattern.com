function validate(env=process.env) {
  const missing=['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET'].filter(key=>typeof env[key]!=='string' || !env[key].trim());
  return {configured:missing.length===0,missing};
}
module.exports={validate,get razorpayConfigured(){return validate().configured;}};
