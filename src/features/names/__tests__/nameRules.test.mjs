/** The app's name check mirrors customer-account-service's
 *  (app/person_name.py; same cases as its tests/test_person_name.py). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, nameError } from '../nameRules.ts';

const NFD = (s) => s.normalize('NFD');

describe('cleanName', () => {
  it('trims and collapses whitespace, nothing else', () => {
    assert.equal(cleanName('  Ann   Lee  '), 'Ann Lee');
    assert.equal(cleanName('Ann\tLee\nSmith'), 'Ann Lee Smith');
    assert.equal(cleanName('Ann Lee'), 'Ann Lee');
    assert.equal(cleanName('José O’Brien'), 'José O’Brien');
    assert.equal(cleanName('JOHN DOE'), 'JOHN DOE');
  });
});

describe('nameError: blank', () => {
  for (const value of ['', ' ', '     ', '\t', '\n', ' \t \n ', '  ', '　']) {
    it(`refuses ${JSON.stringify(value)}`, () => assert.equal(nameError(value), 'Enter a name'));
  }
  it('measures length after cleaning', () => {
    assert.match(nameError('  A  '), /at least 2/);
    assert.equal(nameError(`  ${'A'.repeat(100)}  `), null);
    assert.match(nameError('A'.repeat(101)), /at most 100/);
  });
  it('refuses control characters', () => {
    for (const value of ['Ann\u0000Lee', 'Ann\u001bLee', 'Ann\u007fLee', 'AnnLee']) {
      assert.match(nameError(value), /control or invalid/);
    }
  });
});

describe('nameError: any script', () => {
  const accepted = [
    'प्रिया शर्मा', 'ज़ोया ख़ान', 'ராஜேஷ் குமார்', 'অনন্যা দাস', 'ശ്രീ‍രാം', 'می‌خواهم',
    'مُحَمَّد علي', 'สมชาย ใจดี', '王小明', 'Мария Иванова', 'Nguyễn Văn An', NFD('José García'),
    'A. Kumar', 'A Kumar', 'R. K. Narayan', 'John Smith Jr.', 'Smith, Jr.',
    "O'Brien", 'O’Brien', 'ʼAbdu', 'Jean-Luc', 'Jean‐Luc', 'Mary-Kate Smith-Jones',
    'Gal·la Puig', 'ʻOkalani', 'Sukarno', 'Bo',
  ];
  for (const value of accepted) it(`accepts ${value}`, () => assert.equal(nameError(value), null));

  const refused = [
    'Ada123', 'John!', '@nna Lee', 'Ann_Lee', 'Ann; Lee', '-John', '. Kumar', "'", "''", '-.',
    'John--Smith', 'A..Kumar', "O''Brien", '😀 Smith', 'Ann‮Lee', 'Ann​Lee',
    '́Ann', '‍Ann', 'Zá̂̃̄̅lgo',
  ];
  for (const value of refused) it(`refuses ${JSON.stringify(value)}`, () => assert.notEqual(nameError(value), null));
});
