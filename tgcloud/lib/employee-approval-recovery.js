// On-demand recovery only: no background scheduler. A Serverless invocation may
// stop between setting 'approving' and writing the final approval state.
export const APPROVAL_STALE_SECONDS=600;
export function staleApprovalAction(request,person,stamp){
 if(!request||request.status!=='approving'||!Number.isSafeInteger(request.updatedAt)||
  !Number.isSafeInteger(stamp)||stamp-request.updatedAt<APPROVAL_STALE_SECONDS)return null;
 return person?.active===1||person?.active===true?'approved':'pending';
}
