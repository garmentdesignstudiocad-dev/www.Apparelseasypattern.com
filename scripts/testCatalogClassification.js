require('./isolatedTestGuard');
const assert = require('node:assert/strict');
const test = require('node:test');
const Product = require('../models/mongo/Product');
const ProductFile = require('../models/mongo/ProductFile');
const {listProducts} = require('../controllers/productsController');
const classification = require('../services/catalogClassification');

test('Admin type and fit assignments override contradictory marketing text', () => {
  const product = {department:'Men', product_type:'Casual Pant', fit:'Resort', name:'Slim Fit Shirt', category:'shirts'};
  assert.equal(classification.matchesType(product, 'casual-pant'), true);
  assert.equal(classification.matchesType(product, 'shirt'), false);
  assert.equal(classification.matchesFit(product, 'resort-fit'), true);
  assert.equal(classification.matchesFit(product, 'slim-fit'), false);
  assert.deepEqual(classification.breadcrumbs(product).map(c => c.href), [
    '/products?category=men', '/products?category=men&type=casual-pant', '/products?category=men&type=casual-pant&fit=resort'
  ]);
  assert.equal(classification.matchesType({category:'shirts'}, 'shirt'), true);
  assert.equal(classification.matchesType({product_type:'T-Shirt'}, 't-shirts'), true);
  assert.equal(classification.matchesType({product_type:'Dress'}, 'dresses'), true);
  assert.equal(classification.matchesFit({name:'Legacy Slim Fit Shirt'}, 'slim'), true);
});

test('Catalogue controller filters all departments and configured fits without inventing products', async () => {
  const originalFind = Product.find, originalFiles = ProductFile.find;
  const fixtures = [
    {_id:'1',department:'Men',product_type:'Shirt',fit:'Slim Fit',name:'First product',category:'men'},
    {_id:'2',department:'Men',product_type:'Shirt',fit:'Oversized',name:'Second product',category:'men'},
    {_id:'3',department:'Women',product_type:'Custom Dress',fit:'Resort',name:'Third product',category:'women'},
    {_id:'4',department:'Kids',product_type:'Shirt',fit:'Relaxed',name:'Boys shirt',category:'kids'},
    {_id:'5',department:'Kids',product_type:'Shirt',fit:'Relaxed',name:'Girls shirt',category:'kids'}
  ];
  Product.find = filter => {
    assert.deepEqual(filter, {active:true,status:{$ne:'draft'}});
    return {sort:()=>({lean:async()=>fixtures})};
  };
  ProductFile.find = () => ({lean:async()=>[]});
  try {
    async function list(query) {
      let result;
      await listProducts({query}, {locals:{},render:(view,data)=>{assert.equal(view,'products');result=data;}}, error=>{throw error;});
      return result;
    }
    const men = await list({category:'men',type:'shirt',fit:'slim'});
    assert.deepEqual(men.products.map(p=>p._id), ['1']);
    assert.deepEqual(men.availableFits, ['Slim Fit','Oversized']);
    assert.equal(men.selectedFit, 'slim-fit');
    assert.equal((await list({category:'men',type:'shirts'})).selectedType, 'shirt');
    assert.deepEqual((await list({category:'men',type:'shirt',fit:'oversized'})).products.map(p=>p._id), ['2']);
    assert.deepEqual((await list({category:'women',type:'custom-dress',fit:'resort'})).products.map(p=>p._id), ['3']);
    assert.deepEqual((await list({category:'kids',subcat:'boys'})).products.map(p=>p._id), ['4']);
    assert.deepEqual((await list({category:'kids',subcat:'girls'})).products.map(p=>p._id), ['5']);
    assert.equal((await list({category:'women',type:'jacket'})).products.length, 0);
  } finally {
    Product.find = originalFind;
    ProductFile.find = originalFiles;
  }
});
