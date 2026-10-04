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
  console.log('PASS: homepage metadata, dynamic product metadata, safe image URLs, and factual Product structured data.');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
