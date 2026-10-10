import {actor,handleEndpoint} from '../lib/endpoint.js';
import {addEmployee,changeRate,setShiftBonus,createBonus} from '../lib/service.js';
import {DomainError} from '../lib/errors.js';
export default async function(input,ctx){return handleEndpoint(async()=>{
 const owner=actor(ctx);
 switch(input?.action){
  case 'add': return addEmployee(owner,input.tgId,input.name,input.hourlyKopeks);
  case 'rate': return changeRate(owner,input.tgId,input.hourlyKopeks);
  case 'shiftBonus': return setShiftBonus(owner,input.tgId,input.shiftBonusKopeks);
  case 'bonus': return createBonus(owner,input.tgId,input.amountKopeks,input.reason);
  default: throw new DomainError('BAD_ACTION','Операция с сотрудником не поддерживается');
 }
});}
