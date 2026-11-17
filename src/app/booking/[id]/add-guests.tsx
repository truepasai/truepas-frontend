/** @jsxImportSource react */
/**
 * Add family members — PATCH /cb/bookings/{id} with memberIds (everyone
 * already on it, plus the people picked) and a guest count that never goes
 * down. Open on the customer's own reservation until its dates pass, also
 * after someone on it checked in: a second reservation for the same venue
 * and day is refused, so this is where the family goes. Until you (the
 * account holder) have checked in on it, a family member already on it can
 * also be taken off here (Remove, confirmed: PATCH memberIds without them),
 * even after one of them checked in, whose check-in stays. Once you have,
 * nobody can be taken off (GUEST_REMOVAL_LOCKED). Each person checks in for
 * themselves at the venue kiosk; adding someone checks nobody in.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, CalendarX, Check, Lock, UserMinus, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { useMe } from '@/features/account/hooks';
import { useFamily } from '@/features/family/hooks';
import { historyKeys, useBooking, useBookings, useUpdateReservation } from '@/features/history/hooks';
import { checkInLabel, checkInsOn, personCheckIn } from '@/features/history/reservationConsent';
import {
  MEMBER_DOCUMENT_NOT_VERIFIED,
  choosable,
  knownMemberIds,
  reservationPeople,
  type ReservationSelf,
} from '@/features/history/reservationDraft';
import { useIdentitySummary } from '@/features/identity/hooks';
import {
  GUEST_REMOVAL_LOCKED,
  REMOVAL_LOCKED_MESSAGE,
  addGuestsPatch,
  addablePeople,
  canAddGuests,
  holderCheckedIn,
  removeGuestPatch,
} from '@/features/history/reservationGuests';
import { fmtDay, isoDay } from '@/premium/flows/home';
import { Async, Banner, ConfirmSheet, EmptyView, LoadingView } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Avatar, Badge, Button, Group, Row, Screen, SectionHead, TopBar, Txt } from '@/premium/ui';
import type { Booking, FamilyMember } from '@/types/domain';

const CHECK_IN_TONE = { checked_in: 'green', not_yet: 'neutral', missed: 'amber' } as const;

export default function AddGuestsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const booking = useBooking(id);
  const family = useFamily();
  const me = useMe();
  // Your own ID's verification (unknown until it loads: the server decides then).
  const identity = useIdentitySummary();

  const b = booking.data;
  if (b == null || (me.isPending && me.data == null) || (family.data == null && !family.isError)) {
    const gone = !id || (booking.isError && toApiError(booking.error).status === 404);
    const notFound = <EmptyView icon={CalendarDays} title="Booking not found" body="This booking is no longer available." />;
    return (
      <Screen header={<TopBar title="Add family members" />}>
        {gone ? notFound : (
          <Async q={booking} emptyView={notFound}>
            {() => <LoadingView />}
          </Async>
        )}
      </Screen>
    );
  }

  if (!canAddGuests(b)) {
    return (
      <Screen header={<TopBar title="Add family members" />}>
        <EmptyView
          icon={CalendarX}
          title="Nobody can be added"
          body="Family members can be added to your own reservation until its dates have passed."
          action={<Button label="Back to booking" tone="white" size="sm" full={false} onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const self = me.data?.personId
    ? { personId: me.data.personId, name: me.data.fullName, documentVerified: identity.data ? identity.data.status === 'verified' : null }
    : null;
  return <AddGuests b={b} family={family.data ?? []} familyFailed={family.isError} retryFamily={() => void family.refetch()} self={self} />;
}

function AddGuests({
  b,
  family,
  familyFailed,
  retryFamily,
  self,
}: {
  b: Booking;
  family: FamilyMember[];
  familyFailed: boolean;
  retryFamily: () => void;
  self: ReservationSelf | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const bookings = useBookings();
  const linked = useBooking(b.linkedBookingId);
  const update = useUpdateReservation();
  const [picked, setPicked] = useState<string[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  // The family member being taken off (confirm sheet open), and why it failed.
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const people = reservationPeople(self, family);
  const onIt = knownMemberIds(b, family, self?.personId);
  const addable = addablePeople(onIt, people);
  const rows = [...(bookings.data ?? []), linked.data];
  // You checked in on it: nobody can be taken off any more.
  const locked = holderCheckedIn(b, rows, self?.personId);
  const checkIns = checkInsOn(b, rows);
  const today = isoDay();
  const nameOf = (personId: string) => people.find((p) => p.personId === personId)?.name ?? 'Family member';

  const close = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/booking/[id]', params: { id: b.id } } as never));
  const toggle = (personId: string) =>
    setPicked((prev) => (prev.includes(personId) ? prev.filter((x) => x !== personId) : [...prev, personId]));

  const save = async () => {
    setBanner(null);
    try {
      await update.mutateAsync({ id: b.id, patch: addGuestsPatch(b, onIt, picked) });
      toast({ variant: 'success', title: picked.length === 1 ? 'Added to your reservation' : `${picked.length} people added` });
      close();
    } catch (error) {
      const err = toApiError(error);
      if (err.serverCode === 'BOOKING_NOT_EDITABLE' || err.serverCode === GUEST_REMOVAL_LOCKED) {
        // Its dates passed, or it changed underneath this screen.
        toast({ variant: 'error', title: err.message });
        void qc.invalidateQueries({ queryKey: historyKeys.all });
        close();
        return;
      }
      // Someone gone from the family, or whose ID isn't verified after all.
      if (err.status === 404 || err.serverCode === MEMBER_DOCUMENT_NOT_VERIFIED) retryFamily();
      setBanner(err.message);
    }
  };

  // Takes one family member off; everyone else, the guest count and any
  // check-in already made stay. The server refuses once you've checked in.
  const remove = async () => {
    const personId = removing;
    if (!personId) return;
    setRemoveError(null);
    try {
      await update.mutateAsync({ id: b.id, patch: removeGuestPatch(onIt, personId) });
      setRemoving(null);
      toast({ variant: 'success', title: `${nameOf(personId)} was taken off the reservation` });
    } catch (error) {
      setRemoving(null);
      const err = toApiError(error);
      if (err.serverCode === 'BOOKING_NOT_EDITABLE' || err.serverCode === GUEST_REMOVAL_LOCKED) {
        // You checked in meanwhile, or its dates passed: show it as it is now.
        void qc.invalidateQueries({ queryKey: historyKeys.all });
      }
      setRemoveError(err.message);
    }
  };

  return (
    <Screen
      header={<TopBar title="Add family members" />}
      contentStyle={{ paddingTop: 8, gap: 24 }}
      footer={
        <Button
          label={picked.length > 1 ? `Add ${picked.length} people` : 'Add to reservation'}
          icon={UserPlus}
          loading={update.isPending}
          disabled={picked.length === 0 || update.isPending}
          onPress={() => void save()}
        />
      }
    >
      <Txt v="small">
        {`${b.venue}, ${fmtDay(b.checkIn)}${b.checkOut ? ` – ${fmtDay(b.checkOut)}` : ''}. Each person checks in with their own face at the venue kiosk; adding someone doesn't check them in, and someone else's check-in never counts for them.`}
      </Txt>

      {banner != null && <Banner tone="error" title="Couldn't add to the reservation" body={banner} />}
      {removeError != null && <Banner tone="error" title="Couldn't take them off the reservation" body={removeError} />}
      {locked && <Banner tone="info" title="Nobody can be removed" body={REMOVAL_LOCKED_MESSAGE} />}

      <View style={{ gap: 14 }}>
        <SectionHead title="On this reservation" />
        <Group>
          {onIt.map((personId) => {
            const checkIn = personCheckIn(personId, b, checkIns, today);
            return (
              <Row key={personId} gap={12} style={{ paddingVertical: 12 }}>
                <Avatar name={nameOf(personId)} size={36} status={checkIn.state === 'checked_in' ? 'verified' : undefined} />
                <Txt v="bodyStrong" lines={1} style={{ flex: 1 }}>
                  {nameOf(personId)}
                </Txt>
                <Badge small label={checkInLabel(checkIn)} tone={CHECK_IN_TONE[checkIn.state]} />
                {locked && <Lock size={16} color={C.ink4} accessibilityLabel="Can't be removed" />}
                {!locked && personId !== self?.personId && (
                  <Button
                    label="Remove"
                    tone="ghost"
                    size="sm"
                    full={false}
                    disabled={update.isPending}
                    onPress={() => setRemoving(personId)}
                  />
                )}
              </Row>
            );
          })}
        </Group>
      </View>

      <View style={{ gap: 14 }}>
        <SectionHead title="Add" />
        {familyFailed && family.length === 0 ? (
          <Banner tone="warning" title="Couldn't load your family" body="Try again to see who you can add." action={<Button label="Retry" tone="white" size="sm" full={false} onPress={retryFamily} />} />
        ) : addable.length === 0 ? (
          <EmptyView
            compact
            icon={UserPlus}
            title="Everyone is on it"
            body="Everyone in your family is already on this reservation. Add a family member to your account first."
            action={<Button label="Add a family member" tone="white" size="sm" full={false} onPress={() => router.push('/family/add' as never)} />}
          />
        ) : (
          <Group>
            {addable.map((p) => {
              const on = picked.includes(p.personId);
              // Nobody on it yet, so only a verified ID of their own qualifies.
              const blocked = !on && !choosable(p, []);
              const detail = blocked ? p.notVerified : p.detail;
              return (
                <Pressable
                  key={p.personId}
                  onPress={() => toggle(p.personId)}
                  disabled={blocked}
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  aria-disabled={blocked}
                  accessibilityLabel={detail ? `${p.name}, ${detail}` : p.name}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, opacity: blocked ? 0.55 : 1 }}>
                    <View
                      style={{
                        width: 24, height: 24, borderRadius: 7, borderWidth: 2,
                        borderColor: on ? C.sky : C.line, backgroundColor: on ? C.sky : blocked ? C.sunken : C.surface,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {on && <Check size={15} color={C.white} strokeWidth={3} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt v="bodyStrong" color={on ? C.ink : C.ink2}>
                        {p.name}
                      </Txt>
                      {!!detail && <Txt v="small">{detail}</Txt>}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </Group>
        )}
      </View>

      <ConfirmSheet
        visible={removing != null}
        danger
        icon={UserMinus}
        title={removing ? `Take ${nameOf(removing)} off this reservation?` : ''}
        body="They won't check in on it. Anything already done stays: a check-in they made here, and anything already shared with the venue."
        confirmLabel="Remove"
        loading={update.isPending}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}
