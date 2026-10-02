const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function verify(){
  const controller=require('../controllers/checkoutController');
  const template=fs.readFileSync(require('node:path').join(__dirname,'../views/checkout.ejs'),'utf8');
  const code=template.slice(template.indexOf('    const cityInput='),template.indexOf('    const productTotalElement'))+
    template.slice(template.indexOf('    async function loadDeliveryRoute()'),template.indexOf('    async function updateSummary()'));
  for(const [state,city,region,hub] of [['Tamil Nadu','Tiruppur','South','Bengaluru'],['Punjab','Ludhiana','North','Mumbai']]){
    let data;
    await controller.getDeliveryCharge({query:{state,city,pincode:'638751'}},{json(body){data=body;},status(){throw new Error('Delivery API failed');}});
    assert.equal(data.region,region);assert.equal(data.dispatch_location,hub);assert.ok(data.couriers.length>0);
    const elements={},element=()=>({value:'',textContent:'',classList:{toggle(){},add(){},remove(){}}});
    const select={value:'',options:[],replaceChildren(option){this.options=[option];this.value='';},add(option){this.options.push(option);}};
    const context={document:{getElementById:id=>elements[id] ||= {...element(),value:id==='state'?state:id==='city'?city:''}},
      Option:function(text,value){this.text=text;this.value=value;},courierSelect:select,deliveryRequired:true,deliveryRequestId:0,
      courierHelp:element(),deliveryStatus:element(),deliveryEstimate:element(),deliveryEtaSummary:element(),estimatedDeliveryTime:element(),estimatedDeliveryDate:element(),
      fetch:async url=>{assert.ok(url.startsWith('/checkout/delivery-info?'));return {ok:true,json:async()=>data};}};
    vm.createContext(context);vm.runInContext(code,context);await context.loadDeliveryRoute();
    assert.equal(select.disabled,false);assert.equal(elements['region-summary'].textContent,region);
    assert.equal(elements['dispatch-summary'].textContent,hub);
    for(const partner of data.couriers){
      assert.ok(select.options.some(option=>option.text.includes(partner.name)));
      select.value=partner._id;context.renderCourierSummary();
      assert.equal(elements['selected-courier-summary'].textContent,partner.name);
    }
    console.log(JSON.stringify({state,zone:region,hub,dropdownEnabled:true,names:data.couriers.map(p=>p.name),selection:true}));
  }
}
module.exports=verify;
if(require.main===module){require('dotenv').config();const m=require('mongoose');(async()=>{try{
  await m.connect(process.env.MONGODB_URI||process.env.MONGODB_URL||process.env.MONGO_URL||process.env.MONGO_URI,{serverSelectionTimeoutMS:15000,autoIndex:false});await verify();
}catch(e){console.error('Verification failed:',e.name,e.code||'');process.exitCode=1;}finally{await m.disconnect();}})();}
