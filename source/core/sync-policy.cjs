'use strict';

const FIELDS = Object.freeze(['cover','title','artist','album','albumArtist','year','track','disc','genre','composer','lyricist','comment','lyrics']);
const TAG_FIELDS = FIELDS.filter(key => key !== 'cover');
const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
const valid = values => [...new Set(values.filter(key => FIELDS.includes(key)))];
function normalizePolicy(options = {}) {
  const fields = Array.isArray(options.fields) ? valid(options.fields) : [...FIELDS];
  const overwriteFields = Array.isArray(options.overwriteFields)
    ? valid(options.overwriteFields).filter(key => fields.includes(key))
    : options.fillOnly === false ? [...fields] : [];
  return { fields, overwriteFields };
}
function currentTags(current = {}) { return current.tags || current; }
function effectiveFields(current = {}, options = {}) {
  const policy = normalizePolicy(options), tags = currentTags(current);
  return policy.fields.filter(key => policy.overwriteFields.includes(key) || !hasValue(key === 'cover' ? current.cover : tags[key]));
}
function searchLocal(local = {}, options = {}) {
  const fields = normalizePolicy(options).fields, tags = currentTags(local);
  // File identity and technical duration are always available to locate a recording.
  // Unselected embedded tag values never become query/scoring conditions.
  const result = { filename: local.filename || '', duration: local.duration || null };
  for (const key of TAG_FIELDS) if (fields.includes(key) && hasValue(tags[key])) result[key] = tags[key];
  return result;
}
function planPatch(current = {}, proposal = {}, options = {}) {
  const allowed = effectiveFields(current, options), incoming = proposal.tags || proposal, tags = {};
  for (const key of TAG_FIELDS) if (allowed.includes(key) && hasValue(incoming[key])) tags[key] = String(incoming[key]);
  const result = { tags };
  if (allowed.includes('cover') && hasValue(proposal.cover)) result.cover = proposal.cover;
  return result;
}
module.exports = { FIELDS, TAG_FIELDS, hasValue, normalizePolicy, effectiveFields, searchLocal, planPatch };
