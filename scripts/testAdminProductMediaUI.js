'use strict';
require('./isolatedTestGuard');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('Browser media controls remove actual selections and confirm saved deletion',async()=>{
 const cache=path.join(process.env.LOCALAPPDATA,'npm-cache/_npx');
 const found=fs.readdirSync(cache).map(dir=>path.join(cache,dir,'node_modules/playwright')).find(dir=>fs.existsSync(path.join(dir,'package.json')));
 assert.ok(found,'Cached Playwright required for browser media test');
 const browser=await require(found).chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=fs.readFileSync(path.join(__dirname,'../views/admin/product-editor.ejs'),'utf8');
  const section=source.slice(source.indexOf('      <section class="editor-step-card',source.indexOf('id="step-2')),source.indexOf('        <!-- Optional Video URL -->'));
  const start=source.lastIndexOf('      <section',source.indexOf('id="step-3-media"'));
  const html=require('ejs').render(source.slice(start,source.indexOf('        <!-- Optional Video URL -->')),{editingProduct:{},productForm:{images:['https://example.com/main.png','https://example.com/back.png']}});
  await page.route('https://example.com/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII=','base64')}));
  await page.setContent('<form>'+html+'</section></form>');
  await page.addScriptTag({path:path.join(__dirname,'../public/js/admin-product-media.js')});
  const file={name:'shirt.png',mimeType:'image/png',buffer:Buffer.from('fixture')};
  await page.locator('[name=gallery_images]').setInputFiles([file,{...file,name:'back.png'}]);
  assert.equal(await page.locator('[name=gallery_images]').evaluate(n=>n.files.length),2);
  await page.locator('[data-gallery-preview] > div').nth(1).getByRole('button',{name:'Delete',exact:true}).click();
  assert.deepEqual(await page.locator('[name=gallery_images]').evaluate(n=>Array.from(n.files,f=>f.name)),['back.png']);
  await page.locator('[name=gallery_images]').setInputFiles({...file,name:'side.png'});
  assert.equal(await page.locator('[name=gallery_images]').evaluate(n=>n.files.length),2);
  page.once('dialog',d=>d.dismiss());await page.locator('[data-gallery-preview] > div').first().getByRole('button',{name:'Delete',exact:true}).click();
  assert.equal(await page.locator('[name=remove_gallery_image]').count(),0);
  page.once('dialog',d=>d.accept());await page.locator('[data-gallery-preview] > div').first().getByRole('button',{name:'Delete',exact:true}).click();
  assert.equal(await page.locator('[name=remove_gallery_image]').inputValue(),'0');
  await page.locator('[name=main_image]').setInputFiles(file);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove Main Photo'}).click();
  assert.equal(await page.locator('[name=main_image]').evaluate(n=>n.files.length),0);
  assert.equal(await page.locator('[name=remove_main_image]').inputValue(),'on');
  await page.locator('[name=gallery_image_links]').fill('https://example.com/a.png\nhttps://example.com/b.png');
  await page.locator('[data-gallery-preview] > div').last().getByRole('button',{name:'Delete',exact:true}).click();
  assert.equal(await page.locator('[name=gallery_image_links]').inputValue(),'https://example.com/a.png');
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
});
