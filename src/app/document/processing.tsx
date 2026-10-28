/** @jsxImportSource react */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { documentKeys, refreshAfterVerify, useAddDocument } from '@/features/documents/hooks';
import { isExpired, namesMatch } from '@/features/documents/identityChecks';
import { errorFields, startDocLog } from '@/features/documents/verifyLog';
import { isApproved, verifyDocumentWithUploads, type VerifyUploadStep } from '@/features/documents/verifyWithUploads';
import { DocumentCard, docMeta, ScanHero, StepList, type FlowStepState } from '@/premium/flows/documents';
import { Banner, ConfirmSheet } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Heading, Row, Screen, TopBar, Txt } from '@/premium/ui';
import { clearDocumentImages, saveDocumentImages } from '@/services/documentImageStore';
import { flowGuards } from '@/services/flowGuards';
import { clearScanResult, getScanResult } from '@/services/scanStore';
import { useAppSelector } from '@/store';
import type { DocumentType, IdentityDocument } from '@/types/domain';

type ProcessingStatus = 'adding' | 'uploading' | 'verifying' | 'done' | 'error';

const STEP_LABELS = ['Document scanned', 'Adding to account', 'Uploading photos', 'Verifying document'];
const STEP_DETAILS = [
  'Captured on this device',
  'Saving it to your documents',
  'Sending your scan securely',
  'Checking authenticity & extracting details',
];
const STEP_INDEX: Record<ProcessingStatus, number> = {
  adding: 1,
  uploading: 2,
  verifying: 3,
  done: 4,
  error: -1,
};

const STATUS_LINE: Record<ProcessingStatus, string> = {
  adding: 'Adding document…',
  uploading: 'Uploading photos…',
  verifying: 'Verifying document…',
  done: 'Verified!',
  error: 'Verification failed',
};

/** Rejections shown as a popup: expired (app check), someone else's face
 *  (DOCUMENT_FACE_MISMATCH), name differs (app check, or the server's
 *  PROFILE_MISMATCH, which also covers date of birth). */
type RejectKind = 'expired' | 'face' | 'name' | 'profile';

const REJECT_COPY: Record<RejectKind, { title: string; body: string }> = {
  expired: {
    title: 'This document has expired',
    body: "Expired documents can't be added. Scan one that's still valid.",
  },
  face: {
    title: "This document isn't yours",
    body: "The photo on this document doesn't match your face. You can only add your own documents.",
  },
  name: {
    title: "Name doesn't match",
    body: "The name on this document doesn't match the name on your profile. You can only add your own documents.",
  },
  profile: {
    title: "Details don't match",
    body: "The name or date of birth on this document doesn't match your profile. You can only add your own documents.",
  },
};

/** Readable text for a thrown network/API error (not a verify rejection). */
const errorText = (err: unknown): string => {
  const e = toApiError(err);
  // axios → NETWORK; the presigned PUT uses fetch → "Network request failed".
  if (e.code === 'NETWORK' || /network request failed|failed to fetch/i.test(e.message)) {
    return "Couldn't reach the server. Check your internet connection and tap Retry.";
  }
  return e.message || 'Verification failed';
};

/** Document processing (BACKEND_UPDATE_2026-10 §6.2–6.5):
 *  1. POST /documents (no number — the server reads it from the scan)
 *  2. presigned upload of the captured image(s)
 *  3. verification session with the object keys → /verify (synchronous)
 *  4. approved → verified screen; not the holder's (expired, face, name) →
 *     popup; other rejections → reasonMessage + one action. */
export default function DocumentProcessingScreen() {
  const router = useRouter();
  const { type, label, expiresAt } = useLocalSearchParams<{
    type?: string;
    label?: string;
    expiresAt?: string;
  }>();
  const docType = (type ?? 'passport') as DocumentType;
  const meta = docMeta(docType);
  const docLabel = label?.trim() || meta.label;
  const docExpiresAt = expiresAt?.trim() || null;
  const [status, setStatus] = useState<ProcessingStatus>('adding');
  const [error, setError] = useState<string | null>(null);
  const hasStarted = useRef(false);
  const processRef = useRef<(() => Promise<void>) | null>(null);
  // Document created by the current attempt — reused on Retry so a failed
  // upload/API error doesn't pile up duplicate documents.
  const createdDocRef = useRef<IdentityDocument | null>(null);
  // Retries of this screen, for the attempt log.
  const attemptRef = useRef(0);
  // False once the user has left (back / swipe while the request runs). The
  // request still finishes, but must not touch this screen or navigate —
  // router.replace would swap out whichever screen they went back to.
  const activeRef = useRef(true);
  const addDocument = useAddDocument();
  const queryClient = useQueryClient();
  const profileName = useAppSelector((state) => state.auth.user?.fullName ?? '');
  // Set when the document isn't the holder's — shows the popup.
  const [rejected, setRejected] = useState<RejectKind | null>(null);
  // Hero: the photo the user just captured (read once — the store is cleared
  // on completion). Display only; the upload reads the store in process().
  const [heroUri] = useState(() => {
    const s = getScanResult();
    const b64 = s?.documentPreviewBase64 ?? s?.documentImageBase64;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  });

  // Staged flow — index tracks the real API step; on error it stays at the
  // last active step so that step renders as the failed one.
  const [stepIndex, setStepIndex] = useState(STEP_INDEX.adding);
  const goStep = (s: ProcessingStatus) => {
    setStatus(s);
    setStepIndex(STEP_INDEX[s]);
  };
  const onUploadStep = (s: VerifyUploadStep) => {
    if (activeRef.current) goStep(s === 'uploading' ? 'uploading' : 'verifying');
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const process = async () => {
      const scanResult = getScanResult();
      const frontImage = scanResult?.documentImageBase64 ?? '';
      const log = startDocLog({ flow: 'self', type: docType, retry: attemptRef.current++ || undefined });
      // Left mid-request: the outcome and its cleanup stand (the wallet
      // refreshes), but there is no screen left to update or navigate from.
      const stillHere = () => {
        if (activeRef.current) return true;
        log.info('screen closed, not navigating');
        return false;
      };

      if (!frontImage) {
        log.end('error', { error: 'no scan in the store' });
        setError('No document image captured. Please scan again.');
        setStatus('error');
        clearScanResult();
        return;
      }

      try {
        // Step 1: add the document — metadata only, no number (§6.2).
        // On Retry, reuse the document created by the previous attempt.
        let doc = createdDocRef.current;
        if (!doc) {
          goStep('adding');
          doc = await log.step(
            'create document',
            () => addDocument.mutateAsync({ type: docType, label: docLabel, expiresAt: docExpiresAt }),
            (d) => ({ document: d.id }),
          );
          createdDocRef.current = doc;

          // Keep a local copy of the (cropped) capture — the document page
          // shows it before the server's full camera frame. Removed with the
          // document (useRemoveDocument).
          try {
            await saveDocumentImages(doc.id, {
              front: scanResult?.documentPreviewBase64 ?? frontImage,
              back: scanResult?.backImageBase64,
            });
          } catch (e) {
            log.warn('local copy not saved', errorFields(e));
          }
        } else {
          log.info('reusing document', { document: doc.id });
        }

        // Same-type documents before verifying: an approval makes the server
        // delete the older verified one, whose scan is still on this phone.
        const sameTypeBefore = (queryClient.getQueryData<IdentityDocument[]>(documentKeys.all) ?? [])
          .filter((d) => d.type === docType && d.id !== doc.id)
          .map((d) => d.id);

        // Steps 2–3: presigned upload → session → verify (no base64).
        const result = await verifyDocumentWithUploads({
          documentId: doc.id,
          frontBase64: frontImage,
          backBase64: scanResult?.backImageBase64,
          onStep: onUploadStep,
          log,
        });

        clearScanResult();

        // The server doesn't check expiry, and its name check can pass a
        // document that clearly isn't the holder's — an approval failing
        // either is discarded like a rejection.
        const appCheck: Exclude<RejectKind, 'face'> | null = !isApproved(result)
          ? null
          : isExpired(result.dateOfExpiry)
            ? 'expired'
            : !namesMatch(profileName, result.extractedName)
              ? 'name'
              : null;

        if (isApproved(result) && !appCheck) {
          // One per type (§6.5): the server removed older VERIFIED documents of
          // this type. Unverified leftovers of the same type (earlier failed or
          // pending attempts) are now noise — remove them too (best effort).
          try {
            const existing = await api.getDocuments();
            const leftovers = (existing ?? []).filter(
              (d) => d.type === docType && d.id !== doc.id && d.status !== 'verified',
            );
            for (const old of leftovers) {
              try {
                await api.removeDocument(old.id);
                await clearDocumentImages(old.id);
                log.info('removed leftover', { document: old.id, status: old.status });
              } catch (e) {
                log.warn('leftover not removed', { document: old.id, ...errorFields(e) });
              }
            }
            // Gone from the server (the replaced verified copy): drop its scan here too.
            for (const id of sameTypeBefore) {
              if ((existing ?? []).some((d) => d.id === id)) continue;
              clearDocumentImages(id).catch(() => {});
              log.info('cleared replaced copy', { document: id });
            }
          } catch (e) {
            log.warn('leftover lookup failed', errorFields(e));
          }

          log.end('approved', { document: doc.id });
          refreshAfterVerify(queryClient, doc.id);
          if (!stillHere()) return;
          goStep('done');
          flowGuards.grant('document:verified');
          router.replace({
            pathname: '/document/verified',
            params: {
              docId: doc.id,
              docLabel,
              docType,
              // The POST-VERIFY number (masked, read from the document).
              docNumber: result.document?.number ?? '',
              extractedName: result.extractedName ?? '',
              extractedDob: result.extractedDob ?? '',
              matchScore: result.matchScore != null ? String(result.matchScore) : '',
              issuingState: result.issuingState ?? '',
              nationality: result.nationality ?? '',
              dateOfExpiry: result.dateOfExpiry ?? '',
              portraitImageUrl: result.portraitImageUrl ?? '',
            },
          });
          return;
        }

        // Rejected: nothing of this attempt stays in the wallet — a "Failed"
        // card there reads as "it was added" (e.g. someone else's document).
        // The reason is shown next (popup or screen). Older unverified ones of
        // the type (earlier failures, the old "PENDING" placeholders) go too;
        // a VERIFIED one stays.
        const attempt = doc;
        const discard = async (old: IdentityDocument, what: string) => {
          try {
            await api.removeDocument(old.id);
            await clearDocumentImages(old.id);
            if (old.id === attempt.id) createdDocRef.current = null;
            log.info(what, { document: old.id, status: old.status });
          } catch (e) {
            log.warn('document not removed', { document: old.id, ...errorFields(e) });
          }
        };
        await discard(attempt, 'discarded this attempt');
        try {
          const stale = (await api.getDocuments() ?? []).filter(
            (d) => d.type === docType && d.id !== attempt.id && d.status !== 'verified',
          );
          for (const old of stale) await discard(old, 'removed older unverified');
        } catch (e) {
          log.warn('cleanup lookup failed', errorFields(e));
        }
        refreshAfterVerify(queryClient, doc.id);

        // Not the holder's document (expired, someone else's face or name):
        // a popup here. Other rejections keep their own screen and action.
        const kind: RejectKind | null =
          appCheck ??
          (result.reasonCode === 'DOCUMENT_FACE_MISMATCH'
            ? 'face'
            : result.reasonCode === 'PROFILE_MISMATCH'
              ? 'profile'
              : null);

        log.end('rejected', {
          reason: appCheck ? `app:${appCheck}` : result.reasonCode,
          match: result.matchScore,
          next: kind ? 'popup' : 'rejected',
        });
        if (!stillHere()) return;
        if (kind) {
          setRejected(kind);
          return;
        }

        flowGuards.grant('document:rejected');
        router.replace({
          pathname: '/document/rejected',
          params: {
            docType,
            docLabel,
            reasonCode: result.reasonCode ?? '',
            reasonMessage: result.reasonMessage ?? '',
          },
        } as never);
      } catch (err) {
        // Network/API failure (not a rejection): stay here with Retry. Keep
        // the scan — Retry re-uploads the same capture.
        // Logged as a warning (Retry is on screen), so it doesn't open the
        // dev error overlay.
        const msg = errorText(err);
        log.end('error', { ...errorFields(err), shown: msg });
        if (!stillHere()) return;
        setError(msg);
        setStatus('error');
      }
    };

    processRef.current = process;
    process();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType]);

  const retry = () => {
    setError(null);
    goStep('adding');
    processRef.current?.();
  };

  const backToDocuments = () => {
    // Discard the unverified document created by this attempt so no pending
    // duplicate is left in the wallet.
    const doc = createdDocRef.current;
    if (doc) {
      api.removeDocument(doc.id).catch(() => {});
      clearDocumentImages(doc.id).catch(() => {});
      createdDocRef.current = null;
    }
    // The scan replaced itself with this screen, so back is whatever opened
    // it (type picker, or the document page for a rescan) — not the old capture.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/documents' as never);
  };

  // Popup actions — the attempt is already discarded. The scan replaced
  // itself with this screen, so a fresh one replaces this one.
  const scanAgain = () =>
    router.replace({ pathname: '/document/scan', params: { type: docType, label: docLabel, retake: String(Date.now()) } } as never);
  const toWallet = () => router.dismissTo('/(tabs)/documents' as never);

  const failed = status === 'error';
  // Index-driven steps: before index → done, at index → active (failed on
  // error), after → pending.
  const steps = STEP_LABELS.map((l, i) => {
    const state: FlowStepState = i < stepIndex ? 'done' : i === stepIndex ? (failed ? 'failed' : 'active') : 'todo';
    return { label: l, detail: STEP_DETAILS[i], state };
  });

  return (
    <Screen
      header={<TopBar title="Verifying" hideBack={!failed} onBack={backToDocuments} />}
      contentStyle={{ paddingTop: 8 }}
      footer={
        failed ? (
          <>
            <Button label="Retry verification" icon={RotateCcw} onPress={retry} />
            <Button label="Back to documents" tone="white" onPress={backToDocuments} />
          </>
        ) : undefined
      }>
      <View style={{ alignItems: 'center', paddingTop: 6 }}>
        {heroUri ? (
          <ScanHero uri={heroUri} scanning={!failed && !rejected && status !== 'done'} />
        ) : (
          <DocumentCard
            type={docType}
            label={docLabel}
            height={180}
            badge={failed ? { label: 'Failed', tone: 'red', dot: true } : { label: 'Checking', tone: 'amber', dot: true }}
            style={{ width: 300, transform: [{ rotate: '-4deg' }] }}
          />
        )}
      </View>

      <View style={{ gap: 12, alignItems: 'center' }}>
        <View accessibilityLiveRegion="polite">
          <Txt v="micro" color={failed ? C.redInk : C.sky} center>
            {STATUS_LINE[status]}
          </Txt>
        </View>
        {failed ? (
          <Heading title="Verification" accent="failed." sub="Retry with the same scan, or go back to your documents." center />
        ) : (
          <Heading
            title="Checking your"
            accent={`${meta.noun}.`}
            sub={status === 'verifying' ? 'Reading your document — this may take a moment.' : 'Extracting details & matching your face.'}
            center
          />
        )}
      </View>

      <StepList steps={steps} />

      {error ? <Banner tone="error" title="Something went wrong" body={error} /> : null}

      <Row gap={8} style={{ justifyContent: 'center' }}>
        <ShieldCheck size={15} color={C.ink3} />
        <Txt v="small">Sent over an encrypted connection</Txt>
      </Row>

      <ConfirmSheet
        visible={rejected != null}
        danger
        icon={TriangleAlert}
        title={rejected ? REJECT_COPY[rejected].title : ''}
        body={rejected ? REJECT_COPY[rejected].body : undefined}
        confirmLabel="Scan again"
        cancelLabel="Back to documents"
        onConfirm={scanAgain}
        onCancel={toWallet}
      />
    </Screen>
  );
}
