/** @jsxImportSource react */
/**
 * An adult family member's own document-sharing decision for one reservation
 * — POST /cb/bookings/{id}/document-consents/{personId}. On the holder's
 * phone, the person themselves:
 *  1. verifies their face — a liveness capture (LivenessCamera "verify"),
 *  2. reviews what would be shared, with whom and when,
 *  3. accepts or declines (or withdraws an earlier acceptance).
 * The BFF matches the capture 1:1 against the person's own enrolled face
 * before anything is recorded (403 FACE_NOT_VERIFIED otherwise); a capture is
 * single use, so every attempt verifies again. The holder can't decide for
 * them: the holder's own consent is the reservation's switch. Children can't
 * be asked, and neither can twins (a face check can't tell twins apart, so
 * customer-account-service refuses it: TWIN_FACE_CONSENT_UNAVAILABLE). Only
 * adults selected on an upcoming reservation at a venue that releases
 * everyone's documents can accept; withdrawing is always possible.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScanFace, ShieldCheck, ShieldOff, UserX } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { useMe } from '@/features/account/hooks';
import { useFamily } from '@/features/family/hooks';
import {
  isEditableReservation,
  useBooking,
  useDecideReservationConsent,
  useMerchant,
  useReservationConsents,
} from '@/features/history/hooks';
import {
  RESERVATION_DOCUMENT_TERMS,
  TWIN_CONSENT_MESSAGE,
  TWIN_CONSENT_UNAVAILABLE,
  consentTerms,
  memberSharing,
  releasesEveryone,
} from '@/features/history/reservationConsent';
import { loadLivenessCamera } from '@/features/liveness/cameraModule';
import type { LivenessCapture } from '@/features/liveness/LivenessCamera';
import { CameraUnavailableView } from '@/premium/flows/face';
import { CameraPermissionGate } from '@/premium/flows/faceCamera';
import { fmtDay } from '@/premium/flows/home';
import { Async, Banner, EmptyView, LoadingView } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Card, Heading, Row, Screen, TopBar, Txt } from '@/premium/ui';
import type { Booking, FamilyMember, ReservationConsentDecision } from '@/types/domain';

const LivenessCamera = loadLivenessCamera();

const TITLE = 'Document sharing';

export default function ReservationConsentScreen() {
  const { id, personId } = useLocalSearchParams<{ id?: string; personId?: string }>();
  const router = useRouter();
  const booking = useBooking(id);
  const family = useFamily();
  const me = useMe();
  const b = booking.data;

  if (b == null || family.data == null || (me.isPending && me.data == null)) {
    const gone = !id || (booking.isError && toApiError(booking.error).status === 404);
    const notFound = <EmptyView title="Reservation not found" body="This reservation is no longer available." />;
    return (
      <Screen header={<TopBar title={TITLE} />}>
        {gone ? (
          notFound
        ) : booking.data == null ? (
          <Async q={booking} emptyView={notFound}>
            {() => <LoadingView />}
          </Async>
        ) : (
          <Async q={family}>{() => <LoadingView />}</Async>
        )}
      </Screen>
    );
  }

  const member = family.data.find((f) => f.id === personId);
  const refusal = !member
    ? 'This person is not in your family.'
    : personId === me.data?.personId
      ? 'You decide about your own documents on the reservation itself.'
      : !(b.checkedInMembers ?? []).includes(member.id)
        ? `Select ${member.name} on the reservation first.`
        : !(member.age >= 18)
          ? "Children's documents are never shared, and nobody can consent for them."
          : !isEditableReservation(b)
            ? 'Only upcoming reservations can be changed.'
            : null;
  if (refusal || !member) {
    return (
      <Screen header={<TopBar title={TITLE} />}>
        <EmptyView
          icon={UserX}
          title="Not available"
          body={refusal ?? undefined}
          action={<Button label="Back" tone="white" size="sm" full={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }
  return <MemberConsent b={b} member={member} />;
}

type Stage = 'intro' | 'camera' | 'review';

function MemberConsent({ b, member }: { b: Booking; member: FamilyMember }) {
  const router = useRouter();
  const { toast } = useToast();
  const consents = useReservationConsents(b.id);
  const merchant = useMerchant(b.merchantId);
  const decide = useDecideReservationConsent();
  const [stage, setStage] = useState<Stage>('intro');
  const [capture, setCapture] = useState<LivenessCapture | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The server identified them as a twin (the family list here may be older).
  const [twinRefused, setTwinRefused] = useState(false);

  const first = member.name.split(' ')[0] || member.name;
  const sharing = memberSharing(member, consents.data ?? []);
  const canAccept = releasesEveryone(merchant.data?.documentAccess) && member.isTwin !== true && !twinRefused;
  const dates = b.checkOut && b.checkOut.slice(0, 10) !== b.checkIn.slice(0, 10) ? `${fmtDay(b.checkIn)} – ${fmtDay(b.checkOut)}` : fmtDay(b.checkIn);

  const verifyAgain = (message: string | null) => {
    // A capture is single use: every new attempt verifies again.
    setCapture(null);
    setProblem(message);
    setStage('intro');
  };

  const submit = async (decision: ReservationConsentDecision['decision']) => {
    if (!capture) return verifyAgain(null);
    setProblem(null);
    try {
      await decide.mutateAsync({
        bookingId: b.id,
        personId: member.id,
        payload: { decision, termsVersion: RESERVATION_DOCUMENT_TERMS, ...capture },
      });
      toast({
        variant: 'success',
        title: decision === 'granted' ? `${first} shares their documents` : decision === 'declined' ? `${first} declined` : `${first} withdrew consent`,
        description: 'Their decision is saved for this reservation.',
      });
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/booking/[id]', params: { id: b.id } } as never);
    } catch (e) {
      const err = toApiError(e);
      if (err.serverCode === TWIN_CONSENT_UNAVAILABLE) {
        setCapture(null);
        setTwinRefused(true);
        setStage('intro');
      } else if (err.serverCode === 'FACE_NOT_VERIFIED') verifyAgain(`This face didn't match ${member.name}'s. Nothing was saved. ${first} needs to verify their own face.`);
      else if (err.serverCode === 'FACE_NOT_ENROLLED') verifyAgain(`${member.name} needs a face set up first. Nothing was saved.`);
      else if (err.serverCode === 'CONSENT_TERMS_CHANGED') verifyAgain('The consent text changed. Update the app, then try again. Nothing was saved.');
      else verifyAgain(`${err.message} Nothing was saved.`);
    }
  };

  // A twin can't consent with a face check; an earlier consent stays withdrawable.
  if ((sharing.state === 'twin' || twinRefused) && sharing.state !== 'granted') {
    return (
      <Screen header={<TopBar title={TITLE} />}>
        <EmptyView
          icon={UserX}
          title="Not available for twins"
          body={TWIN_CONSENT_MESSAGE}
          action={<Button label="Back" tone="white" size="sm" full={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  if (stage === 'camera') {
    if (!LivenessCamera) return <CameraUnavailableView />;
    return (
      <CameraPermissionGate topTitle={`Verify ${first}`}>
        <LivenessCamera
          mode="verify"
          personId={member.id}
          onSuccess={() => {}}
          onVerified={(c: LivenessCapture) => {
            setCapture(c);
            setStage('review');
          }}
        />
      </CameraPermissionGate>
    );
  }

  if (stage === 'review' && capture) {
    const granted = sharing.state === 'granted';
    return (
      <Screen
        header={<TopBar title={TITLE} />}
        contentStyle={{ paddingTop: 8, gap: 22 }}
        footer={
          granted ? (
            <Row gap={10}>
              <Button label="Keep sharing" tone="white" full={false} disabled={decide.isPending} onPress={() => router.back()} />
              <Button
                label="Withdraw consent"
                tone="danger"
                icon={ShieldOff}
                loading={decide.isPending}
                disabled={decide.isPending}
                style={{ flex: 1 }}
                onPress={() => void submit('withdrawn')}
              />
            </Row>
          ) : (
            <Row gap={10}>
              <Button
                label="Decline"
                tone="white"
                full={!canAccept}
                disabled={decide.isPending}
                style={canAccept ? undefined : { flex: 1 }}
                onPress={() => void submit('declined')}
              />
              {canAccept && (
                <Button
                  label="Accept"
                  icon={ShieldCheck}
                  loading={decide.isPending}
                  disabled={decide.isPending}
                  style={{ flex: 1 }}
                  onPress={() => void submit('granted')}
                />
              )}
            </Row>
          )
        }
      >
        <Heading
          over={`${member.name}, this is your decision`}
          title={granted ? 'Stop sharing your' : 'Share your'}
          accent="documents?"
          sub={`With the check-ins of the others going to ${b.venue}. Nobody else can decide this for you.`}
        />
        <Card pad={16}>
          <View style={{ gap: 10 }}>
            {consentTerms({ venue: b.venue, dates, name: first }).map((line) => (
              <Txt key={line} v="small" color={C.ink2}>
                {`• ${line}`}
              </Txt>
            ))}
          </View>
        </Card>
        <Txt v="small">{`Currently: ${sharing.label}.`}</Txt>
        {!granted && !canAccept && (
          <Banner tone="info" body={`${b.venue} doesn't share documents between guests' check-ins right now, so there is nothing to accept.`} />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      header={<TopBar title={TITLE} />}
      contentStyle={{ paddingTop: 8, gap: 22 }}
      footer={
        member.faceEnrolled ? (
          <Button label={`Verify ${first}'s face`} icon={ScanFace} onPress={() => { setProblem(null); setStage('camera'); }} />
        ) : (
          <Button label={`Set up ${first}'s face`} tone="white" onPress={() => router.push(`/family/${member.id}` as never)} />
        )
      }
    >
      <Heading
        title={`${first} decides`}
        accent="for themselves"
        sub={`Hand your phone to ${member.name}. They verify their face, review what would be shared, and accept or decline. You can't decide for them.`}
      />
      {problem != null && <Banner tone="error" title="Not saved" body={problem} />}
      <Card pad={16}>
        <View style={{ gap: 6 }}>
          <Txt v="smallStrong" color={C.ink2}>
            {`${b.venue} · ${dates}`}
          </Txt>
          <Txt v="small">{consents.isPending ? 'Loading their current decision…' : consents.isError ? "Couldn't load their current decision." : `Currently: ${sharing.label}.`}</Txt>
        </View>
      </Card>
      {!member.faceEnrolled && (
        <Banner tone="warning" title={`${first} needs a face first`} body="Their own enrolled face is how they prove the decision is theirs." />
      )}
    </Screen>
  );
}
