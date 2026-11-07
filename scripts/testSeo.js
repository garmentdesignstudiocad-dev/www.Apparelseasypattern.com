const assert=require('node:assert/strict');
process.env.SITE_URL='https://store.example.test';
const ejs=require('ejs');
const appearance=require('../config/appearance');
const seo=require('../services/seoService');

async function run(){
  assert.equal(seo.homeTitle,'Ready-to-Use Apparel Patterns | Apparel Easy Patterns');
  assert.equal(seo.homeDescription,'Explore ready-to-use garment pattern blocks, printable sewing patterns and optional editable DXF files. Browse the apparel pattern library for sampling and garment development.');

  const product={
    name:'Classic Shirt Block',slug:'classic-shirt-block',description:'A shirt pattern in PDF format.',
    images:['/images/basic-shirt-pattern.svg'],base_price:499,active:true,
  };
  const metadata=seo.productMetadata(product);
  assert.equal(metadata.seoTitle,'Classic Shirt Block | Garment Pattern | Apparel Easy Patterns');
  assert.equal(metadata.description,product.description);
  assert.equal(metadata.ogImage,'https://store.example.test/images/basic-shirt-pattern.svg');
  const structured=metadata.productStructuredData;
  assert.equal(structured['@type'],'Product');
  assert.equal(structured.name,product.name);
  assert.equal(structured.description,product.description);
  assert.equal(structured.image[0],'https://store.example.test/images/basic-shirt-pattern.svg');
  assert.equal(structured.offers.price,'499.00');
  assert.equal(structured.offers.priceCurrency,'INR');
  assert.equal('availability' in structured.offers,false);
  assert.equal('aggregateRating' in structured,false);
  assert.equal('review' in structured,false);
  assert.equal(seo.productData({...product,active:false}),null);
  assert.equal(seo.publicImageUrl('javascript:alert(1)'), '');
  assert.equal(seo.productMetadata({...product,description:'',images:[]}).description,product.name);
  assert.equal(seo.productMetadata({...product,images:[]}).productStructuredData,null);

  const settings=appearance.normalize();
  const head=await ejs.renderFile('views/partials/business-head.ejs',{
    title:'Homepage',seoTitle:seo.homeTitle,description:seo.homeDescription,
    canonicalUrl:'https://store.example.test/',ogImage:'https://store.example.test/logo.png',
    mode:'home',siteSettings:settings,themeVariables:appearance.cssVariables(settings),
    organizationData:null,jsonLd:seo.jsonLd,skipSharedSeo:true,
  });
  assert.match(head,/<title>Ready-to-Use Apparel Patterns \| Apparel Easy Patterns<\/title>/);
  assert.match(head,/<meta name="description" content="Explore ready-to-use garment pattern blocks, printable sewing patterns and optional editable DXF files\. Browse the apparel pattern library for sampling and garment development\.">/);
  assert.match(head,/<link rel="canonical" href="https:\/\/store\.example\.test\/">/);
  assert.match(head,/<meta property="og:image" content="https:\/\/store\.example\.test\/logo\.png">/);
  const Product=require('../models/mongo/Product'),find=Product.find,distinct=Product.distinct;
  const fixtures=[null,undefined,'',0,25].map((price,i)=>({name:'Fixture '+i,slug:'fixture-'+i,base_price:price}));
  fixtures.push({name:'Upcoming fixture',slug:'upcoming-fixture',status:'coming_soon',base_price:25});
  let rendered;
  try{
    Product.distinct=async()=>[];Product.find=()=>({sort:()=>({lean:async()=>fixtures})});
    await require('../controllers/productsController').listProducts({query:{}},{locals:{siteSettings:{products_seo_title:'Owner-edited title',products_seo_description:'Owner-edited description'}},render:(view,data)=>{rendered=data;}},error=>{throw error;});
  }finally{Product.find=find;Product.distinct=distinct;}
  assert.equal(rendered.seoTitle,'Owner-edited title');assert.equal(rendered.description,'Owner-edited description');
  const catalogue=await ejs.renderFile('views/products.ejs',{...rendered,siteSettings:settings,themeVariables:appearance.cssVariables(settings),...require('../config/features').helpers()});
  assert.match(catalogue,/<title>Owner-edited title<\/title>/);assert.match(catalogue,/<meta name="description" content="Owner-edited description">/);
  assert.equal((catalogue.match(/Price on enquiry/g)||[]).length,4);assert.match(catalogue,/From ₹25\.00/);assert.doesNotMatch(catalogue,/Coming soon\s*₹|₹0\.00/);
  console.log('PASS: owner-edited catalogue SEO reaches rendered metadata; missing/blank/zero prices do not claim a free price; Coming soon has no dangling currency.');
  console.log('PASS: homepage metadata, dynamic product metadata, safe image URLs, and factual Product structured data.');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
