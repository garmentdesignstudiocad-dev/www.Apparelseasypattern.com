const path=require('node:path');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const MAX_MEASUREMENT_CSV_BYTES=10*1024*1024;
const MAX_MEASUREMENT_CSV_ROWS=10000;
const MAX_MEASUREMENT_CSV_ROW_BYTES=64*1024;
function validate(originalName,bytes,format,mime='',maxBytes=50*1024*1024){
  const ext=path.extname(originalName || '').toLowerCase();
  const native=['dxf','hpgl','plt','pdf'].includes(format);
  if(!native && !['techpack','measurement','marker','book','class_resource'].includes(format))fail('Choose a supported upload slot.');
  if(!(native?['.'+format,'.zip']:['.pdf','.zip']).includes(ext))fail(`Choose ${native?format.toUpperCase():'PDF'} or ZIP for this slot.`);
  if(!Buffer.isBuffer(bytes) || !bytes.length)fail('Choose a non-empty file.');
  if(bytes.length>maxBytes)throw Object.assign(new Error(`File exceeds the ${maxBytes/1024/1024} MB limit.`),{status:413});
  // MIME hints vary between macOS/Windows. Extension and content remain mandatory.
  const generic=['','application/octet-stream','binary/octet-stream','application/x-download'];
  const known={'.pdf':['application/pdf','application/x-pdf'],'.zip':['application/zip','application/x-zip-compressed','application/x-zip'],'.dxf':['application/dxf','application/x-dxf','image/vnd.dxf','image/x-dxf','application/acad','application/x-acad','text/plain'],'.hpgl':['application/vnd.hp-hpgl','application/x-hpgl','image/x-hpgl','text/plain'],'.plt':['application/vnd.hp-hpgl','application/x-hpgl','application/plt','image/x-hpgl','text/plain']};
  if(![...generic,...known[ext]].includes(String(mime).toLowerCase()))fail('File MIME type does not match its extension. Export the original file or upload a ZIP package.');
  const head=bytes.subarray(0,4096).toString('latin1');
  if(ext==='.pdf' && !head.startsWith('%PDF-'))fail('Invalid PDF content.');
  // Inspect the container signature only; never extract or rewrite archive entries.
  if(ext==='.zip' && !(bytes.length>=4 && ['504b0304','504b0506','504b0708'].includes(bytes.subarray(0,4).toString('hex'))))fail('Invalid ZIP content.');
  if(ext==='.dxf' && !head.startsWith('AutoCAD Binary DXF') && !/(?:^|[\r\n])\s*0\s*[\r\n]+\s*SECTION\s*(?:[\r\n]|$)/i.test(head))fail('Invalid DXF content.');
  if(['.hpgl','.plt'].includes(ext) && !/(?:^|[;\s])(?:IN|PU|PD|PA|PR|SP|IP|SC|BP|DF)[-+0-9.,\s]*(?:;|$)/i.test(head))fail('Invalid plotter content.');
  return ext;
}
function validateCsvContent(bytes){
  if(bytes.includes(0))return Promise.reject(Object.assign(new Error('Invalid CSV content.'),{status:400}));
  const csv=require('csv-parser');
  const {Readable}=require('node:stream');
  return new Promise((resolve,reject)=>{
    const parser=csv({strict:true,maxRowBytes:MAX_MEASUREMENT_CSV_ROW_BYTES});
    let headers=null,rows=0;
    parser.once('headers',values=>{
      headers=values;
      if(values.length<2 || values.length>100 || values.some(value=>!value.trim()) || new Set(values).size!==values.length){
        parser.destroy(Object.assign(new Error('CSV must have at least two unique, named columns.'),{status:400}));
      }
    });
    parser.on('data',row=>{
      rows++;
      if(rows>MAX_MEASUREMENT_CSV_ROWS){
        parser.destroy(Object.assign(new Error('CSV contains too many rows.'),{status:413}));
        return;
      }
      if(!Object.values(row).some(value=>String(value).trim()))rows--;
    });
    parser.once('error',error=>{
      reject(error.status ? error : Object.assign(new Error('Invalid CSV content or inconsistent columns.'),{status:400}));
    });
    parser.once('end',()=>{
      if(!headers || rows===0)return reject(Object.assign(new Error('CSV must include column headings and at least one measurement row.'),{status:400}));
      resolve();
    });
    Readable.from([bytes]).pipe(parser);
  });
}
async function validateMeasurement(originalName,bytes,mime=''){
  const ext=path.extname(originalName || '').toLowerCase();
  if(ext!=='.csv')return validate(originalName,bytes,'measurement',mime);
  if(!Buffer.isBuffer(bytes) || !bytes.length)fail('Choose a non-empty file.');
  if(bytes.length>MAX_MEASUREMENT_CSV_BYTES)throw Object.assign(new Error(`CSV exceeds the ${MAX_MEASUREMENT_CSV_BYTES/1024/1024} MB limit.`),{status:413});
  const generic=['','application/octet-stream','binary/octet-stream','application/x-download'];
  const csvMime=['text/csv','application/csv','application/vnd.ms-excel','text/plain'];
  if(![...generic,...csvMime].includes(String(mime).toLowerCase()))fail('File MIME type does not match its extension.');
  await validateCsvContent(bytes);
  return ext;
}
// Companion slots: a secondary attachment (PDF or ZIP) alongside the primary CAD/document slot.
// format values: 'dxf_pdf','dxf_zip','hpgl_pdf','hpgl_zip','plt_pdf','plt_zip',
//                'pdf_pdf','pdf_zip','techpack_pdf','techpack_zip',
//                'measurement_pdf','measurement_csv','measurement_zip','basic_measurement_pdf','basic_measurement_csv','basic_measurement_zip','marker_pdf','marker_zip'
const COMPANION_SLOTS=new Set(['dxf_pdf','dxf_zip','hpgl_pdf','hpgl_zip','plt_pdf','plt_zip','pdf_zip','techpack_pdf','techpack_zip','measurement_pdf','measurement_csv','measurement_zip','basic_measurement_pdf','basic_measurement_csv','basic_measurement_zip','marker_pdf','marker_zip']);
function validateCompanion(originalName,bytes,slot,mime='',maxBytes=50*1024*1024){
  if(!COMPANION_SLOTS.has(slot))fail('Choose a supported companion upload slot.');
  const expectedExt='.'+slot.split('_').pop(); // e.g. 'dxf_pdf' -> '.pdf'
  const ext=path.extname(originalName||'').toLowerCase();
  if(ext!==expectedExt && ext!=='.zip')fail(`Choose a ${expectedExt.slice(1).toUpperCase()} or ZIP for this companion slot.`);
  if(!Buffer.isBuffer(bytes)||!bytes.length)fail('Choose a non-empty file.');
  if(bytes.length>maxBytes)throw Object.assign(new Error(`File exceeds the ${maxBytes/1024/1024} MB limit.`),{status:413});
  const generic=['','application/octet-stream','binary/octet-stream','application/x-download'];
  const known={'.pdf':['application/pdf','application/x-pdf'],'.zip':['application/zip','application/x-zip-compressed','application/x-zip'],'.csv':['text/csv','application/csv','application/vnd.ms-excel','text/plain']};
  const allowedMime=[...generic,...(known[ext]||[])];
  if(!allowedMime.includes(String(mime).toLowerCase()))fail('File MIME type does not match its extension.');
  const head=bytes.subarray(0,4096).toString('latin1');
  if(ext==='.pdf'&&!head.startsWith('%PDF-'))fail('Invalid PDF content.');
  if(ext==='.zip'&&!(bytes.length>=4&&['504b0304','504b0506','504b0708'].includes(bytes.subarray(0,4).toString('hex'))))fail('Invalid ZIP content.');
  if(ext==='.csv')return validateCsvContent(bytes).then(()=>ext);
  return ext;
}
module.exports={validate,validateMeasurement,validateCompanion,COMPANION_SLOTS};
