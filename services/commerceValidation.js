const id = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
function quantity(value, minimum, fallback) {
  if(value === undefined || value === null || value === '') return fallback;
  if(!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<minimum || Number(value)>100000) return null;
  return Number(value);
}
function quantities(item) {
  return quantity(item.quantity,0,1)!==null && quantity(item.physical_quantity,0,0)!==null && quantity(item.trial_quantity,0,0)!==null && (Number(item.quantity ?? 1)+Number(item.physical_quantity || 0)+Number(item.trial_quantity || 0)>0) && (item.selected_sizes===undefined || Array.isArray(item.selected_sizes) && item.selected_sizes.length<=100 && new Set(item.selected_sizes).size===item.selected_sizes.length && item.selected_sizes.every(s=>typeof s==='string' && /^[a-zA-Z0-9 ._-]{1,40}$/.test(s))) && (Number(item.quantity ?? 1)>0 || !(item.selected_files || item.files || []).length);
}
function ids(values) {return Array.isArray(values) && values.length<=100 && values.every(id) && new Set(values).size===values.length;}
module.exports = { id, quantity, quantities, ids };
