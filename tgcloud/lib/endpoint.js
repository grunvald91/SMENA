import { EndpointError } from 'sdk';
import { DomainError } from './errors.js';
export function actor(ctx) {
 const id=ctx?.initData?.user?.id;
 if(!Number.isSafeInteger(id)||id<=0)throw new EndpointError('Нет действительных Telegram-данных',{code:'UNAUTHORIZED'});
 return id;
}
export async function handleEndpoint(fn){
 try{return await fn();}
 catch(e){
  if(e instanceof EndpointError)throw e;
  if(e instanceof DomainError)throw new EndpointError(e.message,{code:e.code});
  console.error('endpoint error',e);
  throw new EndpointError('Внутренняя ошибка',{code:'INTERNAL_ERROR'});
 }
}
