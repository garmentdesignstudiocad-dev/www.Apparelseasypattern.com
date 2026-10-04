// Narrow public marketing and new sales only; existing purchases and Admin remain accessible.
module.exports=(req,res,next)=>{
  const path=req.path.toLowerCase();
  if(/^\/(consulting|garment-technology|corporate-training|updates|webinars)(\/|$)/.test(path))return res.status(404).render('error',{title:'Page Not Available',message:'Explore available apparel patterns or contact us about a pattern requirement.'});
  if(/^\/courses(?:\/|$)/.test(path) || /^\/classes(?:\/?$|\/(?!enquiry(?:\/|$)|registration(?:\/|$)))/.test(path))return req.method==='GET'?res.redirect(302,'/classes/enquiry'):res.status(409).send('Classes are enquiry-only. Please request class information.');
  if(/^\/books\/(?!notify(?:\/|$))/.test(path))return req.method==='GET'?res.redirect(302,'/books'):res.status(409).send('Books are coming soon.');
  next();
};
