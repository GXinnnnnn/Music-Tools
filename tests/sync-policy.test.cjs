'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { FIELDS, normalizePolicy, effectiveFields, searchLocal, planPatch } = require('../source/core/sync-policy.cjs');

test('cover + artist + album cannot modify title, lyrics or other unselected tags', () => {
  const current = {tags:{title:'Original title',artist:'Existing artist',album:'',lyrics:'Keep lyrics'},cover:'existing-cover'};
  const policy = {fields:['cover','artist','album'],overwriteFields:['cover','artist']};
  assert.deepEqual(planPatch(current,{tags:{title:'Wrong title',artist:'New artist',album:'New album',lyrics:'Wrong lyrics',year:2026},cover:'new-cover'},policy),
    {tags:{artist:'New artist',album:'New album'},cover:'new-cover'});
  assert.deepEqual(current.tags,{title:'Original title',artist:'Existing artist',album:'',lyrics:'Keep lyrics'});
});
test('unchecked overwrite fills empty fields, retaining existing values and covers', () => {
  const policy={fields:['cover','artist','album'],overwriteFields:[]};
  const current={tags:{artist:'Already correct',album:'  '},cover:'keep-cover'};
  assert.deepEqual(effectiveFields(current,policy),['album']);
  assert.deepEqual(planPatch(current,{tags:{artist:'Wrong',album:'Album'},cover:'wrong-cover'},policy),{tags:{album:'Album'}});
});
test('empty and malformed selections do not fall back to all fields', () => {
  assert.deepEqual(normalizePolicy({fields:[],overwriteFields:FIELDS}),{fields:[],overwriteFields:[]});
  assert.deepEqual(planPatch({}, {tags:{title:'X'},cover:'data:x'}, {fields:[]}),{tags:{}});
  assert.deepEqual(normalizePolicy({fields:['artist','artist','__proto__'],overwriteFields:['album','artist']}),{fields:['artist'],overwriteFields:['artist']});
});
test('remote empty data never clears existing values even with overwrite on', () => {
  const policy={fields:FIELDS,overwriteFields:FIELDS};
  assert.deepEqual(planPatch({tags:{title:'keep'}},{tags:{title:' ',artist:null,track:0},cover:''},policy),{tags:{track:'0'}});
});
test('unselected embedded metadata cannot leak into search conditions', () => {
  const local={filename:'Recording-Composer.mp3',duration:123,tags:{title:'SECRET_TITLE',artist:'Public artist',album:'Public album',lyrics:'SECRET_LYRICS',comment:'SECRET_COMMENT',year:'SECRET_YEAR'}};
  const filtered=searchLocal(local,{fields:['cover','artist','album']});
  assert.deepEqual(filtered,{filename:'Recording-Composer.mp3',duration:123,artist:'Public artist',album:'Public album'});
  assert.doesNotMatch(JSON.stringify(filtered),/SECRET_/);
});
test('current drafts count as existing values for fill-only policy', () => {
  const current={tags:{album:'User draft'},cover:'draft-cover'};
  assert.deepEqual(planPatch(current,{tags:{album:'Remote album'},cover:'remote-cover'},{fields:['album','cover'],overwriteFields:[]}),{tags:{}});
  assert.deepEqual(effectiveFields(current,{fields:['album','cover'],overwriteFields:[]}),[]);
});
test('legacy fillOnly migration remains supported without explicit field arrays', () => {
  assert.equal(normalizePolicy().fields.length,13);
  assert.deepEqual(normalizePolicy({fillOnly:true}).overwriteFields,[]);
  assert.deepEqual(normalizePolicy({fillOnly:false}).overwriteFields,FIELDS);
});
