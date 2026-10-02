const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const template=fs.readFileSync(require('node:path').join(__dirname,'../views/checkout.ejs'),'utf8');
const optionsCode=template.slice(template.indexOf("    const cityInput="),template.indexOf('    const productTotalElement'));
const fetchCode=template.slice(template.indexOf('    async function loadDeliveryRoute()'),template.indexOf('    async function updateSummary()'));
function element(){return {textContent:'',classList:{toggle(){},add(){},remove(){}}};}
async function run(){
  const elements={},requests=[];
  const select={value:'',options:[],replaceChildren(option){this.options=[option];this.value='';},add(option){this.options.push(option);}};
  const sandbox={document:{getElementById:id=>elements[id] ||= {...element(),value:id==='city'?'Tiruppur':id==='state'?'Tamil Nadu':''}},Option:function(text,value){this.text=text;this.value=value;},
    deliveryRequestId:0,deliveryRequired:true,courierSelect:select,courierHelp:element(),deliveryTotalElement:element(),deliveryEstimate:element(),
    deliveryEtaSummary:element(),estimatedDeliveryTime:element(),estimatedDeliveryDate:element(),deliveryStatus:element(),pincodeInput:{value:'560001'},
    formatCurrency:value=>'INR '+Number(value).toFixed(2),fetch:()=>new Promise(resolve=>requests.push(resolve))};
  vm.createContext(sandbox);vm.runInContext(optionsCode+fetchCode,sandbox);
  const first=sandbox.loadDeliveryRoute();
  elements.city.value='Coimbatore';sandbox.resetCouriers();sandbox.renderCourierSummary();
  const second=sandbox.loadDeliveryRoute();
  requests[1]({ok:true,json:async()=>({ok:true,pincode:'638751',district:'Tiruppur',state:'Tamil Nadu',region:'South',dispatch_location:'Bengaluru',couriers:[{_id:'destination',name:'Destination Courier',charge:250,estimated_delivery:'3-4 Days'}]})});await second;
  assert.equal(select.value,'','No courier is automatically selected');
  assert.equal(select.disabled,false,'Enabled partners enable dropdown');
  select.value='destination';sandbox.renderCourierSummary();
  assert.equal(elements['selected-courier-summary'].textContent,'Destination Courier');assert.equal(elements['dispatch-summary'].textContent,'Bengaluru');assert.deepEqual(select.options.map(option=>option.text),['Choose a delivery partner','Destination Courier']);
  requests[0]({ok:true,json:async()=>({ok:true,couriers:[{_id:'wrong',name:'Old destination',charge:999}]})});
  assert.equal((await first).stale,true);assert.equal(select.value,'destination');
  elements.city.value='Unknown';sandbox.resetCouriers();sandbox.renderCourierSummary();assert.equal(select.value,'');assert.equal(elements['dispatch-summary'].textContent,'');
  const third=sandbox.loadDeliveryRoute();requests[2]({ok:true,json:async()=>({ok:true,region_id:'south',region:'South',dispatch_location:'Bengaluru',couriers:[]})});await third;
  assert.equal(select.disabled,true);assert.equal(select.value,'');assert.match(sandbox.courierHelp.textContent,/No delivery partners have been enabled for the Bengaluru dispatch hub/);
  assert.equal(elements['region-summary'].textContent,'South');assert.equal(elements['dispatch-summary'].textContent,'Bengaluru');
  elements.state.value='';assert.equal(await sandbox.loadDeliveryRoute(),null);assert.equal(select.value,'');
  sandbox.deliveryRequired=false;assert.equal(await sandbox.loadDeliveryRoute(),0);
  assert.doesNotMatch(template,/Delivery Charges|Courier Charge|Pay Separately|Pay on Delivery/);assert.ok(select.options.every(option=>!option.text.includes('250')));
  assert.ok(!template.includes('Shipping to be arranged'));assert.ok(!template.includes('Preferred courier'));
  sandbox.showCouriers(['Blue Dart','DTDC','Delhivery','India Post / Speed Post'].map((name,index)=>({_id:String(index),name,estimated_delivery:'Not configured'})));
  assert.deepEqual(select.options.map(option=>option.text),['Choose a delivery partner','Blue Dart','DTDC','Delhivery','India Post / Speed Post']);
  assert.doesNotMatch(template,/Estimated Delivery|Estimated delivery|Not configured|estimated-delivery|delivery-eta-summary/);
  console.log('PASS: checkout UI destination refresh, stale-response rejection, explicit customer choice, dispatch summary without ETA, unconfigured/empty state reset, and digital courier bypass.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
