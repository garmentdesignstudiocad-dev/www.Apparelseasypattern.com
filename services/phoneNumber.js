function normalizeE164(value,countryCode='91'){
  const raw=String(value || '').trim();
  if(!/^[+\d ()-]+$/.test(raw))return '';
  let digits=raw.replace(/\D/g,'');
  if(raw.startsWith('00'))digits=digits.slice(2);
  else if(!raw.startsWith('+') && digits.length===10 && /^[1-9]\d{0,2}$/.test(countryCode))digits=countryCode+digits;
  return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:'';
}
module.exports={normalizeE164};
