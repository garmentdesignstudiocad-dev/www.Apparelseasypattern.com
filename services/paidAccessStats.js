module.exports=async function paidAccessStats(){
  const names=['CourseBooking','WebinarRegistration','BookPurchase','ConsultationBooking'];
  const results=await Promise.all(names.map(name=>require('../models/mongo/'+name).aggregate([
    {$group:{
      _id:null,total:{$sum:1},
      revenue:{$sum:{$cond:[{$eq:['$payment_status','Paid']},'$amount_paise',0]}},
      pending:{$sum:{$cond:[{$eq:['$payment_status','Pending']},1,0]}},
      paid:{$sum:{$cond:[{$eq:['$payment_status','Paid']},1,0]}},
    }},
  ])));
  const rows=results.map(r=>r[0] || {total:0,revenue:0,pending:0,paid:0});
  return [...rows.map((r,i)=>({label:['Total Course Registrations','Webinar Registrations','Book Purchases','Consulting Bookings'][i],value:r.total})),{label:'Paid Access Revenue',value:'₹'+(rows.reduce((s,r)=>s+r.revenue,0)/100).toLocaleString('en-IN')},{label:'Pending Payments',value:rows.reduce((s,r)=>s+r.pending,0)},{label:'Successful Payments',value:rows.reduce((s,r)=>s+r.paid,0)}];
};
