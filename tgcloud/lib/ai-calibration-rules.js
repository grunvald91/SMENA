export const FIRST_REVIEW_DAYS=14;
export const FOLLOWUP_DAYS=7;
const DAY=86400;
export function firstReviewDue(startedAt){return startedAt+DAY*FIRST_REVIEW_DAYS;}
export function followingReviewDue(dueAt){return dueAt+DAY*FOLLOWUP_DAYS;}
