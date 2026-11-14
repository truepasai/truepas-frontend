// Source guards for the face flows: the screens can't be rendered under
// node --test, so this pins the wiring that makes every enrollment and update
// flow use the one shared camera, the order of the checks before a photo is
// sent, and what must not change (documents, the photo path under 5).
// Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
/** Source without comments, so a guard can't pass on a comment. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

const onboarding = code('app/(onboarding)/face-scan.tsx');
const faceUpdate = code('app/face-update/camera.tsx');
const family = code('app/family/add/face-capture.tsx');
const pin = code('app/face-update/pin.tsx');
const member = code('app/family/[id].tsx');
const addMember = code('app/family/add/index.tsx');
const camera = code('features/liveness/LivenessCamera.tsx');

describe('every face flow uses the one shared camera, behind the same permission gate', () => {
  it('user enrollment (onboarding): LivenessCamera in enroll mode', () => {
    assert.match(onboarding, /<CameraPermissionGate>\s*<LivenessCamera mode="enroll"/);
  });

  it("user face update, and a first face for a signed-in user: the same camera, update or enroll", () => {
    assert.match(faceUpdate, /<CameraPermissionGate[^>]*>\s*<LivenessCamera\s+mode=\{firstEnrolment \? 'enroll' : 'update'\}/);
  });

  it('family member enrollment and family member update: the same camera, with the member and their age', () => {
    assert.match(family, /<CameraPermissionGate[^>]*>\s*<LivenessCamera\s+mode=\{isUpdate \? 'update' : 'enroll'\}\s+personId=\{personId\}/);
    assert.match(family, /subjectAge=\{Number\.isFinite\(ageNum\) \? ageNum : undefined\}/);
    assert.match(faceUpdate, /subjectAge=\{Number\.isFinite\(ageNum\) \? ageNum : undefined\}/);
  });

  it('a member face update goes through the PIN step to the member capture, carrying their age', () => {
    assert.match(member, /pathname: '\/face-update\/pin',\s*params: \{ personId: id, name: first, age: String\(m\.age\), capture: isPhoto \? 'photo' : 'liveness' \}/);
    assert.match(pin, /pathname: capture === 'photo' \? '\/family\/add\/photo-capture' : '\/family\/add\/face-capture'/);
  });
});

describe('children under 5: one photo, never Regula', () => {
  it('adding a member under 5 starts with the document; the member page and updates pick the photo screen', () => {
    assert.match(addMember, /memberCaptureMode\(member, ageFromDob\(dob\)\)/);
    // Document first under 5: the backend refuses the photo until it is verified.
    assert.match(addMember, /if \(mode === 'photo'\) \{\s*router\.replace\(\{ pathname: '\/family\/add\/document'/);
    assert.doesNotMatch(addMember, /photo-capture/);
    assert.match(member, /const isPhoto = memberCaptureMode\(m\) === 'photo';/);
    assert.match(member, /const documentFirst = isPhoto && !docDone;/);
  });

  it('the shared camera starts no liveness session for a member under 5, even if reached', () => {
    assert.match(camera, /const photoOnly = !!personId && memberCaptureMode\(null, subjectAge\) === 'photo';/);
    assert.match(camera, /if \(hasPermission && liveness\.phase === 'idle' && !photoOnly\)/);
  });
});

describe('the under-5 photo screen: automatic and manual capture through one path', () => {
  const photo = code('premium/flows/familyPhotoCapture.tsx');

  it("watches the live camera with the 5+ camera's face detector output", () => {
    assert.match(photo, /createFaceDetectorOutput\(\{\s*\/?\/?[^}]*cameraFacing: cameraPosition,\s*performanceMode: 'fast',\s*runClassifications: true,/);
    assert.match(photo, /outputs=\{\[photoOutput, faceDetectorOutput\]\}/);
    assert.match(photo, /onStarted=\{\(\) => setLive\(machine\.cameraStarted\(\)\)\}/);
    assert.match(photo, /onError=\{cameraFailed\}/);
  });

  it('a completed hold and Take photo both go through takePhoto, which claims the one capture first', () => {
    assert.match(photo, /if \(capture\) void takePhoto\('auto'\);/);
    assert.match(photo, /onPress=\{\(\) => void takePhoto\('manual'\)\}/);
    assert.equal((photo.match(/takePhoto\('/g) ?? []).length, 2);
    // Take photo only while exactly one suitable face is in view.
    assert.match(photo, /disabled=\{!holding\}/);
    assert.match(photo, /const holding = phase === 'camera' && live\.status === 'holding';/);
    const claim = photo.indexOf('if (!machine.begin(trigger, Date.now())) return;');
    const shoot = photo.indexOf('photoOutput.capturePhotoToFile(');
    assert.ok(claim > 0 && shoot > claim);
    assert.equal((photo.match(/capturePhotoToFile\(/g) ?? []).length, 1);
  });

  it('the still photo is checked before the preview, and Save stays a tap gated on that check', () => {
    const check = photo.indexOf('const check = checkPhoto(');
    const preview = photo.indexOf("show({ phase: 'review', photo, check });");
    assert.ok(check > 0 && preview > check);
    assert.match(photo, /disabled=\{!canSavePhoto\(stage\)\}/);
    assert.match(photo, /onPress=\{\(\) => void save\(\)\}/);
    // Nothing saves from the live camera or the capture.
    const take = photo.slice(photo.indexOf('const takePhoto = async'), photo.indexOf('const retake = '));
    assert.doesNotMatch(take, /save\(\)|enrollFace|updateFace/);
  });

  it('retake and try again reset the capture and the hold', () => {
    assert.match(photo, /const backToCamera = \(\) => \{\s*setLive\(machine\.reset\(Date\.now\(\)\)\);/);
    assert.match(photo, /const retake = backToCamera;/);
  });

  it('offers no way on without the photo', () => {
    assert.doesNotMatch(photo, /Continue without photo|continueWithoutPhoto/);
  });
});

describe("the 5+ camera and the detector library's still-photo defect", () => {
  it('logs the defect by its own category and keeps the preview checks, as before', () => {
    const start = camera.indexOf('function stillPhotoProblem(');
    const still = camera.slice(start, camera.indexOf("? null : 'turned';", start));
    assert.ok(start > 0 && still.length > 0);
    assert.match(still, /category=\$\{isDetectorDefect\(detail\) \? 'detector_defect' : 'detector_failed'\}/);
    assert.match(still, /catch \(err\) \{[\s\S]*?return null;\s*\}/);
    // A photo the detector did judge is still refused for its problem.
    assert.match(still, /if \(!check\.ok\) return STILL_PROBLEMS\[check\.issue\] \?\? 'no_face';/);
  });
});

describe('the photo before Regula', () => {
  it('is taken only by the stable-face machine, one at a time', () => {
    assert.match(camera, /if \(state\.status === 'capture'\) void takeCapturePhoto\(\);/);
    assert.match(camera, /if \(takingPhoto\.current \|\| phaseRef\.current !== 'capturing'\) return;\s*takingPhoto\.current = true;/);
  });

  it('is checked on the phone before it is sent, and a refused photo is never sent', () => {
    const check = camera.indexOf('const problem = stillPhotoProblem(stillDetector, frame.uri, rules);');
    const refuse = camera.indexOf('refusePhoto(problemMessage(problem, subject));');
    const send = camera.indexOf('await submitCapture(fileUri);');
    assert.ok(check > 0 && refuse > check && send > refuse);
    assert.match(camera.slice(refuse, send), /return;/);
  });

  it('the old "capture anyway after 4 s" no longer applies to it', () => {
    assert.match(camera, /if \(liveness\.phase !== 'finalizing' \|\| capturing\) return;/);
    assert.doesNotMatch(camera, /faceSeenAt/);
  });

  it("Regula runs with the TruePas appearance, and its screen closing isn't a pass", () => {
    assert.match(camera, /await runRegulaLiveness\(config, appearance\);/);
    assert.match(camera, /<HandoffStage phase=\{regulaDone \? 'verifying' : 'opening'\}/);
  });

  it('a failed check keeps how it ended for its heading', () => {
    assert.match(camera, /failure=\{liveness\.failure\}/);
  });
});

describe('what stays as it was', () => {
  it('family setup still enrolls the face first, then the document', () => {
    assert.match(family, /router\.push\(\{ pathname: '\/family\/add\/document', params: docParams \}\)/);
    assert.match(family, /router\.replace\(\{ pathname: '\/family\/add\/document', params: docParams \}\)/);
  });

  it('no document screen or document module uses the face capture or Regula Face code', () => {
    for (const path of ['app/document/scan.tsx', 'features/documents/regulaScanner.ts']) {
      assert.doesNotMatch(code(path), /faceCapture|regulaAppearance|regulaFaceSdk|LivenessCamera/, path);
    }
  });

  it('the ML Kit challenge still runs only behind its flag', () => {
    const session = code('features/liveness/useLivenessSession.ts');
    assert.match(session, /process\.env\.EXPO_PUBLIC_LIVENESS_CHALLENGE_FALLBACK === 'true'/);
    assert.match(session, /if \(!fallsBackToChallenge\(apiErr, CHALLENGE_FALLBACK\)\)/);
  });
});
