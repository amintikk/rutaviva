import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esc, km, titleCase } from '../src/data.ts';

test('formatting helpers', () => {
  assert.equal(km(37.3), 'km 37,3');
  assert.equal(titleCase('NOU DE BERGUEDÀ'), 'Nou de Berguedà');
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});
test('inverted province names', () => {
  assert.equal(titleCase('CORUÑA, A'), 'A Coruña');
  assert.equal(titleCase('PALMAS, LAS'), 'Las Palmas');
});
