// Select supported multimodal extractors without guessing a file's contents.
// Real bytes are checked again before transfer; unknown formats stay queued.
export function supportedAttachment(row){
 const mime=String(row?.mimeType||'').toLowerCase().split(';')[0].trim();
 const name=String(row?.fileName||'').toLowerCase();
 const kind=row?.kind;
 if(kind==='photo')return {mode:'image',mime:'image/jpeg'};
 if(mime==='application/pdf'||(kind==='document'&&name.endsWith('.pdf')))return {mode:'pdf',mime:'application/pdf'};
 if(['image/jpeg','image/png','image/webp'].includes(mime))return {mode:'image',mime};
 if(['audio/ogg','application/ogg'].includes(mime)||kind==='voice')return {mode:'audio',mime:'audio/ogg',format:'ogg'};
 if(['audio/mpeg','audio/mp3'].includes(mime))return {mode:'audio',mime:'audio/mpeg',format:'mp3'};
 if(mime==='audio/mp4'||mime==='audio/x-m4a')return {mode:'audio',mime:'audio/mp4',format:'m4a'};
 if(mime==='audio/wav'||mime==='audio/x-wav')return {mode:'audio',mime:'audio/wav',format:'wav'};
 if(mime==='video/mp4'||kind==='video_note'||(kind==='animation'&&mime==='video/mp4'))return {mode:'video',mime:'video/mp4'};
 return null;
}
export function bytesMatchAttachment(desc,bytes){
 if(!desc||!bytes||bytes.length<24)return false;
 const head=n=>String.fromCharCode(...bytes.slice(0,n));
 switch(desc.mode){
 case 'pdf':return head(4)==='%PDF';
 case 'image':
  if(desc.mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
  if(desc.mime==='image/png')return head(4)==='\x89PNG';
  if(desc.mime==='image/webp')return head(4)==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  return false;
 case 'audio':
  if(desc.format==='ogg')return head(4)==='OggS';
  if(desc.format==='mp3')return head(3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
  if(desc.format==='wav')return head(4)==='RIFF';
  if(desc.format==='m4a')return String.fromCharCode(...bytes.slice(4,8))==='ftyp';
  return false;
 case 'video':return String.fromCharCode(...bytes.slice(4,8))==='ftyp';
 default:return false;
 }
}
