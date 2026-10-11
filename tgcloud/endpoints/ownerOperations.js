import {actor,handleEndpoint} from '../lib/endpoint.js';
import {correctShift,setEmployeeActive,salesContext,setSalesRule,addSalesEntry,resolveAttendance,resumeAttendance,assignRange,approvePayroll,resolveMissingShift} from '../lib/management.js';
import {createEmployeeInvite} from '../lib/employee-invitations.js';
import {createBonus} from '../lib/service.js';
import {requireInput} from '../lib/errors.js';
import {DomainError} from '../lib/errors.js';
export default async function(input,ctx){return handleEndpoint(async()=>{
 const owner=actor(ctx);
 switch(input?.action){
  case 'assignRange':return assignRange(owner,input);
  case 'approvePayroll':return approvePayroll(owner,input);
  case 'invite':return createEmployeeInvite(owner);
  case 'resolveMissing':return resolveMissingShift(owner,input);
  case 'correct':return correctShift(owner,input);
  case 'active':return setEmployeeActive(owner,input.employeeId,input.active,input.confirmed);
  case 'bonus':requireInput(input.confirmed===true,'CONFIRM_REQUIRED','Подтвердите добавление');return createBonus(owner,input.tgId,input.amountKopeks,input.reason,input.requestId);
  case 'salesContext':return salesContext(owner);
  case 'salesRule':return setSalesRule(owner,input);
  case 'sale':return addSalesEntry(owner,input);
  case 'resumeAttendance':return resumeAttendance(owner,input.intentId);
  case 'resolveAttendance':return resolveAttendance(owner,{...input,action:input.decision});
  default:throw new DomainError('BAD_ACTION','Операция не поддерживается');
 }
});}
