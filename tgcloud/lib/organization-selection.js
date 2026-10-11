// Pure selection logic. The list of grants must come from the trusted server.
// Never silently default to the first business when several are accessible.
export function resolveOrganizationSelection(available, preferredId = null) {
  if (!Array.isArray(available)) throw new TypeError('Expected organizations list');
  const valid = available.filter(o => Number.isSafeInteger(o?.id) && o.id > 0 &&
    typeof o.name === 'string' && ['owner', 'manager', 'employee'].includes(o.role));
  if (valid.length !== available.length) throw new TypeError('Invalid organization grant');
  const requested = valid.find(o => o.id === preferredId) || null;
  if (requested) return {selected:requested, selectionRequired:false, count:valid.length};
  if (valid.length === 1) return {selected:valid[0], selectionRequired:false, count:1};
  return {selected:null, selectionRequired:valid.length > 1, count:valid.length};
}
