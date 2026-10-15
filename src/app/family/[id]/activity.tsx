/** @jsxImportSource react */
/**
 * Member activity — GET /cb/family/{personId}/activity (§7.3): that
 * member's events, newest first, normalized to { id, title, date (ISO),
 * type, tone, ref }. Server events show with an icon by `type`, `title`
 * as-is and `date` formatted locally; a document/booking `ref` opens it.
 * The member's next milestone (turning 18) and — until a check-in event
 * arrives — a "first check-in" placeholder lead the list. Only while the
 * server list is empty, events derived from real member data (face,
 * documents, joined the family) fill it in.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Cake,
  FileCheck,
  FilePlus,
  FileX,
  History,
  KeyRound,
  type LucideIcon,
  MapPin,
  ScanFace,
  UserPlus,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useDocuments } from '@/features/documents/hooks';
import { useFamilyActivity, useFamilyMember, useMemberPhoto } from '@/features/family/hooks';
import { docStyle, fmtDate } from '@/premium/flows/home';
import { Bone, ErrorView } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Avatar, Badge, type BadgeTone, Card, Heading, Row, Screen, Tile, TopBar, Txt } from '@/premium/ui';
import type { ActivityLogItem, ActivityType, FamilyMember, IdentityDocument } from '@/types/domain';

/** ISO date → local "Oct 5, 2026, 9:41 AM" (date only when there's no time). */
function when(date: string): string {
  const d = new Date(date);
  if (!date || Number.isNaN(d.getTime())) return date;
  return /T\d{2}:\d{2}/.test(date)
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

type TileTone = 'sky' | 'navy' | 'green' | 'amber' | 'red' | 'neutral';

const EVENT_STYLE: Record<ActivityType, { icon: LucideIcon; tone: TileTone }> = {
  face_enrolled: { icon: ScanFace, tone: 'green' },
  family_face_enrolled: { icon: ScanFace, tone: 'green' },
  document_added: { icon: FilePlus, tone: 'sky' },
  document_verified: { icon: FileCheck, tone: 'green' },
  document_failed: { icon: FileX, tone: 'amber' },
  family_member_added: { icon: UserPlus, tone: 'sky' },
  check_in: { icon: MapPin, tone: 'navy' },
  password_changed: { icon: KeyRound, tone: 'neutral' },
  pin_changed: { icon: KeyRound, tone: 'neutral' },
};

/** Server tone wins when it signals something (success/warning/error). */
const TONE_TILE: Partial<Record<NonNullable<ActivityLogItem['tone']>, TileTone>> = {
  success: 'green',
  warning: 'amber',
  error: 'red',
};

function eventStyle(e: ActivityLogItem): { icon: LucideIcon; tone: TileTone } {
  const base = (e.type && EVENT_STYLE[e.type]) || { icon: History, tone: 'sky' as TileTone };
  return { icon: base.icon, tone: (e.tone && TONE_TILE[e.tone]) || base.tone };
}

type Entry = {
  id: string;
  icon: LucideIcon;
  tone: TileTone;
  title: string;
  sub: string;
  badge?: { label: string; tone: BadgeTone };
  onPress?: () => void;
};

/** 18th birthday as ISO when it is still ahead, else null. */
function eighteenth(m: FamilyMember): string | null {
  if (!m.dateOfBirth || m.age >= 18) return null;
  const d = new Date(m.dateOfBirth);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 18);
  return d.getTime() > Date.now() ? d.toISOString() : null;
}

const DOC_VERB: Partial<Record<IdentityDocument['status'], { verb: string; tone: TileTone }>> = {
  verified: { verb: 'verified', tone: 'green' },
  pending: { verb: 'added', tone: 'sky' },
  failed: { verb: 'check failed', tone: 'amber' },
};

function buildTimeline(
  m: FamilyMember | undefined,
  first: string,
  events: ActivityLogItem[],
  docs: IdentityDocument[],
  openMember: () => void,
  openRef: (e: ActivityLogItem) => (() => void) | undefined,
): Entry[] {
  const out: Entry[] = [];
  if (!events.some((e) => e.type === 'check_in')) {
    out.push({
      id: 'first-checkin',
      icon: MapPin,
      tone: 'neutral',
      title: `${first}'s first check-in`,
      sub: 'Shows up here after their first visit',
      badge: { label: 'Waiting', tone: 'neutral' },
    });
  }
  const adult = m ? eighteenth(m) : null;
  if (adult) {
    out.push({ id: 'turns-18', icon: Cake, tone: 'sky', title: `Turns 18 on ${fmtDate(adult)}`, sub: 'Upcoming milestone' });
  }
  if (events.length > 0) {
    events.forEach((e) => {
      const style = eventStyle(e);
      out.push({ id: e.id, icon: style.icon, tone: style.tone, title: e.title, sub: when(e.date), onPress: openRef(e) });
    });
    return out;
  }
  if (!m) return out;
  const faceDone = m.faceEnrolled || m.verification === 'verified';
  out.push(
    faceDone
      ? { id: 'face', icon: ScanFace, tone: 'green', title: 'Face enrolled', sub: 'Checks in with their own face' }
      : {
          id: 'face',
          icon: ScanFace,
          tone: 'amber',
          title: 'Face scan pending',
          sub: 'Needed to check in at venues',
          badge: { label: 'Scan now', tone: 'amber' },
          onPress: openMember,
        },
  );
  [...docs]
    .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .forEach((d) => {
      const v = DOC_VERB[d.status];
      if (!v) return;
      out.push({
        id: `doc-${d.id}`,
        icon: FileCheck,
        tone: v.tone,
        title: `${docStyle(d.type).title} ${v.verb}`,
        sub: d.addedAt ? fmtDate(d.addedAt) : d.label,
      });
    });
  out.push({ id: 'joined', icon: UserPlus, tone: 'sky', title: 'Added to your family', sub: `${m.relationship} · ${m.age} yrs` });
  return out;
}

function TimelineSkeleton() {
  return (
    <View style={{ gap: 14 }}>
      {[0, 1, 2].map((i) => (
        <Row key={i} gap={14} align="flex-start">
          <Bone w={44} h={44} r={22} />
          <Card style={{ flex: 1, gap: 8 }} pad={16}>
            <Bone w="70%" />
            <Bone w="40%" h={11} />
          </Card>
        </Row>
      ))}
    </View>
  );
}

export default function FamilyMemberActivityScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { data: member } = useFamilyMember(id);
  const photoUri = useMemberPhoto(id, member?.profileImageUrl);
  const memberDocs = useDocuments(id);
  const activity = useFamilyActivity(id);
  const { data: events, isPending, isError, refetch } = activity;

  const fullName = name ?? member?.name;
  const first = (fullName ?? 'Member').split(' ')[0];
  // A document / booking event opens it (ref, §10.1).
  const openRef = (e: ActivityLogItem) => {
    const docId = e.ref?.documentId;
    const bookingId = e.ref?.bookingId;
    if (docId) return () => router.push(`/document/${docId}` as never);
    if (bookingId) return () => router.push(`/booking/${bookingId}` as never);
    return undefined;
  };
  const timeline = buildTimeline(member ?? undefined, first, events ?? [], memberDocs.data ?? [], () => router.back(), openRef);

  return (
    <Screen
      header={<TopBar title="Activity" right={fullName ? <Avatar uri={photoUri} name={fullName} size={36} /> : undefined} />}
      contentStyle={{ paddingTop: 4, flexGrow: 1 }}
      refreshing={activity.isRefetching || memberDocs.isRefetching}
      onRefresh={() => {
        void refetch();
        void memberDocs.refetch();
      }}>
      <Heading title={`${first}'s`} accent="activity." sub="Check-ins, verification and milestones." />
      {isError ? (
        <ErrorView
          title="Couldn't load activity"
          body="Please check your connection and try again."
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <TimelineSkeleton />
      ) : (
        <View>
          {timeline.map((e, i) => (
            <Row key={e.id} gap={14} align="flex-start">
              <View style={{ alignItems: 'center', width: 44, alignSelf: 'stretch' }}>
                {e.id === 'first-checkin' ? (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: C.ink4,
                      backgroundColor: C.canvas,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <MapPin size={18} color={C.ink3} />
                  </View>
                ) : (
                  <Tile icon={e.icon} tone={e.tone} size={44} radius={22} />
                )}
                {i < timeline.length - 1 && (
                  <View style={{ width: 2, flex: 1, minHeight: 24, backgroundColor: C.line, marginVertical: 6 }} />
                )}
              </View>
              <TimelineCard e={e} />
            </Row>
          ))}
        </View>
      )}
    </Screen>
  );
}

function TimelineCard({ e }: { e: Entry }) {
  const body = (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} pad={16}>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt v="bodyStrong">{e.title}</Txt>
        <Txt v="small" color={C.ink4}>
          {e.sub}
        </Txt>
      </View>
      {e.badge && <Badge label={e.badge.label} tone={e.badge.tone} />}
    </Card>
  );
  return (
    <View style={{ flex: 1, marginBottom: 14 }}>
      {e.onPress ? (
        <Pressable onPress={e.onPress} accessibilityRole="button" accessibilityLabel={`${e.title}. ${e.sub}`}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}
