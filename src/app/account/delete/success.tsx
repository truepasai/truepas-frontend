/** @jsxImportSource react */
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { Check, FileText, ScanFace, UserRound, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { sessionEnded } from '@/features/auth/slice';
import { C } from '@/premium/theme';
import { Button, Card, Divider, Row, Txt } from '@/premium/ui';
import { ResultView } from '@/premium/views';
import { clearAllDocumentImages } from '@/services/documentImageStore';
import { flowGuards } from '@/services/flowGuards';
import { clearAllProfileImages } from '@/services/profileImageStore';
import { useAppDispatch } from '@/store';

/**
 * What a successful DELETE /user/me did, in plain words — and no more than
 * the backend promises: it removes face and document data for the account
 * and its family members, then closes the account and revokes every session
 * (CUSTOMER_APP_FRONTEND_INTEGRATION.md "Delete account"). Check-in history
 * isn't listed because the contract doesn't say it's erased.
 */
const REMOVED: { icon: LucideIcon; label: string; detail: string }[] = [
  { icon: UserRound, label: 'Your account', detail: 'You can no longer sign in with it' },
  { icon: ScanFace, label: 'Face data', detail: "Yours and your family's" },
  { icon: FileText, label: 'Documents', detail: "Yours and your family's, with their photos" },
];

/** Delete account — success. Reached straight from the confirm screen once
 *  DELETE /user/me succeeded (only that grants the flag). */
export default function DeleteSuccessScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Reaching this screen directly must not wipe the session — the flag only
  // exists after DELETE /user/me returned success.
  const [allowed] = useState(() => flowGuards.has('account:deleted'));

  // End the session as soon as the deletion is confirmed — the backend has
  // already revoked tokens, so keeping Redux/query state alive until the
  // button tap would let the user back into authenticated screens.
  useEffect(() => {
    if (!allowed) return;
    flowGuards.consume('account:deleted');
    queryClient.clear();
    void clearAllDocumentImages();
    // Everything, un-uploaded member photos included: the account is gone.
    void clearAllProfileImages({ everything: true });
    dispatch(sessionEnded());
  }, [queryClient, dispatch, allowed]);

  if (!allowed) return <Redirect href="/" />;

  return (
    <ResultView
      close
      icon={Check}
      tone="green"
      over="All done"
      title="Your account is"
      accent="deleted."
      sub="You've been signed out on all your devices."
      primary={
        <Button
          label="Back to sign in"
          // Session already ended on mount — just navigate out; the entry
          // gate won't re-render so go to login explicitly.
          onPress={() => router.dismissTo('/(auth)/login' as never)}
        />
      }>
      <View style={{ gap: 10 }}>
        <Txt v="micro" style={{ marginLeft: 4 }}>
          What we deleted
        </Txt>
        <Card pad={0} style={{ paddingHorizontal: 18 }}>
          {REMOVED.map((item, i) => (
            <View key={item.label}>
              {i > 0 && <Divider />}
              <Row gap={12} style={{ paddingVertical: 14 }}>
                <item.icon size={18} color={C.skyPressed} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="bodyStrong">{item.label}</Txt>
                  <Txt v="small">{item.detail}</Txt>
                </View>
                <Check size={16} color={C.green} strokeWidth={3} />
              </Row>
            </View>
          ))}
        </Card>
      </View>
      <Txt v="small" color={C.ink4} center>
        Changed your mind? You can create a new TruePas account anytime.
      </Txt>
    </ResultView>
  );
}
