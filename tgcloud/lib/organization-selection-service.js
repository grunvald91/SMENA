import { db } from 'sdk';
import { eq } from 'sdk/db';
import { userOrganizationSelections } from '../schema.js';
import { DomainError } from './errors.js';
import { listMyOrganizations, requireOrganizationPermission } from './organization-directory.js';
import { resolveOrganizationSelection } from './organization-selection.js';

// A stored selection is ONLY a preference. Every read revalidates membership
// against current server-side grants (including revoked memberships).
export async function describeOrganizationSelection(tgId) {
  const available = await listMyOrganizations(tgId);
  const saved = await db.select().from(userOrganizationSelections)
    .where(eq(userOrganizationSelections.userTgId,tgId)).get();
  const state=resolveOrganizationSelection(available,saved?.orgId??null);
  return {organizations:available,selectedOrganization:state.selected,
    selectionRequired:state.selectionRequired};
}

// Never use this preference as authorization for existing owner-only operations;
// their migration to a scoped organization context is a separate reviewed step.
export async function chooseOrganization(tgId,orgId) {
  if (!Number.isSafeInteger(orgId) || orgId<=0)
    throw new DomainError('BAD_ORGANIZATION','Некорректная организация');
  const grant=await requireOrganizationPermission(tgId,orgId,'organization.view');
  const found=await db.select().from(userOrganizationSelections)
    .where(eq(userOrganizationSelections.userTgId,tgId)).get();
  if (found) {
    await db.update(userOrganizationSelections).set({orgId,updatedAt:Math.floor(Date.now()/1000)})
      .where(eq(userOrganizationSelections.userTgId,tgId)).run();
  } else {
    await db.insert(userOrganizationSelections).values({userTgId:tgId,orgId,
      updatedAt:Math.floor(Date.now()/1000)}).run();
  }
  return {selectedOrganization:grant};
}
