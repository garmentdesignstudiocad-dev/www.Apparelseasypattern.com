const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ejs = require('ejs');
const { defaults, helpers } = require('../config/features');
const siteSettings = require('../config/appearance').normalize();
const business = require('../config/business');
async function render(file, settings, extra = {}) {
  return ejs.renderFile('views/' + file + '.ejs', {
    siteSettings, themeVariables:require('../config/appearance').cssVariables(siteSettings), title:'Studio', products:[], courses:[], webinars:[], books:[], articles:[],
    business, errors:[], values:{}, corporate:false, source:'/contact', interest:'Other', csrf:'test',
    ...helpers(settings, 'https://studio.example'), ...extra,
  });
}
function mobileMenu(html) {
  // Execute the real mobile menu handler against the server-rendered navigation.
  // Desktop and mobile use this same DOM; opening the menu must not add links.
  const navHtml = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)[0];
  const links = [...navHtml.matchAll(/href="([^"]+)"/g)].map(match => ({ href:match[1], addEventListener(){} }));
  const classes = new Set();
  const handlers = {}, attributes = {};
  const nav = { classList:{ toggle(key){ if(classes.has(key)){classes.delete(key);return false;}classes.add(key);return true;}, remove(key){classes.delete(key);} }, querySelectorAll:()=>links };
  const toggle = { addEventListener:(name,fn)=>handlers[name]=fn, setAttribute:(key,value)=>attributes[key]=value };
  vm.runInNewContext(fs.readFileSync('public/js/main.js','utf8'), {
    document:{addEventListener:(_,fn)=>fn(),getElementById:id=>id==='nav-toggle'?toggle:id==='main-nav'?nav:null,querySelectorAll:()=>[],body:{classList:{toggle(){},remove(){}}}},
    window:{matchMedia:()=>({matches:true})},
  });
  handlers.click(); assert.equal(attributes['aria-expanded'],'true'); assert.ok(classes.has('open'));
  handlers.click(); assert.equal(attributes['aria-expanded'],'false');
  return links;
}
(async()=>{
  for(const [key,url] of Object.entries({patterns:'/products',online_classes:'/classes',courses:'/courses',webinars:'/webinars',books:'/books',consulting:'/consulting',updates:'/updates'})) {
    for(const enabled of [false,true]) {
      const settings={...defaults,[key+'_enabled']:enabled}, policy=helpers(settings);
      const home=await render('home',settings);
      const links=mobileMenu(home);
      assert.equal(links.some(link=>link.href===url),enabled,key+' desktop/mobile');
      for(const file of ['home','partials/footer','partials/business-cta','partials/lead-form']) {
        const html=await render(file,settings);
        for(const match of html.matchAll(/href="([^"]+)"/g)) assert.ok(policy.canVisit(match[1]),key+' '+file+' leaked '+match[1]);
        if(file==='partials/lead-form') for(const match of html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)) assert.ok(policy.visibleInterest(match[1]));
      }
    }
  }
  const off=Object.fromEntries(Object.keys(defaults).map(key=>[key,false]));
  assert.equal((await render('partials/business-cta',off)).trim(),'');
  for(const file of ['partials/business-cards','partials/learning-cards']) assert.equal((await render(file,off,{kind:'books',items:[]})).trim(),'');
  assert.ok(!(await render('partials/footer',off)).includes('<h5>Ordering</h5>'));
  assert.ok(!(await render('home',{...off,homepage_services_enabled:true})).includes('<h2>Our Services</h2>'));
  const policy=helpers({...defaults,books_enabled:false},'https://studio.example');
  assert.equal(policy.canVisit('https://studio.example/books/digital-book'),false);
  assert.equal(policy.canVisit('https://elsewhere.example/books'),true);
  const css=fs.readFileSync('public/css/customer-experience.css','utf8');
  assert.match(css,/@media\s*\(max-width:800px\)/);
  assert.match(css,/\.main-nav\.open\s*\{\s*display:block/);
  console.log('PASS: all seven sections OFF/ON in shared desktop/mobile menu, actual mobile toggle handler, homepage, footer, CTAs, enquiry discovery, empty cards/groups and same-origin promotion links.');
})().catch(error=>{console.error(error);process.exitCode=1;});
