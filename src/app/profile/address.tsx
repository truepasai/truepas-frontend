import { useRouter } from 'expo-router';
import { MapPin, Pencil, Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { toApiError, waitText } from '@/api/errors';
import { addressLines, useAddress } from '@/features/address/hooks';
import { Banner, EmptyView, ErrorView, LoadingView } from '@/premium/kit';
import { C } from '@/premium/theme';
import { Button, Card, Row, Screen, Tile, TopBar, Txt } from '@/premium/ui';
import { cooldownKey, useCooldown } from '@/services/cooldowns';
import { useAppSelector } from '@/store';

const COUNTRY_NAME = { US: 'United States', IN: 'India' } as const;

/**
 * Address — GET /user/me/address decides the screen: 404 → Add (POST, no
 * PIN); 200 → the saved address with Edit (PIN → PUT). Shows the server's
 * copy, which Smarty standardizes for US addresses. Edit stays disabled while
 * a 15-day change cooldown (learned from an earlier 429) is running.
 */
export default function AddressScreen() {
  const router = useRouter();
  const user = useAppSelector((state) => state.auth.user);
  const address = useAddress();
  const cooldownLeft = useCooldown(user ? cooldownKey('address-update', user.id) : null);

  const saved = address.data;
  const footer =
    address.isPending || address.isError ? undefined : saved ? (
      <Button
        label={cooldownLeft > 0 ? `Edit in ${waitText(cooldownLeft)}` : 'Edit address'}
        icon={Pencil}
        disabled={cooldownLeft > 0}
        onPress={() => router.push('/profile/address-pin')}
      />
    ) : (
      <Button
        label="Add address"
        icon={Plus}
        onPress={() => router.push({ pathname: '/profile/address-edit', params: { mode: 'create' } })}
      />
    );

  return (
    <Screen header={<TopBar title="Address" />} footer={footer} contentStyle={{ paddingTop: 8, gap: 16 }}>
      {address.isPending ? (
        <LoadingView full />
      ) : address.isError ? (
        <ErrorView body={toApiError(address.error).message} onRetry={() => void address.refetch()} />
      ) : saved ? (
        <>
          <Card>
            <Row gap={14} style={{ alignItems: 'flex-start' }}>
              <Tile icon={MapPin} tone="sky" size={44} />
              <View style={{ flex: 1, gap: 4 }}>
                {addressLines(saved).map((line) => (
                  <Txt key={line} v="bodyStrong">
                    {line}
                  </Txt>
                ))}
                <Txt v="small">{COUNTRY_NAME[saved.country] ?? saved.country}</Txt>
              </View>
            </Row>
          </Card>
          {cooldownLeft > 0 ? (
            <Banner
              tone="info"
              title="Address recently changed"
              body={`You can change your address once every 15 days. Try again in ${waitText(cooldownLeft)}.`}
            />
          ) : (
            <Txt v="small" color={C.ink3}>
              Changing your address needs your PIN. You can change it once every 15 days.
            </Txt>
          )}
        </>
      ) : (
        <EmptyView
          icon={MapPin}
          title="No address yet"
          body="Add your home address. US addresses are checked with the postal service."
        />
      )}
    </Screen>
  );
}
