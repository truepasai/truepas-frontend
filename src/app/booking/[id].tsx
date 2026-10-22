/** @jsxImportSource react */
/**
 * Booking detail — GET /cb/bookings/{bookingId}. Two shapes
 * (BACKEND_UPDATE_2026-10 §8.1):
 *  - kiosk check-in (source 'checkin'): exact check-in time in local time,
 *    kiosk timing ("Checked in in 0.8 s"), who checked in, and the
 *    reservation it completed (linkedBookingId → GET /bookings/{id}).
 *  - the customer's own reservation (source 'customer'): kind, dates,
 *    guests, notes and status; upcoming ones can be edited or deleted.
 * Photo header with venue + location, then the real facts. The Face
 * check-in card is information only: check-in happens at the venue kiosk.
 * "Before you go" keeps real readiness rows plus directions and sharing.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CalendarDays,
  CalendarX,
  FileCheck,
  Link2,
  MapPin,
  Navigation,
  Pencil,
  ScanFace,
  Share2,
  Timer,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { useDocuments } from '@/features/documents/hooks';
import { useFamily } from '@/features/family/hooks';
import { isEditableReservation, useBooking, useBookings, useDeleteReservation } from '@/features/history/hooks';
import { useProfilePicture } from '@/features/profile/hooks';
import { Guilloche } from '@/premium/blocks';
import {
  BookingBackdrop,
  BookingKindIcon,
  bookingKindLabel,
  bookingPlace,
  BookingStatusBadge,
  Fact,
  fmtDay,
  fmtSeconds,
  fmtTime,
  money,
  statusLabel,
  TravellerStack,
  whenLabel,
  yearOf,
} from '@/premium/flows/home';
import { Async, Banner, ConfirmSheet, EmptyView } from '@/premium/kit';
import { useHeroStatusBar } from '@/premium/statusBar';
import { C, F, G, R, SH } from '@/premium/theme';
import { Avatar, Badge, Card, Divider, Group, IconCircle, ListRow, Row, Screen, SectionHead, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { Booking, FamilyMember } from '@/types/domain';

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const booking = useBooking(id);

  if (booking.data == null) {
    const notFound = <EmptyView icon={CalendarDays} title="Booking not found" body="This booking is no longer available." />;
    // 404 = deleted (e.g. opened from a notification after the reservation
    // was removed): not found, not "Couldn't load". useBooking doesn't retry it.
    const gone = !id || (booking.isError && toApiError(booking.error).status === 404);
    return (
      <Screen header={<TopBar title="Booking" />}>
        {gone ? (
          notFound
        ) : (
          <Async q={booking} emptyView={notFound}>
            {() => null}
          </Async>
        )}
      </Screen>
    );
  }

  return <BookingDetail b={booking.data} refetch={() => void booking.refetch()} />;
}

/** checkedInMembers carries person ids on Oct 2026 payloads (names on older
 *  ones): resolve to you / a family member; never print a raw id. */
function memberName(x: string, me: { id?: string; fullName?: string } | null | undefined, family: FamilyMember[]): string {
  if (me?.id && x === me.id) return me.fullName || 'You';
  const m = family.find((f) => f.id === x);
  if (m) return m.name;
  return /^[\w-]{16,}$/.test(x) && /\d/.test(x) ? 'Family member' : x;
}

function BookingDetail({ b, refetch }: { b: Booking; refetch: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const user = useAppSelector((state) => state.auth.user);
  const { url: avatarUri } = useProfilePicture();
  const family = useFamily().data ?? [];
  const docs = useDocuments().data ?? [];
  const bookingsList = useBookings();
  const remove = useDeleteReservation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Dark photo header (340, the card overlaps it by 28): light status bar
  // until the canvas scrolls under it.
  const heroStatusBar = useHeroStatusBar(312);

  const upcoming = b.status === 'upcoming';
  const editable = isEditableReservation(b);
  const isKioskCheckIn = b.source === 'checkin' || (b.source == null && !!b.checkedInAt);
  /* A check-in that completed a reservation links to it (and back). */
  const linked = useBooking(b.linkedBookingId);
  const members = b.checkedInMembers ?? [];
  const progress = Math.min(1, members.length / Math.max(b.guests, 1));
  const checkInYear = yearOf(b.checkIn);
  const checkOutYear = yearOf(b.checkOut);
  /* A kiosk visit happened (or was tried): show the check-in progress. A
     completed reservation carries none of it: the visit is the linked
     check-in row. */
  const isReservation = b.source === 'customer';
  const visited = (b.status === 'completed' || b.status === 'failed') && !isReservation;
  const showMembers = visited || members.length > 0;

  /* Face check-in card (information only — check-in is at the kiosk) */
  const faceEnrolled = !!user?.faceEnrolled;
  const you = { name: user?.fullName, uri: avatarUri, faceEnrolled };
  const travellers = 1 + family.length;
  const ready = (faceEnrolled ? 1 : 0) + family.filter((m) => m.faceEnrolled).length;
  const pending = family.find((m) => !m.faceEnrolled);
  const when = whenLabel(b.checkIn);
  const checkedInAt = b.checkedInAt || (isReservation ? linked.data?.checkedInAt : null);
  const checkedAt = checkedInAt ? `${fmtDay(checkedInAt)}, ${fmtTime(checkedInAt)}` : null;
  const entry =
    b.status === 'completed'
      ? {
          title: 'Checked in',
          sub:
            checkedAt ??
            (isReservation ? 'Checked in at the venue kiosk.' : `${members.length} of ${b.guests} guests checked in with their face.`),
        }
      : upcoming
        ? { title: when === 'Today' ? 'Opens today' : `Opens ${fmtDay(b.checkIn)}`, sub: 'Look at the camera at the venue kiosk.' }
        : b.status === 'expired'
          ? { title: 'Expired', sub: 'No check-in was recorded at the venue.' }
          : { title: statusLabel(b.status), sub: checkedAt ?? 'Face check-in is closed for this booking.' };

  /* Facts, two per row; amount only when the API sends one. */
  const facts: { k: string; v?: string; mono?: string; sub?: string }[] = [
    { k: 'Check-in', v: fmtDay(b.checkIn), sub: checkInYear != null ? String(checkInYear) : undefined },
  ];
  if (b.checkOut) facts.push({ k: 'Check-out', v: fmtDay(b.checkOut), sub: checkOutYear != null ? String(checkOutYear) : undefined });
  // Exact kiosk time, in the user's time zone.
  if (b.checkedInAt && fmtTime(b.checkedInAt)) facts.push({ k: 'Checked in at', v: fmtTime(b.checkedInAt), sub: fmtDay(b.checkedInAt) });
  facts.push({ k: 'Guests', mono: String(b.guests) });
  if (b.amount != null) facts.push({ k: 'Amount', mono: money(b.amount) });
  const factRows: (typeof facts)[] = [];
  for (let i = 0; i < facts.length; i += 2) factRows.push(facts.slice(i, i + 2));

  /* Before you go: ID row */
  const verifiedDoc = docs.find((d) => d.status === 'verified');
  const pendingDoc = docs.find((d) => d.status === 'pending');
  const idRow = verifiedDoc
    ? { done: true, tone: 'green' as const, title: 'ID verified', sub: verifiedDoc.label, href: '' }
    : pendingDoc
      ? { done: false, tone: 'amber' as const, title: 'Verify your ID', sub: pendingDoc.label, href: `/document/${pendingDoc.id}` }
      : { done: false, tone: 'amber' as const, title: 'Add an ID', sub: 'Passport, ID card or licence', href: '/document/select-type' };

  const place = bookingPlace(b);
  const openDirections = () => {
    const q = encodeURIComponent(place);
    const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
    void Linking.openURL(url).catch(() => {});
  };
  const shareBooking = () => {
    const lines = [
      `${b.venue} · ${bookingKindLabel(b)}`,
      b.location,
      `Check-in ${fmtDay(b.checkIn)}${checkInYear != null ? ` ${checkInYear}` : ''}`,
      b.checkOut ? `Check-out ${fmtDay(b.checkOut)}${checkOutYear != null ? ` ${checkOutYear}` : ''}` : '',
      `${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}`,
    ].filter(Boolean);
    void Share.share({ message: lines.join('\n') }).catch(() => {});
  };
  const directionsRow = <ListRow icon={Navigation} tone="sky" title="Directions" sub={b.location || b.venue} onPress={openDirections} />;
  const shareRow = <ListRow icon={Share2} tone="sky" title="Share booking" sub="Send the details to anyone" onPress={shareBooking} />;

  const edit = () => router.push({ pathname: '/booking/[id]/edit', params: { id: b.id } } as never);
  const doDelete = async () => {
    try {
      await remove.mutateAsync(b.id);
      setConfirmDelete(false);
      toast({ variant: 'success', title: 'Reservation deleted' });
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/history' as never);
    } catch (e) {
      setConfirmDelete(false);
      const err = toApiError(e);
      if (err.serverCode === 'BOOKING_NOT_EDITABLE') {
        // Completed by a kiosk check-in or its dates passed meanwhile.
        toast({ variant: 'error', title: err.message });
        refetch();
        void bookingsList.refetch();
      } else {
        toast({ variant: 'error', title: "Couldn't delete the reservation", description: err.message });
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} {...heroStatusBar}>
        {/* ---------- photo header ---------- */}
        <View style={{ height: 340 }}>
          <BookingBackdrop b={b} />
          <LinearGradient
            colors={['rgba(1,27,39,0.45)', 'rgba(1,27,39,0)', 'rgba(1,27,39,0.75)']}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top']}>
            <TopBar tone="glass" right={editable ? <IconCircle icon={Pencil} tone="glass" label="Edit reservation" onPress={edit} /> : undefined} />
          </SafeAreaView>
          <View style={{ position: 'absolute', left: 20, right: 20, bottom: 52, gap: 6 }}>
            <Row gap={8}>
              <BookingKindIcon b={b} size={15} color={C.skyLight} />
              <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.skyLight }}>{bookingKindLabel(b)}</Text>
            </Row>
            <Text style={{ fontFamily: F.extrabold, fontSize: 32, letterSpacing: -1, color: C.white }} numberOfLines={2}>
              {b.venue}
            </Text>
            {!!b.location && (
              <Row gap={6}>
                <MapPin size={14} color="rgba(255,255,255,0.8)" />
                <Text style={{ fontFamily: F.medium, fontSize: 14, color: 'rgba(255,255,255,0.8)', flexShrink: 1 }} numberOfLines={1}>
                  {b.location}
                </Text>
              </Row>
            )}
          </View>
        </View>

        <View
          style={{
            marginTop: -28,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            backgroundColor: C.canvas,
            paddingHorizontal: 20,
            paddingTop: 22,
            gap: 26,
          }}
        >
          <Row between>
            <BookingStatusBadge status={b.status} dot />
            <Txt v="smallStrong" color={C.ink3}>
              {whenLabel(b.checkedInAt || b.checkIn)}
            </Txt>
          </Row>

          {b.status === 'expired' && <Banner tone="info" title="Expired — no check-in recorded" body="The dates passed without a check-in at the venue kiosk." />}

          {/* ---------- facts ---------- */}
          <Card pad={0}>
            {factRows.map((row, i) => (
              <View key={row[0].k}>
                {i > 0 && <Divider />}
                <Row style={{ padding: 18 }} align="flex-start">
                  {row.map((f, j) => (
                    <Fragment key={f.k}>
                      {j > 0 && <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: C.lineSoft, marginHorizontal: 16 }} />}
                      <Fact k={f.k} v={f.v} sub={f.sub}>
                        {f.mono != null ? <Text style={{ fontFamily: F.mono, fontSize: 17, color: C.ink }}>{f.mono}</Text> : undefined}
                      </Fact>
                    </Fragment>
                  ))}
                </Row>
              </View>
            ))}
            {visited && (
              <>
                <Divider />
                <View style={{ padding: 18, gap: 10 }}>
                  <Row between>
                    <Row gap={10}>
                      <Users size={18} color={C.ink3} />
                      <Txt v="body">Checked-in members</Txt>
                    </Row>
                    <Text style={{ fontFamily: F.mono, fontSize: 15, color: C.ink }}>
                      {members.length}/{b.guests}
                    </Text>
                  </Row>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden' }}>
                    <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, backgroundColor: C.sky }} />
                  </View>
                </View>
              </>
            )}
          </Card>

          {/* ---------- notes ---------- */}
          {!!b.notes?.trim() && (
            <View style={{ gap: 14 }}>
              <SectionHead title="Notes" />
              <Card pad={16}>
                <Txt v="body">{b.notes.trim()}</Txt>
              </Card>
            </View>
          )}

          {/* ---------- who's checked in ---------- */}
          {showMembers && (
            <View style={{ gap: 14 }}>
              <SectionHead title={upcoming ? "Who's going" : 'Checked in'} />
              <Card pad={16}>
                {members.length === 0 ? (
                  <Txt v="small">No one has checked in yet.</Txt>
                ) : (
                  <View style={{ gap: 12 }}>
                    {members.map((x, i) => {
                      const name = memberName(x, user, family);
                      return (
                        <Row key={`${x}-${i}`} gap={12}>
                          <Avatar name={name} size={40} status={upcoming ? undefined : 'verified'} />
                          <Txt v="bodyStrong" lines={1} style={{ flex: 1 }}>
                            {name}
                          </Txt>
                        </Row>
                      );
                    })}
                  </View>
                )}
              </Card>
            </View>
          )}

          {/* ---------- the reservation this check-in completed (and back) ---------- */}
          {!!b.linkedBookingId && (
            <Group title={isKioskCheckIn ? 'Your reservation' : 'Kiosk check-in'}>
              <ListRow
                icon={Link2}
                tone="sky"
                title={isKioskCheckIn ? 'View reservation' : 'View check-in'}
                sub={
                  linked.data
                    ? linked.data.notes?.trim() || `${bookingKindLabel(linked.data)} · ${fmtDay(linked.data.checkIn)}`
                    : isKioskCheckIn
                      ? 'The booking you added before your visit'
                      : 'Your check-in at the venue kiosk'
                }
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.linkedBookingId as string } } as never)}
              />
            </Group>
          )}

          {/* ---------- face check-in: information only, check-in is at the kiosk ---------- */}
          <View style={[{ borderRadius: R.xl, overflow: 'hidden', padding: 20, gap: 18 }, SH.navy]}>
            <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Guilloche size={380} style={{ right: -190, top: -190 }} />
            <Row between align="flex-start">
              <View style={{ gap: 4, flex: 1, paddingRight: 12 }}>
                <Text style={{ fontFamily: F.semibold, fontSize: 12, letterSpacing: 1.3, color: C.skyLight }}>FACE CHECK-IN</Text>
                <Text style={{ fontFamily: F.extrabold, fontSize: 28, letterSpacing: -1, color: C.white }}>{entry.title}</Text>
                <Text style={{ fontFamily: F.medium, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.7)' }}>{entry.sub}</Text>
              </View>
              <View style={{ backgroundColor: C.white, width: 92, height: 92, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
                {b.status === 'expired' ? (
                  <CalendarX size={42} color={C.ink3} strokeWidth={1.6} />
                ) : (
                  <ScanFace size={46} color={C.sky} strokeWidth={1.6} />
                )}
              </View>
            </Row>
            {b.durationMs != null && b.durationMs > 0 && (
              <>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.14)' }} />
                <Row gap={10}>
                  <Timer size={18} color={C.skyLight} />
                  <Text style={{ fontFamily: F.semibold, fontSize: 14, color: C.white }}>Checked in in {fmtSeconds(b.durationMs)}</Text>
                </Row>
              </>
            )}
            {upcoming && (
              <>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.14)' }} />
                <Row between gap={12}>
                  <TravellerStack you={you} members={family} />
                  <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 15, color: C.white }}>
                      {ready}/{travellers}
                    </Text>
                    <Text style={{ fontFamily: F.medium, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' }}>faces ready</Text>
                  </View>
                </Row>
              </>
            )}
          </View>

          {/* ---------- before you go / your visit: only actions that work today ---------- */}
          {upcoming ? (
            <Group title="Before you go">
              <ListRow
                icon={ScanFace}
                tone={faceEnrolled ? 'green' : 'amber'}
                title={faceEnrolled ? 'Face enrolled' : 'Enrol your face'}
                sub={faceEnrolled ? 'Your face is your key' : 'Needed to check in at the kiosk'}
                trailing={faceEnrolled ? <Badge label="Done" tone="green" /> : undefined}
                chevron={!faceEnrolled}
                onPress={faceEnrolled ? undefined : () => router.push('/face-update/pin' as never)}
              />
              <ListRow
                icon={FileCheck}
                tone={idRow.tone}
                title={idRow.title}
                sub={idRow.sub}
                trailing={idRow.done ? <Badge label="Done" tone="green" /> : undefined}
                chevron={!idRow.done}
                onPress={idRow.done ? undefined : () => router.push(idRow.href as never)}
              />
              <ListRow
                icon={UsersRound}
                tone={family.length === 0 ? 'sky' : pending ? 'amber' : 'green'}
                title={family.length === 0 ? 'Travelling with family?' : `Family faces ${ready - (faceEnrolled ? 1 : 0)} of ${family.length}`}
                sub={
                  family.length === 0
                    ? 'Add them to check in together'
                    : pending
                      ? `${pending.name.split(' ')[0]} still needs a face scan`
                      : 'Everyone can check in with you'
                }
                trailing={family.length > 0 && !pending ? <Badge label="Done" tone="green" /> : undefined}
                chevron={family.length === 0 || !!pending}
                onPress={
                  family.length === 0
                    ? () => router.push('/family/add' as never)
                    : pending
                      ? () => router.push(`/family/${pending.id}` as never)
                      : undefined
                }
              />
              {directionsRow}
              {shareRow}
            </Group>
          ) : (
            <Group title="Your visit">
              {directionsRow}
              {shareRow}
            </Group>
          )}

          {/* ---------- the customer's own upcoming reservation ---------- */}
          {editable && (
            <Group title="Reservation">
              <ListRow icon={Pencil} tone="sky" title="Edit reservation" sub="Dates, guests, who's going and notes" onPress={edit} />
              <ListRow icon={Trash2} danger title="Delete reservation" chevron={false} onPress={() => setConfirmDelete(true)} />
            </Group>
          )}
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={confirmDelete}
        danger
        icon={Trash2}
        title="Delete this reservation?"
        body={`${b.venue} on ${fmtDay(b.checkIn)} will be removed from your check-ins.`}
        confirmLabel="Delete reservation"
        loading={remove.isPending}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
