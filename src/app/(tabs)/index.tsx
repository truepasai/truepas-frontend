/** @jsxImportSource react */
/**
 * Home — "my identity + my journey". Premium layout over the real data:
 * useFamily / useBookings (kiosk check-ins + the user's own reservations) /
 * useNotificationCount (bell dot) / useAccountActivity (server feed) plus
 * the identity summary for the identity-card badge.
 *
 * Header avatar opens the profile drawer (account card + settings menu +
 * sign out / delete account); bell shows the unread dot; next upcoming
 * booking or reservation is the hero (check-in itself happens only at the
 * venue kiosk, so the hero has no check-in button); stacked family card
 * (you + members, face status); the two most recent past check-ins;
 * pull-to-refresh refetches everything.
 *
 * No upcoming bookings (every new user): the hero and carousel keep their
 * photo cards but show the user's real setup progress (face / ID / family),
 * where TruePas works and how it works, instead of disappearing.
 */
import { useRouter } from 'expo-router';
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  FileScan,
  IdCard,
  type LucideIcon,
  MapPin,
  ScanFace,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccountActivity } from '@/features/account/hooks';
import { useDocuments } from '@/features/documents/hooks';
import { useFamily, useSyncMemberPhotos } from '@/features/family/hooks';
import { useBookings } from '@/features/history/hooks';
import { useIdentitySummary } from '@/features/identity/hooks';
import { useNotificationCount } from '@/features/notifications/hooks';
import { useProfilePicture, useSyncProfilePicture } from '@/features/profile/hooks';
import { AppLockOffer } from '@/features/settings/AppLockOffer';
import { IdentityCard, TAB_BAR_SPACE } from '@/premium/blocks';
import {
  ActivityRow,
  BookingCarouselCard,
  BookingHero,
  BookingRow,
  bookingWhen,
  buildActivity,
  feedActivity,
  FirstCheckInRow,
  greeting,
  isTodayIso,
  ProfileDrawer,
  ReadyHero,
  TogetherCard,
  VENUES,
  VenueCard,
} from '@/premium/flows/home';
import { Async, Bone, SkeletonList } from '@/premium/kit';
import { C, DESCENDERS, F, R } from '@/premium/theme';
import { Avatar, Button, Card, Divider, IconCircle, Press, Row, SectionHead, Serif, Tile, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';
import type { VerificationStatus } from '@/types/domain';

export default function HomeScreen() {
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const { url: avatarUri } = useProfilePicture();
  const [drawer, setDrawer] = useState(false);

  const family = useFamily();
  // Photos that only made it to this phone get uploaded in the background.
  useSyncMemberPhotos(family.data);
  useSyncProfilePicture();
  const bookings = useBookings();
  const unread = useNotificationCount();
  const summary = useIdentitySummary();
  const documents = useDocuments();
  const feed = useAccountActivity();

  const hasUnread = (unread.data?.unread ?? 0) > 0;
  /* Kiosk visits only (an expired reservation never became a check-in), newest first. */
  const past = (bookings.data?.filter((b) => b.status === 'completed' || b.status === 'failed') ?? []).sort((a, b) =>
    bookingWhen(b).localeCompare(bookingWhen(a)),
  );
  const upcoming = (bookings.data?.filter((b) => b.status === 'upcoming') ?? []).sort((a, b) =>
    a.checkIn.localeCompare(b.checkIn),
  );
  const [nextUpcoming, ...laterUpcoming] = upcoming;

  /* No trips yet: the hero shows real setup progress instead of a booking. */
  const noTrips = bookings.data != null && upcoming.length === 0;
  const showCarousel = laterUpcoming.length > 0 || noTrips;

  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? '';

  /* No check-ins yet: real account activity fills the same rows — the
     server feed, or (while it loads, fails or is empty) the same events
     derived from documents and family. */
  const activity = (
    feed.data && feed.data.length > 0
      ? feedActivity(feed.data)
      : buildActivity({
          server: summary.data?.activity ?? [],
          faceEnrolled: !!user?.faceEnrolled,
          docs: documents.data ?? [],
          members: family.data ?? [],
          firstName,
        })
  ).slice(0, 3);
  const showActivity = bookings.data != null && past.length === 0;

  const refreshing =
    family.isRefetching ||
    bookings.isRefetching ||
    unread.isRefetching ||
    summary.isRefetching ||
    documents.isRefetching ||
    feed.isRefetching;
  const onRefresh = () => {
    void documents.refetch();
    void family.refetch();
    void bookings.refetch();
    void unread.refetch();
    void summary.refetch();
    void feed.refetch();
  };

  const open = (href: string) => () => router.push(href as never);

  /* Identity-card badge: the server-computed summary when we have it,
     otherwise the session's face-enrolment flag. */
  const idVerified = summary.data ? summary.data.status === 'verified' : !!user?.faceEnrolled;
  const idLabel = summary.data
    ? summary.data.status === 'verified'
      ? 'Verified'
      : 'Incomplete'
    : user?.faceEnrolled
      ? 'Face linked'
      : 'Setup pending';

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE + 20, gap: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.sky} />}
        >
          {/* ---------- greeting + identity ---------- */}
          <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 22 }}>
            <Row between>
              <Press onPress={() => setDrawer(true)} label="Profile" role="button">
                <Row gap={12}>
                  <Avatar uri={avatarUri} name={user?.fullName} size={46} ring />
                  <View>
                    <Txt v="small">{greeting()}</Txt>
                    <Txt v="h3" style={{ fontSize: 19 }} lines={1}>
                      {firstName}
                    </Txt>
                  </View>
                </Row>
              </Press>
              <IconCircle icon={Bell} label="Notifications" dot={hasUnread} onPress={open('/notification')} />
            </Row>

            <Text style={{ fontFamily: F.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -1.1, color: C.ink, ...DESCENDERS }}>
              Where are you{'\n'}going <Serif size={40} color={C.sky}>today?</Serif>
            </Text>

            <IdentityCard
              compact
              name={user?.fullName ?? ''}
              idLine={user?.email ?? ''}
              photoUri={avatarUri ?? null}
              verified={idVerified}
              statusLabel={idLabel}
              onPress={open('/identity')}
            />
          </View>

          {/* ---------- next check-in — the primary moment ---------- */}
          {bookings.isPending && bookings.data == null ? (
            <View style={{ paddingHorizontal: 20, gap: 16 }}>
              <Bone w="38%" h={20} />
              <Bone h={320} r={R.xxl} />
            </View>
          ) : nextUpcoming != null ? (
            <View style={{ paddingHorizontal: 20, gap: 16 }}>
              <SectionHead
                title={isTodayIso(nextUpcoming.checkIn) ? 'Today' : 'Next check-in'}
                action="Details"
                onAction={open(`/booking/${nextUpcoming.id}`)}
              />
              <BookingHero b={nextUpcoming} onPress={open(`/booking/${nextUpcoming.id}`)} />
            </View>
          ) : noTrips ? (
            <View style={{ paddingHorizontal: 20, gap: 16 }}>
              {summary.isPending && summary.data == null ? (
                <>
                  <Bone w="38%" h={20} />
                  <Bone h={320} r={R.xxl} />
                </>
              ) : (
                <GetReady
                  faceDone={summary.data ? summary.data.face === 'verified' : !!user?.faceEnrolled}
                  doc={summary.data?.document}
                  familyCount={family.data?.length ?? 0}
                  open={open}
                />
              )}
            </View>
          ) : null}

          {/* ---------- no trips: where TruePas works ---------- */}
          {noTrips && (
            <View style={{ gap: 16 }}>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionHead title="Use TruePas at" />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingBottom: 16 }}
              >
                {VENUES.map((v) => (
                  <VenueCard key={v.kind} v={v} />
                ))}
              </ScrollView>
            </View>
          )}

          {/* ---------- no trips: how it works ---------- */}
          {noTrips && (
            <View style={{ paddingHorizontal: 20, gap: 16, marginTop: -14 }}>
              <SectionHead title="How it works" />
              <Card pad={18}>
                <Row gap={10} align="flex-start">
                  <HowStep n={1} icon={CalendarDays} title="Book" sub="Stay, ride or show at a partner venue" />
                  <HowStep n={2} icon={MapPin} title="Arrive" sub="No queue, no forms to fill" />
                  <HowStep n={3} icon={ScanFace} title="Look & walk in" sub="Your face is your key" />
                </Row>
              </Card>
            </View>
          )}

          {/* ---------- coming up ---------- */}
          {laterUpcoming.length > 0 && (
            <View style={{ gap: 16 }}>
              <View style={{ paddingHorizontal: 20 }}>
                <SectionHead title="Coming up" action="See all" onAction={open('/(tabs)/history')} />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingBottom: 16 }}
              >
                {laterUpcoming.map((b) => (
                  <BookingCarouselCard key={b.id} b={b} onPress={open(`/booking/${b.id}`)} />
                ))}
              </ScrollView>
            </View>
          )}

          {/* ---------- quick actions ---------- */}
          <View style={{ paddingHorizontal: 20, gap: 16, marginTop: showCarousel && !noTrips ? -14 : 0 }}>
            <SectionHead title="Quick actions" />
            <Row gap={10} align="stretch">
              <QuickAction icon={FileScan} label={'Add\ndocument'} onPress={open('/document/select-type')} />
              <QuickAction icon={UserPlus} label={'Add\nfamily'} onPress={open('/family/add')} />
              <QuickAction icon={CalendarPlus} label={'Add\nbooking'} onPress={open('/booking/new')} />
              <QuickAction icon={IdCard} label={'Your\nidentity'} onPress={open('/identity')} />
            </Row>
          </View>

          {/* ---------- family ---------- */}
          <View style={{ paddingHorizontal: 20, gap: 16 }}>
            <SectionHead title="Travelling together" action="Manage" onAction={open('/family')} />
            <Async
                q={family}
                compact
                skeleton={
                  <Card pad={18} style={{ gap: 16 }}>
                    <Row gap={6}>
                      {[0, 1, 2, 3].map((i) => (
                        <Bone key={i} w={50} h={50} r={25} />
                      ))}
                    </Row>
                    <Bone w="60%" h={14} />
                  </Card>
                }
              >
                {(members) => (
                  <TogetherCard
                    members={members}
                    you={{ name: user?.fullName, uri: avatarUri, faceEnrolled: !!user?.faceEnrolled }}
                    onOpen={open('/family')}
                    onAdd={open('/family/add')}
                    onMember={(id) => router.push(`/family/${id}` as never)}
                  />
                )}
              </Async>
          </View>

          {/* ---------- previous check-ins (or account activity before the first) ---------- */}
          <View style={{ paddingHorizontal: 20, gap: 8 }}>
            <SectionHead
              title={showActivity ? 'Recent activity' : 'Recent check-ins'}
              action="See all"
              onAction={open(showActivity ? '/identity' : '/(tabs)/history')}
            />
            <Async q={bookings} compact skeleton={<SkeletonList rows={2} thumb={62} />}>
              {() =>
                past.length === 0 ? (
                  <Card pad={0} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                    <FirstCheckInRow />
                    {activity.map((e) => (
                      <View key={e.id}>
                        <Divider inset={76} />
                        <ActivityRow e={e} onPress={open(e.href)} />
                      </View>
                    ))}
                  </Card>
                ) : (
                  <Card pad={0} style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                    {past.slice(0, 2).map((b, i) => (
                      <View key={b.id}>
                        {i > 0 && <Divider inset={76} />}
                        <BookingRow b={b} onPress={open(`/booking/${b.id}`)} />
                      </View>
                    ))}
                  </Card>
                )
              }
            </Async>
          </View>
        </ScrollView>
      </SafeAreaView>

      <ProfileDrawer visible={drawer} onClose={() => setDrawer(false)} />
      <AppLockOffer />
    </View>
  );
}

/**
 * No-trips hero: the next setup step, from the same checks the Identity
 * screen uses (face → document → family). Nothing here is a made-up booking.
 */
function GetReady({
  faceDone,
  doc,
  familyCount,
  open,
}: {
  faceDone: boolean;
  doc?: VerificationStatus;
  familyCount: number;
  open: (href: string) => () => void;
}) {
  const docDone = doc === 'verified';
  const steps = [
    { label: 'Face', done: faceDone },
    { label: 'ID', done: docDone },
    { label: 'Family', done: familyCount > 0 },
  ];
  const allDone = steps.every((x) => x.done);

  const hero = !faceDone
    ? {
        photo: 'stadium' as const,
        chip: { icon: ScanFace, label: 'Face ID' },
        eyebrow: 'Next step',
        title: 'Your face is your key',
        body: 'Enrol your face once, then check in at partner venues with just a look.',
        cta: <Button label="Set up face ID" icon={ScanFace} onPress={open('/face-update/pin')} />,
      }
    : doc === 'pending'
      ? {
          photo: 'room' as const,
          chip: { icon: FileScan, label: 'Document' },
          eyebrow: 'Next step',
          title: 'Verify your ID',
          body: 'Your document is added. Finish verifying it to travel with one identity.',
          cta: <Button label="Verify your ID" icon={FileScan} onPress={open('/(tabs)/documents')} />,
        }
      : !docDone
        ? {
            photo: 'hotelNight' as const,
            chip: { icon: FileScan, label: 'Document' },
            eyebrow: 'Next step',
            title: 'Add your ID once',
            body: 'Scan your passport or ID card and travel everywhere with one verified identity.',
            cta: <Button label="Add a document" icon={FileScan} onPress={open('/document/select-type')} />,
          }
        : familyCount === 0
          ? {
              photo: 'hotelDusk' as const,
              chip: { icon: Users, label: 'Family' },
              eyebrow: 'Almost there',
              title: 'Travelling with family?',
              body: 'Add them now and check in together, kids included.',
              cta: <Button label="Add family member" icon={UserPlus} onPress={open('/family/add')} />,
            }
          : {
              photo: 'hotelPool' as const,
              chip: { icon: ShieldCheck, label: 'Verified' },
              eyebrow: "You're all set",
              title: 'Ready for your first check-in',
              body: 'Add a reservation and your trip shows up right here.',
              cta: <Button label="Add reservation" icon={CalendarPlus} onPress={open('/booking/new')} />,
            };

  return (
    <>
      <SectionHead
        title={allDone ? 'Next check-in' : 'Get ready to travel'}
        action="Identity"
        onAction={open('/identity')}
      />
      <ReadyHero {...hero} steps={steps} />
    </>
  );
}

function HowStep({ n, icon, title, sub }: { n: number; icon: LucideIcon; title: string; sub: string }) {
  return (
    <View style={{ flex: 1, gap: 10 }}>
      <Tile icon={icon} tone="sky" size={44} radius={22} />
      <View style={{ gap: 3 }}>
        <Txt v="small" color={C.skyPressed} style={{ fontFamily: F.semibold }}>
          Step {n}
        </Txt>
        <Txt v="bodyStrong" style={{ fontSize: 14.5, lineHeight: 19 }}>
          {title}
        </Txt>
        <Txt v="small" style={{ fontSize: 12.5, lineHeight: 17 }}>
          {sub}
        </Txt>
      </View>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} label={label.replace('\n', ' ')} role="button" style={{ flex: 1 }}>
      <Card pad={0} style={{ alignItems: 'center', gap: 10, borderRadius: R.lg, flex: 1, paddingVertical: 14, paddingHorizontal: 4 }}>
        <Tile icon={icon} tone="sky" size={44} radius={22} />
        {/* Two lines at most: long words ("reservation") shrink a little
            instead of breaking mid-word on narrow phones. */}
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={{ fontFamily: F.semibold, fontSize: 12, lineHeight: 16, color: C.ink, textAlign: 'center', alignSelf: 'stretch' }}>
          {label}
        </Text>
      </Card>
    </Press>
  );
}
