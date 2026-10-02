// Money is rounded in paise before totals are combined. Courier is never taxable here.
const paise = value => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid configured price.');
  return Math.round(amount * 100);
};
function itemPrice(product, files, addons, item) {
  const quantity = Number(item.quantity ?? 1);
  const extraSizes = Math.max(0, (item.selected_sizes || []).length - 1);
  const digital = paise(product.base_price) + extraSizes * paise(product.additional_size_price) + files.reduce((n,f)=>n+paise(f.file_price),0);
  const addon = addons.reduce((n,a)=>n+paise(a.price),0);
  const physical = Number(item.physical_quantity || 0) * paise(product.physical_price);
  const trial = Number(item.trial_quantity || 0) * paise(product.trial_price);
  return {digital:(digital*quantity + addon*Math.max(1,quantity))/100, addons:addon*Math.max(1,quantity)/100, physical:physical/100, trial:trial/100,
    unit:(digital+addon)/100, total:(digital*quantity+addon*Math.max(1,quantity)+physical+trial)/100};
}
function totals(subtotal) {
  const base = paise(subtotal), gst = Math.round(base * 18 / 100);
  if (!Number.isSafeInteger(base + gst)) throw new Error('Invalid order total.');
  return {subtotal:base/100,tax:gst/100,total:(base+gst)/100,amount:base+gst};
}
module.exports = {itemPrice,totals};
