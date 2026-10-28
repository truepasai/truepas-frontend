/** @jsxImportSource react */
/**
 * Family document processing — runs after a member's document scan (the
 * last step of adding a member, "Continue setup", or "Add a document").
 * Adds the document to the member (POST /documents, no number — the server
 * reads it), uploads the images through presigned URLs and verifies it
 * (verifyDocumentWithUploads, backend §6.2/§6.4). Photo documents are
 * compared with the member's ENROLLED face — the add flow sets the face up
 * first (§1.2/§7.1). Results are approved or rejected only:
 *  - approved → back to the member page — for a twin without a check-in PIN
 *    yet, with the PIN step on top (the last setup step).
 *  - rejected → the server's reasonMessage plus one action picked by
 *    reasonCode: FACE_NOT_ENROLLED (e.g. an older member who skipped the
 *    face) → "Set up face" opens their face capture, then the document step
 *    again; unreadable/inconclusive → rescan; anything else → choose
 *    another document.
 *  - request failed → Retry (reuses the created document).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FileX, RotateCcw, ScanFace, ScanLine, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { documentKeys, refreshAfterVerify, useAddDocument } from '@/features/documents/hooks';
import { errorFields, startDocLog, type DocLog } from '@/features/documents/verifyLog';
import {
  DEFAULT_REJECTION_MESSAGE,
  isApproved,
  rejectionAction,
  REJECTION_ACTION_LABEL,
  verifyDocumentWithUploads,
} from '@/features/documents/verifyWithUploads';
import { familyKeys, isTwin, memberCaptureMode, useFamilyMember } from '@/features/family/hooks';
import { FaceRing, Medallion } from '@/premium/blocks';
import { StepCard, stagedSteps } from '@/premium/flows/family';
import { Banner } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Footer, Heading, TopBar } from '@/premium/ui';
import { clearDocumentImages, saveDocumentImages } from '@/services/documentImageStore';
import { clearScanResult, getScanResult } from '@/services/scanStore';
import type { DocumentType, IdentityDocument, VerifyDocumentResponse } from '@/types/domain';

type Status = 'working' | 'approved' | 'rejected' | 'error';

const DOC_LABELS: Record<DocumentType, string> = {
  passport: 'Passport',
  drivingLicense: "Driver's License",
  idCard: 'ID Card',
  greenCard: 'US Green Card',
  birthCertificate: 'Birth Certificate',
  usVisa: 'U.S. Visa',
};

const STEP_LABELS = ['Adding document', 'Uploading photos', 'Verifying document'];

export default function FamilyProcessingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = useLocalSearchParams<{ type?: string; personId?: string; name?: string; band?: string }>();
  const personId = params.personId || undefined;
  const docType = (params.type || 'passport') as DocumentType;
  const { data: member } = useFamilyMember(personId);
  const first = (params.name || member?.name || '').trim().split(' ')[0];

  const [status, setStatus] = useState<Status>('working');
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<VerifyDocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(true);
  const [noScan, setNoScan] = useState(false);
  const addDocument = useAddDocument();
  // Retry-safe: a retry after a failed upload/verify reuses the document.
  const createdDocRef = useRef<IdentityDocument | null>(null);
  const processRef = useRef<(() => Promise<void>) | null>(null);
  // Retries of this screen, for the attempt log.
  const attemptRef = useRef(0);

  const memberPage = () =>
    personId ? router.dismissTo({ pathname: '/family/[id]', params: { id: personId } }) : router.dismissTo('/(tabs)');

  /** After a verify: drop this member's earlier failed/unverified tries of
   *  the same type (after an approval the server already removes older
   *  verified ones, §6.5), and the phone scans of any copy the server dropped
   *  (`sameTypeBefore`). */
  const removeLeftovers = async (keepId: string, log: DocLog, sameTypeBefore: string[]) => {
    if (!personId) return;
    try {
      const docs = await api.getDocuments(personId);
      for (const id of sameTypeBefore) {
        if ((docs ?? []).some((d) => d.id === id)) continue;
        clearDocumentImages(id).catch(() => {});
        log.info('cleared replaced copy', { document: id });
      }
      for (const d of docs ?? []) {
        if (d.id === keepId || d.type !== docType || d.status === 'verified') continue;
        try {
          await api.removeDocument(d.id);
          await clearDocumentImages(d.id);
          log.info('removed leftover', { document: d.id, status: d.status });
        } catch (e) {
          // Leave it — the member page still lists it.
          log.warn('leftover not removed', { document: d.id, ...errorFields(e) });
        }
      }
    } catch (e) {
      // List unavailable — nothing to tidy.
      log.warn('leftover lookup failed', errorFields(e));
    }
    void queryClient.invalidateQueries({ queryKey: documentKeys.all });
  };

  const refreshReads = (docId: string) => {
    // Documents, identity, security score, account activity, images.
    refreshAfterVerify(queryClient, docId);
    // Member verification state and member activity.
    void queryClient.invalidateQueries({ queryKey: familyKeys.all });
  };

  const process = async () => {
    if (!personId) {
      router.dismissTo('/(tabs)');
      return;
    }
    setStatus('working');
    setError(null);
    setNoScan(false);
    const log = startDocLog({ flow: 'family', person: personId, type: docType, retry: attemptRef.current++ || undefined });
    try {
      const scan = getScanResult();
      if (!scan?.documentImageBase64) {
        setNoScan(true);
        throw new Error('No document photo found. Please scan it again.');
      }
      let doc = createdDocRef.current;
      if (!doc) {
        setStepIndex(0);
        doc = await log.step(
          'create document',
          () => addDocument.mutateAsync({ type: docType, label: DOC_LABELS[docType], expiresAt: null, personId }),
          (d) => ({ document: d.id }),
        );
        createdDocRef.current = doc;
        try {
          await saveDocumentImages(doc.id, {
            front: scan.documentPreviewBase64 ?? scan.documentImageBase64,
          });
        } catch (e) {
          // Display copy only — verification doesn't need it.
          log.warn('local copy not saved', errorFields(e));
        }
      } else {
        log.info('reusing document', { document: doc.id });
      }
      // This member's same-type documents before verifying: an approval makes
      // the server drop the older verified copy, whose scan is on this phone.
      const sameTypeBefore = (queryClient.getQueryData<IdentityDocument[]>(documentKeys.member(personId)) ?? [])
        .filter((d) => d.type === docType && d.id !== doc.id)
        .map((d) => d.id);
      const verdict = await verifyDocumentWithUploads({
        documentId: doc.id,
        frontBase64: scan.documentImageBase64,
        backBase64: scan.backImageBase64,
        onStep: (s) => setStepIndex(s === 'uploading' ? 1 : 2),
        log,
      });
      refreshReads(doc.id);
      clearScanResult();
      if (isApproved(verdict)) {
        log.end('approved', { document: doc.id });
        setStatus('approved');
        void removeLeftovers(doc.id, log, sameTypeBefore);
        toast({ variant: 'success', title: `${DOC_LABELS[docType]} verified` });
        memberPage();
        if (isTwin(member) && !member?.checkInPinSet) {
          router.push({ pathname: '/family/add/set-pin', params: { personId, name: first } });
        }
        return;
      }
      // Rejected: don't leave a "Not verified" copy on the member page — it
      // reads as added. The reason is shown here; earlier unverified tries
      // of this type go too (removeLeftovers keeps a verified one).
      try {
        await api.removeDocument(doc.id);
        await clearDocumentImages(doc.id);
        createdDocRef.current = null;
        log.info('discarded this attempt', { document: doc.id });
      } catch (e) {
        log.warn('document not removed', { document: doc.id, ...errorFields(e) });
      }
      void removeLeftovers(doc.id, log, sameTypeBefore);
      log.end('rejected', { reason: verdict.reasonCode, match: verdict.matchScore });
      setResult(verdict);
      setStatus('rejected');
    } catch (err) {
      const apiErr = toApiError(err);
      log.end('error', { ...errorFields(err), shown: apiErr.message });
      setRetryable(apiErr.retryable);
      setError(apiErr.message || "Couldn't check the document. Please try again.");
      setStatus('error');
    }
  };

  useEffect(() => {
    processRef.current = process;
    // Defer to a microtask — process() updates state synchronously, which is
    // not allowed directly inside an effect (react-hooks/set-state-in-effect).
    queueMicrotask(() => void process());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rescan = () =>
    router.replace({
      pathname: '/document/scan',
      params: { type: docType, family: '1', personId: personId ?? '', name: first, band: params.band ?? '' },
    });

  // The document picker sits right under this screen (scan replaced itself).
  const chooseAnother = () => {
    if (router.canGoBack()) router.back();
    else if (personId) router.replace({ pathname: '/family/add/document', params: { personId, name: first } });
  };

  // Member page underneath, their face capture on top; the document step follows.
  const setUpFace = () => {
    if (!personId) return;
    const age = member?.age;
    const photo = memberCaptureMode(member, params.band === '0-4' ? 0 : undefined) === 'photo';
    router.dismissTo({ pathname: '/family/[id]', params: { id: personId } });
    router.push({
      pathname: photo ? '/family/add/photo-capture' : '/family/add/face-capture',
      params: { personId, name: first, ...(age != null ? { age: String(age) } : {}), next: 'document' },
    });
  };

  const action = rejectionAction(result?.reasonCode);
  const rejectedCta: { label: string; icon: LucideIcon; onPress: () => void } =
    action === 'setupFace'
      ? { label: REJECTION_ACTION_LABEL.setupFace, icon: ScanFace, onPress: setUpFace }
      : action === 'retake'
        ? { label: REJECTION_ACTION_LABEL.retake, icon: ScanLine, onPress: rescan }
        : action === 'changeType'
          ? { label: REJECTION_ACTION_LABEL.changeType, icon: FileX, onPress: chooseAnother }
          : // PROFILE_MISMATCH included: member details can't be edited in the app.
            { label: REJECTION_ACTION_LABEL.anotherDocument, icon: FileX, onPress: chooseAnother };

  const failed = status === 'error' || status === 'rejected';
  const steps = stagedSteps(STEP_LABELS, status === 'approved' ? STEP_LABELS.length : stepIndex, failed);
  const progress = Math.min(1, Math.max(0.12, (status === 'approved' ? STEP_LABELS.length : stepIndex + 0.5) / STEP_LABELS.length));
  const backLabel = first ? `Back to ${first}` : 'Back to member';
  const checksFace = docType !== 'birthCertificate';

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <TopBar hideBack title="Add document" />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 26, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'center', paddingTop: 6 }}>
            {failed ? (
              <Medallion icon={status === 'rejected' ? FileX : TriangleAlert} tone={status === 'rejected' ? 'amber' : 'red'} size={76} />
            ) : (
              <FaceRing size={170} photo={false} mode={status === 'approved' ? 'success' : 'scan'} progress={progress} />
            )}
          </View>
          <View accessibilityLiveRegion="polite">
            {status === 'working' && (
              <Heading
                center
                title="Checking"
                accent={first ? `${first}'s ID…` : 'the ID…'}
                sub={checksFace ? 'Matching the document photo to their face.' : 'Reading the document.'}
              />
            )}
            {status === 'approved' && <Heading center title="Document" accent="verified." />}
            {status === 'rejected' && <Heading center title="Not" accent="verified." />}
            {status === 'error' && <Heading center title="Couldn't check" accent="the document." />}
          </View>

          <StepCard steps={steps} />

          {status === 'rejected' ? (
            <Banner tone="error" body={result?.reasonMessage || DEFAULT_REJECTION_MESSAGE} />
          ) : error ? (
            <Banner tone="error" body={error} />
          ) : null}
        </ScrollView>

        {status === 'rejected' ? (
          <Footer>
            <Button label={rejectedCta.label} icon={rejectedCta.icon} onPress={rejectedCta.onPress} />
            <Button label={backLabel} tone="white" icon={UserRound} onPress={memberPage} />
          </Footer>
        ) : status === 'error' ? (
          <Footer>
            {noScan ? (
              <Button label="Scan again" icon={ScanLine} onPress={rescan} />
            ) : retryable ? (
              <Button label="Retry" icon={RotateCcw} onPress={() => void processRef.current?.()} />
            ) : null}
            <Button label={backLabel} tone={noScan || retryable ? 'white' : 'sky'} icon={UserRound} onPress={memberPage} />
          </Footer>
        ) : null}
      </SafeAreaView>
    </View>
  );
}
