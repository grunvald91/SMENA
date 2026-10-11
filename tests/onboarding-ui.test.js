import test from 'node:test';
import assert from 'node:assert/strict';
import {ONBOARDING_BUTTONS,mainKeyboard,groupPickerKeyboard,validateSharedChat,isAdministrator,canBotPostPhoto,organizationPickerKeyboard,matchOrganizationChoice,mainKeyboard as menu} from '../tgcloud/lib/onboarding-ui.js';
test('menu for new org asks only for business, existing org offers actions',()=>{
 assert.equal(mainKeyboard(false).keyboard[0][0].text,ONBOARDING_BUTTONS.create);
 assert.equal(mainKeyboard(true).keyboard[0][0].text,ONBOARDING_BUTTONS.group);
 assert.equal(mainKeyboard(true).keyboard.length,3);
});
test('Telegram keyboard chooses group where bot is member, without manual chat ID',()=>{
 const choice=groupPickerKeyboard(123456).keyboard[0][0];
 assert.equal(choice.request_chat.bot_is_member,true);
 assert.equal(choice.request_chat.chat_is_channel,false);
 assert.equal(choice.request_chat.request_id,123456);
 assert.throws(()=>groupPickerKeyboard(0));
});
test('chat_shared must belong to unexpired pending request',()=>{
 const session={phase:'choose_group',requestId:19,expiresAt:200};
 assert.equal(validateSharedChat(session,{request_id:19,chat_id:-100100},100),-100100);
 assert.throws(()=>validateSharedChat(session,{request_id:20,chat_id:-100100},100));
 assert.throws(()=>validateSharedChat(session,{request_id:19,chat_id:99},100));
 assert.throws(()=>validateSharedChat(session,{request_id:19,chat_id:-1},200));
 assert.throws(()=>validateSharedChat(null,{request_id:19,chat_id:-1},100));
});
test('only Telegram administrators can link a group',()=>{
 assert.equal(isAdministrator('creator'),true);
 assert.equal(isAdministrator('administrator'),true);
 assert.equal(isAdministrator('member'),false);
});
test('photo posting eligibility rejects removed and restricted bots',()=>{
 assert.equal(canBotPostPhoto({status:'member'}),true);
 assert.equal(canBotPostPhoto({status:'restricted',is_member:true,can_send_messages:true,can_send_photos:true}),true);
 assert.equal(canBotPostPhoto({status:'restricted',is_member:true,can_send_messages:true,can_send_photos:false}),false);
 assert.equal(canBotPostPhoto({status:'left'}),false);
 assert.equal(canBotPostPhoto({status:'member'}, {permissions:{can_send_photos:false}}),false);
});

test('organization reply buttons show ordinal number, never internal IDs',()=>{
 const grants=[{id:923,name:'Мастерская'}, {id:21,name:'Мастерская'}];
 const keyboard=organizationPickerKeyboard(grants);
 assert.equal(keyboard.keyboard[0][0].text,'🏬 1. Мастерская');
 assert.equal(keyboard.keyboard[1][0].text,'🏬 2. Мастерская');
 assert.equal(matchOrganizationChoice('🏬 2. Мастерская',grants).id,21);
 assert.equal(matchOrganizationChoice('🏬 3. Мастерская',grants),null);
 assert.equal(menu(false,{hasMembership:true,canCreate:false}).keyboard[1][0].text,'🏬 Мои бизнесы');
});
