import {buildPrivateBatch} from './ai-batch.js';

// One initial model call and one optional context-repair call. The model cannot
// trigger recursive history loading, even if it repeatedly requests it.
export async function analyzeWithSingleLookback({messages,options={},fetchPrevious,askModel}){
 if(!Array.isArray(messages)||messages.length===0||messages.length>60)throw new Error('INVALID_PRIMARY_BATCH');
 if(typeof fetchPrevious!=='function'||typeof askModel!=='function')throw new Error('INVALID_CONTEXT_HANDLER');
 let {payload,sourceMap}=buildPrivateBatch(messages,options);
 let response=await askModel(payload);
 let modelCalls=1,previousMessages=0;
 if(response?.needs_previous_context===true){
  const older=await fetchPrevious(messages);
  if(Array.isArray(older)&&older.length){
   const context=older.slice(0,30);
   previousMessages=context.length;
   ({payload,sourceMap}=buildPrivateBatch(messages,{...options,previous:context}));
   response=await askModel(payload);
   modelCalls=2;
  }
 }
 return {response,sourceMap,payload,modelCalls,previousMessages,
  inconclusive:response?.needs_previous_context===true};
}
