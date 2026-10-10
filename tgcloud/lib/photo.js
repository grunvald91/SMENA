import {requireInput,DomainError} from './errors.js';
export function decodeSelfie(base64){
 requireInput(typeof base64==='string' && base64.length>1000 && base64.length<=700000 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(base64),'BAD_PHOTO','Ожидается JPEG-снимок с камеры, не более 500 КБ');
 let data;try {const binary=atob(base64);data=Uint8Array.from(binary,c=>c.charCodeAt(0));}
 catch {throw new DomainError('BAD_PHOTO','Некорректная фотография');}
 requireInput(data.length>=1024 && data.length<=512000 && data[0]===0xff && data[1]===0xd8 &&
  data[data.length-2]===0xff && data[data.length-1]===0xd9,'BAD_PHOTO','Формат JPEG или размер некорректны');
 return data;
}
