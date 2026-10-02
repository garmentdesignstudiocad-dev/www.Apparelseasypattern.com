const labels={};
for(const [prefix,label] of Object.entries({order:'Product order',class:'Class',course:'Course',webinar:'Webinar',book:'Book',consulting:'Consulting',course_enquiry:'Course enquiry'})){
  for(const [suffix,action] of Object.entries({created:'received',payment_success:'payment confirmed',status_update:'status updated'})){
    if(prefix==='course_enquiry' && suffix!=='created')continue;
    labels[prefix+'_'+suffix]=label+' — '+action;
  }
}
Object.assign(labels,{order_digital_ready:'Digital pattern download ready',order_shipped:'Order shipped',webinar_reminder:'Webinar reminder'});
const ownerLabels={admin_new_order_alert:'Owner: new product order',admin_course_enquiry:'Owner: new course enquiry',admin_webinar_registration:'Owner: new webinar registration',admin_book_purchase:'Owner: new book purchase',admin_consulting_booking:'Owner: new consulting booking',admin_successful_payment:'Owner: successful payment',admin_notification_failed:'Owner: failed notification'};
module.exports={labels,ownerLabels};
