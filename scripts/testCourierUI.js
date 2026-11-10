const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const template=fs.readFileSync(path.join(__dirname,'../views/checkout.ejs'),'utf8');
assert.ok(template.includes('id="address"'),'Physical checkout keeps its delivery address field.');
assert.ok(template.includes('id="city"') && template.includes('id="state"') && template.includes('id="pincode"'),'Physical checkout keeps city, state and pincode fields.');
assert.ok(!template.includes('courier-select') && !template.includes('courier_id'),'Checkout does not require courier selection.');
assert.ok(template.includes('Courier charges payable separately directly to the courier company. They are not included in your order total.'),'Checkout displays the separate courier payment notice.');
assert.ok(template.includes('Pending Manual Assignment'),'Unknown regions are not assigned a guessed hub.');
assert.ok(template.includes('Courier booking: Not booked'),'Checkout does not claim a courier has been booked.');
assert.ok(template.includes('const grandTotal = productTotal + tax;'),'Courier charges are excluded from the online total.');
assert.ok(template.includes('courierPaymentRow.classList.add("hidden")'),'Digital-only checkout hides physical courier information.');
assert.ok(template.includes('if (!address)') && template.includes('if (!city)') && template.includes('if (!state)'),'Checkout still validates the physical delivery address.');
assert.ok(template.includes('if (!/^[0-9]{6}$/.test(pincode))'),'Checkout still validates six-digit pincodes.');
assert.ok(template.includes('if (!phone || !/^[0-9]{10}$/.test(phone))'),'Checkout still validates the customer phone number.');
assert.ok(template.includes('digitalMessage.classList.remove("hidden")'),'Digital-only checkout remains separate from the shipping form.');
console.log('PASS: no courier selection or charge in checkout; required fields, hub fallback, separate-payment notice and digital-only UI remain.');
