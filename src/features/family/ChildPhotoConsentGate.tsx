/** @jsxImportSource react */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { CheckboxRow } from '@/components/app/CheckboxRow';
import {
  CHILD_PHOTO_CONSENT_NOTICE_VERSION,
  CHILD_PHOTO_CONSENT_TEXT,
  childPhotoConsentNotice,
  consentIsActive,
} from '@/features/family/photoConsent';
import { Banner, LoadingView } from '@/premium/kit';
import { Button, Card, Heading, Screen, TopBar, Txt } from '@/premium/ui';

/** The parent's consent, before an under-5 child's photo enrolment: the notice
 *  and one unticked box. Only once the server has recorded it (for the
 *  child's recorded guardian, against its current notice) does the camera
 *  screen open. The server also refuses the photo without it, so this screen
 *  is the experience, never the authorization. */
export function ChildPhotoConsentGate({ personId, name, children }: { personId: string; name?: string; children: ReactNode }) {
  const first = (name || 'your child').trim().split(' ')[0];
  const queryClient = useQueryClient();
  const queryKey = ['family', personId, 'photo-consent'];
  const status = useQuery({ queryKey, queryFn: () => api.getMemberPhotoConsent(personId) });
  const [ticked, setTicked] = useState(false);
  const give = useMutation({
    mutationFn: () => api.giveMemberPhotoConsent(personId, CHILD_PHOTO_CONSENT_NOTICE_VERSION),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  if (consentIsActive(status.data)) return <>{children}</>;

  const header = <TopBar title="Parent consent" />;
  if (status.isLoading) {
    return (
      <Screen header={header}>
        <LoadingView full />
      </Screen>
    );
  }
  if (status.isError) {
    return (
      <Screen header={header}>
        <Banner tone="error" title="Couldn't check consent" body={toApiError(status.error).message} />
        <Button label="Try again" onPress={() => status.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      footer={
        <Button
          label={give.isPending ? 'Saving…' : 'Continue'}
          disabled={!ticked || give.isPending}
          onPress={() => give.mutate()}
        />
      }
    >
      <Heading title={`Before ${first}'s photo`} sub="Please read this, then tick the box." />
      <Card>
        <View style={{ gap: 12 }}>
          {childPhotoConsentNotice(first).map((section) => (
            <View key={section.heading} style={{ gap: 4 }}>
              <Txt v="smallStrong">{section.heading}</Txt>
              <Txt>{section.body}</Txt>
            </View>
          ))}
        </View>
      </Card>
      <CheckboxRow checked={ticked} onToggle={setTicked} label={CHILD_PHOTO_CONSENT_TEXT} />
      {give.isError ? <Banner tone="error" title="Consent not saved" body={toApiError(give.error).message} /> : null}
    </Screen>
  );
}
