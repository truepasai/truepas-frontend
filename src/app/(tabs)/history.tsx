/** @jsxImportSource react */
/**
 * Check-ins tab — GET /cb/bookings (kiosk check-ins + the user's own
 * reservations) filtered by the approved design's category chips (All /
 * Hotels / Travel / Events, from `kind`, or `type` on older payloads),
 * Upcoming first and past visits by month, drilling into booking detail.
 * "Add reservation" (header + empty state) opens /booking/new. The year
 * card shows GET /user/me/stats; while the server reports no check-ins
 * (zeros on dev until check-in events flow) it shows what's in place for
 * the first visit, and the list shows how a check-in works for the
 * selected category.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { CalendarPlus, Check, Plus } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUserStats } from '@/features/account/hooks';
import { useDocuments } from '@/features/documents/hooks';
import { useFamily } from '@/features/family/hooks';
import { useBookings } from '@/features/history/hooks';
import { Guilloche, TAB_BAR_SPACE } from '@/premium/blocks';
import { BookingRow, bookingKind, bookingWhen, FirstCheckInRow, fmtMonthLabel, fmtSeconds, TabTitle, yearOf } from '@/premium/flows/home';
import { IMG, type ImgKey } from '@/premium/images';
import { Async, SkeletonList } from '@/premium/kit';
import { C, F, G, R } from '@/premium/theme';
import { Badge, Button, Card, Chip, Divider, IconCircle, Press, Row, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { Booking, UserStats } from '@/types/domain';

type Cat = 'all' | 'hotels' | 'travel' | 'events';

const CATS: { id: Cat; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hotels', label: 'Hotels' },
  { id: 'travel', label: 'Travel' },
  { id: 'events', label: 'Events' },
];

/** Booking kind (kind ?? older `type`) → chip. `other` only appears under All. */
function catOf(b: Booking): Cat | null {
  const k = bookingKind(b);
  if (k === 'hotel') return 'hotels';
  if (k === 'flight' || k === 'cruise') return 'travel';
  if (k === 'park' || k === 'cinema' || k === 'stadium' || k === 'concert') return 'events';
  return null;
}

export default function HistoryScreen() {
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const bookingsQuery = useBookings();
  const documents = useDocuments();
  const family = useFamily();
  const year = new Date().getFullYear();
  const stats = useUserStats(year);
  const [cat, setCat] = useState<Cat>('all');

  /* Tabs stay mounted, so switching back would show the cached list. Refetch
     on every re-focus so a check-in completed meanwhile shows up (BUG018);
     the first focus is covered by the query's own mount fetch. */
  const { refetch } = bookingsQuery;
  const refetchStats = stats.refetch;
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) {
        void refetch();
        void refetchStats();
      }
      focusedOnce.current = true;
    }, [refetch, refetchStats]),
  );

  const open = (b: Booking) => () => router.push(`/booking/${b.id}` as never);
  const addReservation = () => router.push('/booking/new' as never);

  const readiness = {
    faceEnrolled: !!user?.faceEnrolled,
    ids: (documents.data ?? []).filter((d) => d.status === 'verified').length,
    travellers: 1 + (family.data?.length ?? 0),
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={bookingsQuery.isRefetching}
              onRefresh={() => {
                void bookingsQuery.refetch();
                void stats.refetch();
              }}
              tintColor={C.sky}
              colors={[C.sky]}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: TAB_BAR_SPACE + 20, gap: 26, flexGrow: 1 }}
        >
          <TabTitle right={<IconCircle icon={CalendarPlus} label="Add reservation" onPress={addReservation} />}>Check-ins</TabTitle>

          <Async q={bookingsQuery} skeleton={<SkeletonList rows={4} thumb={62} />}>
            {(list) => {
              const count = (c: Cat) => (c === 'all' ? list.length : list.filter((b) => catOf(b) === c).length);
              const filtered = cat === 'all' ? list : list.filter((b) => catOf(b) === cat);
              const upcoming = filtered
                .filter((b) => b.status === 'upcoming')
                .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
              // Newest first: kiosk check-ins by their exact time, reservations by day.
              const past = filtered
                .filter((b) => b.status !== 'upcoming')
                .sort((a, b) => bookingWhen(b).localeCompare(bookingWhen(a)));

              const groups: { label: string; items: Booking[]; upcoming?: boolean }[] = [];
              if (upcoming.length > 0) groups.push({ label: 'Upcoming', items: upcoming, upcoming: true });
              for (const b of past) {
                const label = fmtMonthLabel(bookingWhen(b));
                const g = groups.find((x) => x.label === label);
                if (g) g.items.push(b);
                else groups.push({ label, items: [b] });
              }

              return (
                <>
                  <YearStats
                    year={year}
                    list={list}
                    server={stats.data}
                    readiness={readiness}
                    onOpen={(href) => router.push(href as never)}
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexGrow: 0, marginHorizontal: -20 }}
                    contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
                  >
                    {CATS.map((c) => {
                      const n = count(c.id);
                      return (
                        <Chip
                          key={c.id}
                          label={n > 0 ? `${c.label} (${n})` : c.label}
                          active={cat === c.id}
                          onPress={() => setCat(c.id)}
                        />
                      );
                    })}
                  </ScrollView>

                  {groups.length === 0 ? (
                    <CheckInGuide cat={cat} onAdd={addReservation} />
                  ) : (
                    groups.map((g) => (
                      <View key={g.label} style={{ gap: 10 }}>
                        <GroupHead
                          title={g.label}
                          note={
                            g.upcoming
                              ? `${g.items.length} planned`
                              : `${g.items.length} ${g.items.length === 1 ? 'visit' : 'visits'}`
                          }
                        />
                        <Card pad={0} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                          {g.items.map((b, i) => (
                            <View key={b.id}>
                              {i > 0 && <Divider inset={76} />}
                              <BookingRow b={b} onPress={open(b)} />
                            </View>
                          ))}
                        </Card>
                      </View>
                    ))
                  )}
                </>
              );
            }}
          </Async>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function GroupHead({ title, note }: { title: string; note: string }) {
  return (
    <Row between>
      <Txt v="h3" style={{ fontSize: 18 }}>
        {title}
      </Txt>
      <Txt v="smallStrong" color={C.skyPressed}>
        {note}
      </Txt>
    </Row>
  );
}

/* ───────────────────────── empty list: how a check-in works ───────────────────────── */

type GuideStep = { photo: ImgKey; title: string; sub: string };

const GUIDES: Record<Cat, { title: string; first?: boolean; steps: GuideStep[] }> = {
  all: {
    title: 'Getting started',
    first: true,
    steps: [
      { photo: 'hotelPool', title: 'Book a partner venue', sub: 'Hotels, parks, flights and events' },
      { photo: 'kiosk', title: 'Look at the kiosk camera', sub: 'No ID card, no forms to fill' },
      { photo: 'familyWalk', title: 'Walk in together', sub: 'Your family checks in with you' },
    ],
  },
  hotels: {
    title: 'Checking in at a hotel',
    steps: [
      { photo: 'hotelNight', title: 'Skip the front desk', sub: 'Go straight to the lobby kiosk' },
      { photo: 'kiosk', title: 'Look at the kiosk camera', sub: 'Your face confirms the booking' },
      { photo: 'room', title: 'Head to your room', sub: 'No paperwork at arrival' },
    ],
  },
  travel: {
    title: 'Checking in to travel',
    steps: [
      { photo: 'flight', title: 'Arrive at the gate', sub: 'Your verified ID is already linked' },
      { photo: 'kiosk', title: 'Face match at boarding', sub: 'Your face confirms it’s you' },
      { photo: 'familyPlane', title: 'Board with your family', sub: 'Members check in alongside you' },
    ],
  },
  events: {
    title: 'Checking in at events',
    steps: [
      { photo: 'themepark', title: 'Walk up to the entry', sub: 'No tickets to dig out' },
      { photo: 'kiosk', title: 'Look at the entry camera', sub: 'Your face is matched to the booking' },
      { photo: 'familyWalk', title: 'Bring the kids', sub: 'Family members enter with you' },
    ],
  },
};

function CheckInGuide({ cat, onAdd }: { cat: Cat; onAdd: () => void }) {
  const g = GUIDES[cat];
  return (
    <View style={{ gap: 10 }}>
      <GroupHead title={g.title} note="Before your first visit" />
      <Card pad={0} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
        {g.first && <FirstCheckInRow />}
        {g.steps.map((s, i) => (
          <View key={s.title}>
            {(i > 0 || g.first) && <Divider inset={76} />}
            <GuideRow step={s} n={i + 1} />
          </View>
        ))}
      </Card>
      <Card pad={16} style={{ marginTop: 6, gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Txt v="bodyStrong">Already booked somewhere?</Txt>
          <Txt v="small">Add the reservation to keep your plans in one place.</Txt>
        </View>
        <Button label="Add reservation" icon={CalendarPlus} tone="soft" size="md" onPress={onAdd} />
      </Card>
    </View>
  );
}

/** Same layout as BookingRow: photo thumbnail, two lines, badge. */
function GuideRow({ step, n }: { step: GuideStep; n: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Step ${n}: ${step.title}. ${step.sub}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}
    >
      <View style={{ width: 62, height: 62, borderRadius: 16, overflow: 'hidden' }}>
        <Image source={IMG[step.photo]} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt v="bodyStrong" lines={2}>
          {step.title}
        </Txt>
        <Txt v="small" lines={2}>
          {step.sub}
        </Txt>
      </View>
      <Badge label={`Step ${n}`} tone="sky" />
    </View>
  );
}

/* ───────────────────────── year card ───────────────────────── */

type Readiness = { faceEnrolled: boolean; ids: number; travellers: number };

/** Year-in-numbers header from GET /user/me/stats (check-ins, cities, the
 *  average kiosk time, minutes saved). Until the server has it (loading or
 *  failed) the numbers come from the bookings list. Before the year's first
 *  check-in it shows what the user already brings to it (face, IDs,
 *  travellers) in the same footprint; a missing piece opens its setup. */
function YearStats({
  year,
  list,
  server,
  readiness,
  onOpen,
}: {
  year: number;
  list: Booking[];
  server: UserStats | undefined;
  readiness: Readiness;
  onOpen: (href: string) => void;
}) {
  const done = list.filter((b) => b.status === 'completed' && yearOf(bookingWhen(b)) === year);
  const total = server ? server.checkIns : done.length;
  const fresh = total === 0;
  const places = new Set(done.map((b) => (b.location ?? '').trim().toLowerCase()).filter(Boolean)).size;
  const guests = done.reduce((n, b) => n + b.guests, 0);
  const ready = readiness.faceEnrolled && readiness.ids > 0;
  const stats: { v: string; k: string }[] = server
    ? [
        { v: String(server.checkIns), k: server.checkIns === 1 ? 'Check-in' : 'Check-ins' },
        { v: String(server.cities), k: server.cities === 1 ? 'City' : 'Cities' },
        { v: server.avgCheckInMs != null ? fmtSeconds(server.avgCheckInMs) : '—', k: 'Avg. time' },
        { v: `${server.minutesSaved} min`, k: 'Saved' },
      ]
    : [
        { v: String(done.length), k: done.length === 1 ? 'Check-in' : 'Check-ins' },
        { v: String(places), k: places === 1 ? 'Place' : 'Places' },
        { v: String(guests), k: 'Guests' },
        { v: '—', k: 'Avg. time' },
      ];

  return (
    <View style={{ borderRadius: R.xl, overflow: 'hidden', padding: 20, gap: fresh ? 14 : 18 }}>
      <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Guilloche size={260} opacity={0.07} style={{ right: -120, top: -130 }} />
      <Row between>
        <Txt v="micro" color={C.skyLight}>
          {fresh ? `Your ${year} starts here` : `Your ${year} so far`}
        </Txt>
      </Row>
      {fresh ? (
        <>
          <Text style={{ fontFamily: F.bold, fontSize: 20, letterSpacing: -0.5, color: C.white, marginTop: -4 }} numberOfLines={1}>
            {ready ? 'Ready for your ' : 'Before your '}
            <Text style={{ fontFamily: F.serifItalic, fontSize: 24, letterSpacing: 0, color: C.skyLight }}>first check-in</Text>
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ReadyPill
              done={readiness.faceEnrolled}
              label={readiness.faceEnrolled ? 'Face linked' : 'Link face'}
              onPress={() => onOpen('/face-update/pin')}
            />
            <ReadyPill
              done={readiness.ids > 0}
              label={readiness.ids > 0 ? `${readiness.ids} ${readiness.ids === 1 ? 'ID' : 'IDs'}` : 'Add ID'}
              onPress={() => onOpen('/document/select-type')}
            />
            <ReadyPill
              done={readiness.travellers > 1}
              label={readiness.travellers > 1 ? `${readiness.travellers} travellers` : 'Add family'}
              onPress={() => onOpen('/family/add')}
            />
          </View>
        </>
      ) : (
        <Row between>
          {stats.map((s) => (
            <View key={s.k} style={{ gap: 2 }}>
              <Text style={{ fontFamily: F.extrabold, fontSize: 26, letterSpacing: -0.8, color: C.white }}>{s.v}</Text>
              <Text style={{ fontFamily: F.medium, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{s.k}</Text>
            </View>
          ))}
        </Row>
      )}
    </View>
  );
}

/** What the user brings to a check-in. Done pieces are glass with a tick;
 *  a missing one is a dashed sky pill that opens its setup. */
function ReadyPill({ label, done, onPress }: { label: string; done: boolean; onPress: () => void }) {
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 28,
        paddingLeft: 6,
        paddingRight: 10,
        borderRadius: R.full,
        borderWidth: 1,
        borderStyle: done ? 'solid' : 'dashed',
        borderColor: done ? 'rgba(255,255,255,0.16)' : C.skyLight,
        backgroundColor: done ? 'rgba(255,255,255,0.08)' : 'rgba(8,182,252,0.14)',
      }}
    >
      {done ? (
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.sky, alignItems: 'center', justifyContent: 'center' }}>
          <Check size={10} color={C.white} strokeWidth={3.2} />
        </View>
      ) : (
        <Plus size={14} color={C.skyLight} strokeWidth={2.6} />
      )}
      <Text style={{ fontFamily: F.semibold, fontSize: 12.5, color: done ? C.white : C.skyLight }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  if (done) {
    return (
      <View accessible accessibilityLabel={`${label}, ready`}>
        {body}
      </View>
    );
  }
  return (
    <Press onPress={onPress} label={label} role="button" scaleTo={0.95}>
      {body}
    </Press>
  );
}
