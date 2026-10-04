const fs=require('node:fs/promises');
const {PDFDocument,StandardFonts,rgb,degrees}=require('pdf-lib');
// Brand and a partial order reference only: never embed email, phone, address or credentials.
async function copy(file,orderId){
  if((await fs.stat(file)).size>30*1024*1024)throw new Error('PDF exceeds watermark limit.');
  const bytes=await fs.readFile(file);
  if(bytes.length>30*1024*1024)throw new Error('PDF exceeds watermark limit.');
  const document=await PDFDocument.load(bytes);
  if(document.getPageCount()>200)throw new Error('PDF exceeds watermark page limit.');
  const font=await document.embedFont(StandardFonts.Helvetica);
  const reference=String(orderId).replace(/[^a-zA-Z0-9]/g,'').slice(-10);
  const label='Apparel Easy Patterns | Order '+reference;
  for(const page of document.getPages()){
    const {x,y,width,height}=page.getCropBox();
    const size=Math.max(4,Math.min(22,(width-32)/font.widthOfTextAtSize(label,1)));
    for(const fraction of [.25,.55,.8])page.drawText(label,{x:x+16,y:y+height*fraction,font,size,color:rgb(.32,.26,.22),opacity:.19,rotate:degrees(12)});
  }
  return Buffer.from(await document.save());
}
module.exports={copy};
