// The face detector library's still-photo fix (patches/, applied by
// patch-package on every install): the version it was made for is the one
// installed, the installed native code carries it, and the live-camera code
// the 5+ flow uses is untouched. The native code itself only runs in a build
// on a device; this checks what goes into one.
// Run: npm test
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const ROOT = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const LIB = 'node_modules/react-native-vision-camera-face-detector/';
const PATCH = 'patches/react-native-vision-camera-face-detector+2.0.6.patch';
const ANDROID_IMAGE = 'android/src/main/java/com/margelo/nitro/camera/facedetector/HybridImageFaceDetector.kt';
const IOS_IMAGE = 'ios/HybridImageFaceDetector.swift';
const IOS_FACE = 'ios/HybridFace.swift';

describe('the detector stays at 2.0.6, patched on every install', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));

  it('is pinned exactly, in package.json and the lockfile', () => {
    assert.equal(pkg.dependencies['react-native-vision-camera-face-detector'], '2.0.6');
    assert.equal(lock.packages[''].dependencies['react-native-vision-camera-face-detector'], '2.0.6');
    assert.equal(lock.packages[`${LIB.slice(0, -1)}`].version, '2.0.6');
    assert.equal(JSON.parse(read(`${LIB}package.json`)).version, '2.0.6');
  });

  it('applies the patch after install, failing the install if it does not apply', () => {
    assert.equal(pkg.devDependencies['patch-package'], '8.0.1');
    assert.equal(pkg.scripts.postinstall, 'patch-package --error-on-fail --error-on-warn');
  });

  it('keeps the patch byte for byte: no CRLF conversion', () => {
    assert.match(read('.gitattributes'), /^\/patches\/\*\.patch -text$/m);
    assert.ok(existsSync(new URL(PATCH, ROOT)));
    assert.doesNotMatch(read(PATCH), /\r/);
  });

  it('changes the three still-photo files only', () => {
    const files = [...read(PATCH).matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1].replace(LIB, ''));
    assert.deepEqual(files.sort(), [ANDROID_IMAGE, IOS_FACE, IOS_IMAGE].sort());
  });
});

describe('the installed native code carries the fix', () => {
  it('Android unwraps the bridge value (InputImage.First / Third), as 2.1.0 does', () => {
    const kt = read(LIB + ANDROID_IMAGE);
    assert.match(kt, /private fun resolveInputImage\(\s*input: InputImage\s*\): String/);
    assert.match(kt, /is InputImage\.First -> input\.value/);
    assert.match(kt, /is InputImage\.Third -> input\.value\.uri/);
    assert.doesNotMatch(kt, /is Map<\*, \*>|input: Any\?/);
  });

  it('iOS unwraps it too (.first / .third), as 2.1.0 does', () => {
    const swift = read(LIB + IOS_IMAGE);
    assert.match(swift, /private func resolveInputImage\(\s*_ input: InputImage\s*\) throws -> String/);
    assert.match(swift, /case \.first\(let uri\):\s*return uri/);
    assert.match(swift, /case \.third\(let object\):\s*return object\.uri/);
    assert.doesNotMatch(swift, /input as\? String|as\? \[String: Any\]/);
  });

  it("iOS measures a still photo in its own pixels, unswapped, and marks it as one", () => {
    const swift = read(LIB + IOS_IMAGE);
    assert.match(swift, /let width = Double\(uiImage\.cgImage\?\.width \?\? Int\(uiImage\.size\.width \* uiImage\.scale\)\)/);
    assert.match(swift, /let height = Double\(uiImage\.cgImage\?\.height \?\? Int\(uiImage\.size\.height \* uiImage\.scale\)\)/);
    assert.doesNotMatch(swift, /Double\(uiImage\.size\.height\)/);
    assert.match(swift, /stillImage: true/);
    const face = read(LIB + IOS_FACE);
    assert.match(face, /stillImage: Bool = false/);
    assert.match(face, /if config\.stillImage \{\s*return Bounds\(\s*width: boundingBox\.width \* scaleX,\s*height: boundingBox\.height \* scaleY,\s*x: boundingBox\.minX \* scaleX,\s*y: boundingBox\.minY \* scaleY\s*\)/);
  });
});

describe('the live camera (the 5+ flow) is untouched', () => {
  it('its frames never take the still-photo path', () => {
    for (const file of ['ios/HybridFaceDetectorOutput.swift', 'ios/HybridFaceDetector.swift']) {
      assert.doesNotMatch(read(LIB + file), /stillImage/, file);
    }
  });

  it("keeps 2.0.6's camera-frame mapping, not 2.1.0's", () => {
    const face = read(LIB + IOS_FACE);
    assert.match(face, /x: boundingBox\.minY \* scaleX,\s*y: boundingBox\.minX \* scaleY/);
    assert.doesNotMatch(face, /pointTransformer|createIdentityPointTransformer/);
    assert.ok(!existsSync(new URL(`${LIB}android/src/main/java/com/margelo/nitro/camera/facedetector/MLKitCoordinateTransform.kt`, ROOT)));
    assert.ok(existsSync(new URL(`${LIB}android/src/main/java/com/margelo/nitro/camera/facedetector/FaceDetectorOrientation.kt`, ROOT)));
  });
});
