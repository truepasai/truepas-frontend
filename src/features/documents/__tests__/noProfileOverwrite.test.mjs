/** A rejected document never changes the profile. The old "Accept & update
 *  profile" screen (document/mismatch) copied identity-proofing's extractedName
 *  (Regula field 25, surname first on passports) into PUT /user/me, even when
 *  only the date of birth differed. It is gone, and nothing else may take a
 *  document's name or date of birth into the profile: the name changes only
 *  when the customer types it on the profile form. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rejectKind } from '../verifyOutcome.ts';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push({ file: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') });
    }
  }
  return out;
}

const ALL = sources();
const using = (pattern) => ALL.filter((s) => pattern.test(s.text)).map((s) => s.file).sort();
const read = (file) => readFileSync(join(SRC, file), 'utf8');

describe('the Accept & update profile screen is gone', () => {
  it('has no screen, route, flow flag or button left', () => {
    assert.equal(existsSync(join(SRC, 'app/document/mismatch.tsx')), false);
    assert.deepEqual(using(/document\/mismatch|document:mismatch/), []);
    assert.deepEqual(using(/Accept & update profile|handleAccept/), []);
  });
});

describe('only the profile form writes the profile', () => {
  it('useUpdateProfile is used by profile/edit alone', () => {
    assert.deepEqual(using(/useUpdateProfile\(/), ['app/profile/edit.tsx', 'features/auth/mutations.ts']);
  });

  it('api.updateProfile is called by that mutation alone', () => {
    assert.deepEqual(using(/api\.updateProfile\(/), ['features/auth/mutations.ts']);
  });

  it('no document value is ever assigned to the profile name or date of birth', () => {
    const copied = /(fullName|dateOfBirth)\s*:\s*[^,}\n]*(extracted\w*|docName|docDob|document\??\.|result\??\.|verdict\??\.)/;
    assert.deepEqual(using(copied), []);
  });

  it('the profile form starts from the profile, never from a document', () => {
    const edit = read('app/profile/edit.tsx');
    assert.match(edit, /useState\(user\?\.fullName \?\? ''\)/);
    assert.doesNotMatch(edit, /extracted|docName|document/i);
  });
});

describe('a rejected verification leaves the profile unchanged', () => {
  const flows = ['app/document/processing.tsx', 'app/family/add/processing.tsx', 'features/documents/verifyWithUploads.ts'];

  it('the verification flows never touch the profile', () => {
    for (const file of flows) {
      const text = read(file);
      assert.doesNotMatch(text, /updateProfile|useUpdateProfile|\/user\/me/, file);
    }
  });

  it('PROFILE_MISMATCH, a date-of-birth difference included, is a popup with no profile action', () => {
    // identity-proofing returns PROFILE_MISMATCH whether the name or only the
    // date of birth differs; the app has one answer for both.
    assert.equal(rejectKind('PROFILE_MISMATCH'), 'profile');
    const screen = read('app/document/processing.tsx');
    assert.match(screen, /confirmLabel="Scan again"/);
    assert.match(screen, /cancelLabel="Back to documents"/);
    assert.doesNotMatch(screen, /profile\/edit|router\.\w+\([^)]*profile/);
    assert.doesNotMatch(screen, /dateOfBirth|extractedDob[^\n]*profile/);
  });

  it('NAME_REVIEW_REQUIRED is a popup too, with no profile write', () => {
    assert.equal(rejectKind('NAME_REVIEW_REQUIRED'), 'review');
  });
});
