import {db,api} from 'sdk';
import {eq} from 'sdk/db';
import {onboardingSessions} from '../schema.js';
import {ownerOrg,requireOwner,setup,bindChat} from './service.js';
import {DomainError,requireInput} from './errors.js';
import {validateSharedChat,isAdministrator,canBotPostPhoto,matchOrganizationChoice} from './onboarding-ui.js';
import {describeOrganizationSelection,chooseOrganization} from './organization-selection-service.js';
import {startEmployeeJoin,submitEmployeeName,checkPendingEmployee,approveEmployeeRequest} from './employee-invitations.js';
const now=()=>Math.floor(Date.now()/1000);
const TTL=15*60;
const validUserId=id=>Number.isSafeInteger(id)&&id>0;
const requireSessionUser=id=>requireInput(validUserId(id),'UNAUTHORIZED','Требуется вход через Telegram');

export async function getOnboardingSession(tgId){
 requireSessionUser(tgId);
 const found=await db.select().from(onboardingSessions).where(eq(onboardingSessions.userTgId,tgId)).get();
 return found?.expiresAt>now()?found:null;
}
async function storeSession(tgId,phase,requestId=null){
 requireSessionUser(tgId);
 const values={userTgId:tgId,phase,requestId,expiresAt:now()+TTL,updatedAt:now()};
 const current=await db.select().from(onboardingSessions).where(eq(onboardingSessions.userTgId,tgId)).get();
 if(current)await db.update(onboardingSessions).set(values).where(eq(onboardingSessions.userTgId,tgId)).run();
 else await db.insert(onboardingSessions).values(values).run();
 return values;
}
export async function cancelOnboarding(tgId){
 requireSessionUser(tgId);
 await db.delete(onboardingSessions).where(eq(onboardingSessions.userTgId,tgId)).run();
}
export async function beginBusinessOnboarding(tgId){
 requireSessionUser(tgId);
 requireInput(!(await ownerOrg(tgId)),'ALREADY_EXISTS','Бизнес уже подключён. Для второго бизнеса понадобится новый интерфейс организаций.');
 return storeSession(tgId,'business_name');
}
export async function finishBusinessOnboarding(tgId,name){
 const session=await getOnboardingSession(tgId);
 requireInput(session?.phase==='business_name','EXPIRED','Сначала выберите «Создать бизнес»');
 const business=await setup(tgId,name);
 await cancelOnboarding(tgId);
 return business;
}
function newRequestId(){
 const bytes=new Uint32Array(1);
 if(!globalThis.crypto?.getRandomValues)throw new DomainError('NO_CRYPTO','Не удалось безопасно создать запрос подключения');
 globalThis.crypto.getRandomValues(bytes);
 return (bytes[0]&0x7fffffff)||1;
}
export async function beginGroupOnboarding(tgId){
 await requireOwner(tgId);
 const requestId=newRequestId();
 await storeSession(tgId,'choose_group',requestId);
 return {requestId};
}
export async function finishGroupOnboarding(tgId,sharedChat){
 requireSessionUser(tgId);
 await requireOwner(tgId);
 const session=await getOnboardingSession(tgId);
 let chatId;
 try{chatId=validateSharedChat(session,sharedChat,now());}
 catch(error){throw new DomainError('BAD_CHAT_SELECTION',error.message);}
 let chat,ownerMember,me,botMember;
 try{
  [chat,ownerMember,me]=await Promise.all([
   api.getChat({chat_id:chatId}),
   api.getChatMember({chat_id:chatId,user_id:tgId}),
   api.getMe()
  ]);
  botMember=await api.getChatMember({chat_id:chatId,user_id:me.id});
 }catch{
  throw new DomainError('GROUP_ACCESS','Добавьте бота в выбранную группу и разрешите ему отправлять сообщения и фотографии, затем повторите подключение.');
 }
 requireInput(['group','supergroup'].includes(chat?.type),'BAD_CHAT','Можно выбрать только рабочую группу, не канал');
 requireInput(isAdministrator(ownerMember?.status),'GROUP_ADMIN_REQUIRED','Подключить группу может только её администратор');
 requireInput(canBotPostPhoto(botMember,chat),'BOT_CANNOT_POST','Разрешите боту отправлять фотографии в группе');
 const location=await bindChat(tgId,chatId,(chat.title||sharedChat.title||'Рабочая точка').trim());
 await cancelOnboarding(tgId);
 return location;
}

export async function beginBusinessSwitch(tgId){
 requireSessionUser(tgId);
 const {organizations}=await describeOrganizationSelection(tgId);
 requireInput(organizations.length>0,'NO_ORGANIZATION','Пока нет доступных организаций');
 await storeSession(tgId,'choose_organization');
 return organizations;
}
export async function finishBusinessSwitch(tgId,label){
 requireSessionUser(tgId);
 const session=await getOnboardingSession(tgId);
 requireInput(session?.phase==='choose_organization','NO_SELECTION','Сначала нажмите «Мои бизнесы»');
 const {organizations}=await describeOrganizationSelection(tgId);
 const chosen=matchOrganizationChoice(label,organizations);
 requireInput(!!chosen,'BAD_ORGANIZATION','Организация не найдена. Повторите выбор.');
 const result=await chooseOrganization(tgId,chosen.id);
 await cancelOnboarding(tgId);
 return result.selectedOrganization;
}

export async function beginEmployeeJoinByLink(tgId,token){
 const res=await startEmployeeJoin(tgId,token);
 if(res.kind==='name')await storeSession(tgId,'employee_name',res.id);
 return res;
}
export async function finishEmployeeJoinName(tgId,name){
 const session=await getOnboardingSession(tgId);
 requireInput(session?.phase==='employee_name'&&Number.isSafeInteger(session.requestId),
  'NO_JOIN','Откройте действительную ссылку-приглашение ещё раз');
 const result=await submitEmployeeName(tgId,session.requestId,name);
 await cancelOnboarding(tgId);
 return result;
}
export async function beginEmployeeApproval(tgId,requestId){
 const info=await checkPendingEmployee(tgId,requestId);
 await storeSession(tgId,'employee_rate',requestId);
 return info;
}
export async function finishEmployeeApproval(tgId,hourlyKopeks){
 const session=await getOnboardingSession(tgId);
 requireInput(session?.phase==='employee_rate'&&Number.isSafeInteger(session.requestId),
  'NO_JOIN','Сначала выберите заявку сотрудника');
 const result=await approveEmployeeRequest(tgId,session.requestId,hourlyKopeks);
 await cancelOnboarding(tgId);
 return result;
}
