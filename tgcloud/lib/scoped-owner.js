// Fail-closed interim guard for legacy owner-only operations.
// A selected membership in a different business does not authorize changing
// the original owner business.
export function legacyOwnerForSelection(legacyOwner,selection){
 if(!legacyOwner||!selection||selection.selectionRequired)return null;
 const chosen=selection.selectedOrganization;
 return chosen?.role==='owner'&&chosen.id===legacyOwner.id?legacyOwner:null;
}
export function canManageLegacyOrganization(legacyOwner,selection){
 return legacyOwnerForSelection(legacyOwner,selection)!==null;
}
