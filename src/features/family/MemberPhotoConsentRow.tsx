/** @jsxImportSource react */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react-native';
import { useState } from 'react';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { familyKeys } from '@/features/family/hooks';
import { consentIsActive } from '@/features/family/photoConsent';
import { formatDate } from '@/premium/flows/family';
import { ConfirmSheet } from '@/premium/kit';
import { ListRow } from '@/premium/ui';

/** An under-5 member's photo-enrolment consent on their page: when it was
 *  given, and withdrawing it. The server keeps the consent record, turns the
 *  child's face off and removes it and the enrolment photos. */
export function MemberPhotoConsentRow({ personId, first }: { personId: string; first: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = ['family', personId, 'photo-consent'];
  const status = useQuery({ queryKey, queryFn: () => api.getMemberPhotoConsent(personId) });
  const [confirm, setConfirm] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => api.withdrawMemberPhotoConsent(personId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: familyKeys.detail(personId) });
      setConfirm(false);
      toast({ variant: 'success', title: 'Consent withdrawn', description: `${first}'s enrolment photo and face record were removed.` });
    },
    onError: (err) => toast({ variant: 'warning', title: "Couldn't withdraw consent", description: toApiError(err).message }),
  });

  const active = consentIsActive(status.data);
  const acceptedAt = active ? status.data?.acceptedAt : null;
  return (
    <>
      <ListRow
        icon={active ? ShieldCheck : ShieldOff}
        tone="sky"
        title="Photo consent"
        sub={
          status.isLoading
            ? 'Checking…'
            : active
              ? `Given${acceptedAt ? ` ${formatDate(acceptedAt)}` : ''} · tap to withdraw`
              : 'Not given'
        }
        chevron={active}
        onPress={active ? () => setConfirm(true) : undefined}
      />
      <ConfirmSheet
        visible={confirm}
        danger
        icon={ShieldOff}
        title="Withdraw photo consent?"
        body={`${first}'s enrolment photo and face record are removed, and ${first} can't be identified by photo until you consent again. A profile picture you chose stays until you change it.`}
        confirmLabel="Withdraw consent"
        loading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
