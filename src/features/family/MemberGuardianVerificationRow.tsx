/** @jsxImportSource react */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ShieldCheck, ShieldQuestion } from 'lucide-react-native';

import { api } from '@/api';
import { guardianStatusLabel, guardianStatusOf } from '@/features/family/guardianVerification';
import { ListRow } from '@/premium/ui';

export const guardianVerificationKey = (personId: string) => ['family', personId, 'guardian-verification'];

/** A child's guardian verification status on their page; opens the evidence screen. */
export function MemberGuardianVerificationRow({ personId, first }: { personId: string; first: string }) {
  const router = useRouter();
  const status = useQuery({
    queryKey: guardianVerificationKey(personId),
    queryFn: () => api.getGuardianVerification(personId),
  });
  const current = guardianStatusOf(status.data);
  return (
    <ListRow
      icon={current === 'verified' ? ShieldCheck : ShieldQuestion}
      tone={current === 'verified' ? 'green' : 'sky'}
      title="Guardian verification"
      sub={status.isLoading ? 'Checking…' : status.isError ? "Couldn't load" : guardianStatusLabel(current)}
      onPress={() => router.push({ pathname: '/family/[id]/guardian-verification', params: { id: personId, name: first } })}
    />
  );
}
