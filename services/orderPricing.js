// Money is rounded in paise before totals are combined. Courier is never taxable here.
const paise = value => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid configured price.');
  return Math.round(amount * 100);
};
function filePricePaise(file, item) {
  const sizeCount = file.price_per_selected_size
    ? (Array.isArray(item.selected_sizes) ? item.selected_sizes.length : 0)
    : 1;
  return paise(file.file_price) * sizeCount;
}
function itemPrice(product, files, addons, item) {
  const quantity = Number(item.quantity ?? 1);
  const extraSizes = Math.max(0, (item.selected_sizes || []).length - 1);
  const digital = (item.printable_selected===false ? 0 : paise(product.base_price) + extraSizes * paise(product.additional_size_price)) + files.reduce((n,f)=>n+filePricePaise(f,item),0);
  const addon = addons.reduce((n,a)=>n+paise(a.price),0);
  const chosen=item.selected_sizes || [];
  const physicalChosen = (Array.isArray(item.physical_sizes) && item.physical_sizes.length) ? item.physical_sizes : chosen;
  const physicalQty = Number(item.physical_quantity ?? (Array.isArray(item.physical_sizes) ? item.physical_sizes.length : 0));
  const physical = physicalQty > 0 && physicalChosen.length && product.size_prices?.length
    ? Math.round(physicalChosen.reduce((sum,size)=>sum+paise(product.size_prices.find(row=>row.size===size)?.price ?? product.physical_price),0) * physicalQty / physicalChosen.length)
    : physicalQty * paise(product.physical_price);
  const trial = Number(item.trial_quantity || 0) * paise(product.trial_price);
  return {digital:(digital*quantity + addon*Math.max(1,quantity))/100, addons:addon*Math.max(1,quantity)/100, physical:physical/100, trial:trial/100,
    unit:(digital+addon)/100, total:(digital*quantity+addon*Math.max(1,quantity)+physical+trial)/100};
}
async function taxRate() {
  const Model = require('../models/mongo/TaxSettings');
  const settings = await Model.findOne({key:'default'}).lean() || new Model().toObject();
  const rate = settings.enabled === false ? 0 : Number(settings.percentage);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Invalid configured tax rate.');
  return rate;
}
function totals(subtotal, courierCharge=0, rate=18) {
  const base=paise(subtotal),courier=paise(courierCharge),gst=Math.round(base*rate/100),amount=base+courier+gst;
  if(!Number.isSafeInteger(amount))throw new Error('Invalid order total.');
  return {subtotal:base/100,courier:courier/100,tax:gst/100,total:amount/100,amount};
}
module.exports = {filePricePaise,itemPrice,totals,taxRate};
