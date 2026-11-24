const message = 'Maximum 2 trial samples per size.';

function validateItems(items) {
  const totals = new Map();
  for (const item of items) {
    const quantity = Number(item.trial_quantity ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return message;
    if (!quantity) continue;
    const sizes = (item.trial_sizes && typeof item.trial_sizes === 'object' && Object.keys(item.trial_sizes).length)
      ? Object.keys(item.trial_sizes)
      : (Array.isArray(item.physical_sizes) && item.physical_sizes.length ? item.physical_sizes : (Array.isArray(item.selected_sizes) ? item.selected_sizes : []));
    if (Array.isArray(sizes) && sizes.length) {
      if (sizes.some(s => typeof s !== 'string' || !s.trim())) return message;
      const normalized = sizes.map(s => s.trim().toLowerCase());
      if (new Set(normalized).size !== sizes.length) return message;

      if (item.trial_sizes && typeof item.trial_sizes === 'object') {
        let sum = 0;
        for (const size of normalized) {
          const originalKey = Object.keys(item.trial_sizes).find(k => k.trim().toLowerCase() === size);
          const qty = Number(originalKey ? item.trial_sizes[originalKey] : 0);
          if (!Number.isInteger(qty) || qty < 1 || qty > 2) return message;
          sum += qty;
          const key = String(item.product_id) + ':' + size;
          const total = (totals.get(key) || 0) + qty;
          if (total > 2) return message;
          totals.set(key, total);
        }
        if (sum !== quantity) return message;
      } else {
        const each = quantity / sizes.length;
        if (!Number.isInteger(each) || each < 1 || each > 2) return message;
        for (const size of normalized) {
          const key = String(item.product_id) + ':' + size;
          const total = (totals.get(key) || 0) + each;
          if (total > 2) return message;
          totals.set(key, total);
        }
      }
    } else {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2) return message;
      const key = String(item.product_id) + ':default';
      const total = (totals.get(key) || 0) + quantity;
      if (total > 2) return message;
      totals.set(key, total);
    }
  }
  return null;
}

module.exports = {validateItems, message};
