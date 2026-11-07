const assert=require('node:assert/strict');
const pricing=require('../services/orderPricing');
const courier=require('../services/courierService');

assert.equal(courier.chargePaise({charge:399.99,charge_approved:true}),39999,'Approved INR charges convert to integer paise.');
assert.equal(courier.chargePaise({charge:0,charge_approved:true}),0,'An explicitly approved zero rate is valid.');
for(const row of [null,{}, {charge:125,charge_approved:false},{charge:null,charge_approved:true},{charge:-1,charge_approved:true},{charge:1000000.01,charge_approved:true},{charge:12.999,charge_approved:true}])assert.equal(courier.chargePaise(row),null,'Missing, unapproved, negative, excessive and fractional-paise rates fail closed.');
assert.deepEqual(pricing.totals(150,300),{subtotal:150,courier:300,tax:27,total:477,amount:47700},'Courier charge is included once after product-only GST.');
assert.deepEqual(pricing.totals(150,0),{subtotal:150,courier:0,tax:27,total:177,amount:17700},'Digital-only or explicitly free courier leaves no hidden charge.');

console.log('PASS: approved/unapproved courier rates, integer-paise conversion, zero-rate approval, separate charge, and product-only GST.');
