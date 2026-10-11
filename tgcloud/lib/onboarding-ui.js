// Bot API reply keyboards; no manual chat IDs.
export const ONBOARDING_BUTTONS=Object.freeze({
 create:'🏢 Создать бизнес',businesses:'🏬 Мои бизнесы',group:'💬 Подключить группу',team:'👥 Сотрудники',
 report:'📊 Отчёт',dashboard:'📱 Кабинет',cancel:'↩️ Отмена',
 chooseChat:'✅ Выбрать рабочую группу'
});
const B=ONBOARDING_BUTTONS;
export function mainKeyboard(hasBusiness,{hasMembership=false,canCreate=false}={}){
 const rows=hasBusiness
  ? [[{text:B.group}],[{text:B.team},{text:B.report}],[{text:B.dashboard}]]
  : hasMembership?[[{text:B.dashboard}]]:[[{text:B.create}]];
 if(hasMembership)rows.push([{text:B.businesses}]);
 if(!hasBusiness&&hasMembership&&canCreate)rows.push([{text:B.create}]);
 return {keyboard:rows,resize_keyboard:true,is_persistent:true,input_field_placeholder:'Выберите действие'};
}
export function cancelKeyboard(){return {keyboard:[[{text:B.cancel}]],resize_keyboard:true,one_time_keyboard:true};}
export function groupPickerKeyboard(requestId){
 if(!Number.isSafeInteger(requestId)||requestId<=0||requestId>2147483647)throw new Error('Некорректный запрос группы');
 return {keyboard:[[{text:B.chooseChat,request_chat:{request_id:requestId,chat_is_channel:false,bot_is_member:true,request_title:true}}],[{text:B.cancel}]],resize_keyboard:true,one_time_keyboard:true};
}
export function validateSharedChat(session,payload,stamp){
 if(!session||session.phase!=='choose_group'||session.expiresAt<=stamp)throw new Error('Запрос подключения группы устарел. Повторите выбор.');
 if(!payload||!Number.isSafeInteger(payload.request_id)||payload.request_id!==session.requestId)throw new Error('Получен ответ на другой запрос выбора группы');
 if(!Number.isSafeInteger(payload.chat_id)||payload.chat_id>=0)throw new Error('Выберите группу Telegram, не канал и не личный чат');
 return payload.chat_id;
}
export function isAdministrator(status){return status==='creator'||status==='administrator';}
export function canBotPostPhoto(member,chat=null){
 if(!member||['left','kicked'].includes(member.status))return false;
 if(member.status==='restricted')return member.is_member===true&&member.can_send_messages===true&&member.can_send_photos===true;
 if(member.status==='member'&&(chat?.permissions?.can_send_photos===false||chat?.permissions?.can_send_messages===false))return false;
 return member.status==='member'||isAdministrator(member.status);
}

export function businessChoiceLabel(grant,i){
 if(!grant||!Number.isSafeInteger(grant.id)||grant.id<=0)throw new Error('Неверная организация');
 return `🏬 ${i+1}. ${grant.name.slice(0,44)}`;
}
export function organizationPickerKeyboard(grants){
 if(!Array.isArray(grants)||!grants.length)throw new Error('Нет организаций');
 const rows=grants.map((grant,i)=>[{text:businessChoiceLabel(grant,i)}]);
 rows.push([{text:B.cancel}]);
 return {keyboard:rows,resize_keyboard:true,one_time_keyboard:true};
}
export function matchOrganizationChoice(label,grants){
 if(typeof label!=='string'||!Array.isArray(grants))return null;
 const index=grants.findIndex((grant,i)=>businessChoiceLabel(grant,i)===label);
 return index<0?null:grants[index];
}
