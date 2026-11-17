/** @jsxImportSource react */
/**
 * Add reservation — POST /cb/bookings (BACKEND_UPDATE_2026-10 §8.3). The
 * customer records an upcoming booking made elsewhere; on success the new
 * booking's detail replaces this screen. Check-in still happens only at the
 * venue kiosk. One reservation per venue and day: when the customer already
 * has one there (or the server refuses with RESERVATION_ALREADY_EXISTS), the
 * form sends them to it to add family members instead.
 */
import { useRouter } from 'expo-router';

import { useMe } from '@/features/account/hooks';
import { useFamily } from '@/features/family/hooks';
import { useBookings, useCreateReservation } from '@/features/history/hooks';
import { EMPTY_DRAFT, ReservationForm, familyStateOf } from '@/features/history/ReservationForm';
import { useIdentitySummary } from '@/features/identity/hooks';
import type { CreateReservationRequest } from '@/types/domain';

export default function NewReservationScreen() {
  const router = useRouter();
  const family = useFamily();
  const me = useMe();
  const create = useCreateReservation();
  const bookings = useBookings();
  // Your own ID's verification (unknown until it loads: the server decides then).
  const identity = useIdentitySummary();
  const self = me.data?.personId
    ? { personId: me.data.personId, name: me.data.fullName, documentVerified: identity.data ? identity.data.status === 'verified' : null }
    : null;

  const onCreate = async (payload: CreateReservationRequest) => {
    try {
      const created = await create.mutateAsync(payload);
      router.replace({ pathname: '/booking/[id]', params: { id: created.id } } as never);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error };
    }
  };

  return (
    <ReservationForm
      mode="create"
      initial={EMPTY_DRAFT}
      family={family.data ?? []}
      familyState={familyStateOf(family)}
      self={self}
      saving={create.isPending}
      onCreate={onCreate}
      bookings={bookings.data ?? []}
      onOpenReservation={(id) => router.replace({ pathname: '/booking/[id]', params: { id } } as never)}
    />
  );
}
