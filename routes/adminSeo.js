const router=require('express').Router();
const keywords=require('../data/seo-keywords.json');
router.use(require('../middleware/adminAuth'));
router.get('/',(req,res)=>{
  const cluster=typeof req.query.cluster==='string'?req.query.cluster:'';
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';
  const rows=keywords.filter(row=>(!cluster||row.cluster===cluster)&&(!q||row.keyword.includes(q.toLowerCase())));
  res.render('admin/seo',{title:'SEO Planning',rows,cluster,q,clusters:[...new Set(keywords.map(row=>row.cluster))]});
});
router.get('/keywords.csv',(req,res)=>{
  const csv=require('../services/businessValidation').csvCell,fields=['cluster','keyword','intent','target_page','status'];
  res.attachment('seo-keyword-ideas.csv').type('text/csv').send('\uFEFF'+fields.join(',')+'\r\n'+keywords.map(row=>fields.map(key=>csv(row[key])).join(',')).join('\r\n'));
});
module.exports=router;
