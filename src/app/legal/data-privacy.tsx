/** @jsxImportSource react */
/**
 * Data & privacy — retention info, deletion rights, consent management (PRD).
 * Face-template status and the consent date come from the signed-in user
 * record. "Download my data" is hidden until the backend export worker runs
 * on every environment; the /account/export screen stays for then.
 * Usage-analytics sharing does nothing in the app yet → Coming soon.
 */
import { BarChart3, FileText, Fingerprint, Lock, ScanFace, Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import { SoonRow } from '@/premium/flows/account';
import { Badge, Card, Divider, go, Group, Heading, ListRow, Row, Screen, Tile, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';

const RETENTION = [
  { label: 'Account data', policy: 'Retained while account is active' },
  { label: 'Document images', policy: 'Secure encrypted storage, deleted with account' },
  { label: 'Face template', policy: 'Dedicated encrypted storage, deleted with account' },
];

/** Server timestamp → "29 Jul 2026" in the user's locale; raw value if unparseable. */
function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DataPrivacyScreen() {
  const user = useAppSelector((state) => state.auth.user);
  const enrolled = !!user?.faceEnrolled;
  const consentAt = user?.biometricConsentAt ?? null;

  return (
    <Screen header={<TopBar title="Data & privacy" />} contentStyle={{ paddingTop: 4 }}>
      <Heading title="Your" accent="data." sub="What we keep, for how long, and the controls to manage it." />

      <Group title="Your data">
        <ListRow
          icon={Trash2}
          danger
          title="Delete account"
          sub="Permanently remove all data"
          onPress={go('/account/delete')}
        />
      </Group>

      <View style={{ gap: 10 }}>
        <Txt v="micro" style={{ marginLeft: 4 }}>
          Biometric data
        </Txt>
        <Card style={{ gap: 12 }}>
          <Row gap={14}>
            <Tile icon={ScanFace} tone="sky" size={40} />
            <Txt v="bodyStrong" style={{ flex: 1 }}>
              Face template
            </Txt>
            {enrolled ? <Badge label="Enrolled" tone="green" dot /> : <Badge label="Not enrolled" tone="neutral" />}
          </Row>
          <Txt v="small" style={{ lineHeight: 19 }}>
            Your encrypted face template is stored in dedicated secure storage. It will be deleted permanently when
            you delete your account.
          </Txt>
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Txt v="micro" style={{ marginLeft: 4 }}>
          Retention policy
        </Txt>
        <Card pad={0} style={{ paddingHorizontal: 18 }}>
          {RETENTION.map((item, i) => (
            <View key={item.label}>
              {i > 0 && <Divider />}
              <Row between gap={12} style={{ paddingVertical: 14 }}>
                <Txt v="small">{item.label}</Txt>
                <Txt v="smallStrong" style={{ flexShrink: 1, textAlign: 'right' }}>
                  {item.policy}
                </Txt>
              </Row>
            </View>
          ))}
        </Card>
      </View>

      <Group title="Consent">
        <ListRow
          icon={Fingerprint}
          tone="sky"
          title="Biometric consent"
          sub={consentAt ? `Granted · ${formatTimestamp(consentAt)}` : 'Not granted'}
          onPress={go('/security')}
        />
        <SoonRow icon={BarChart3} tone="sky" title="Share usage analytics" sub="Help improve TruePas" />
      </Group>

      <Group title="Policies">
        <ListRow icon={Lock} title="Privacy Policy" onPress={go('/legal/privacy-policy')} />
        <ListRow icon={FileText} title="Terms of Service" onPress={go('/legal/terms')} />
      </Group>
    </Screen>
  );
}
