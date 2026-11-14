/** @jsxImportSource react */
/**
 * Guardian verification for one child — GET/POST /cb/family/{id}/guardian-verification.
 * Shows where the parent's evidence stands and, when the server allows it,
 * lets them submit a photo of the document. The server checks the file,
 * stores it privately and a TruePas reviewer decides: this screen never
 * marks anything verified.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { Camera, Image as ImageIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { useToast } from '@/components/composite/Toast';
import { RadioGroup } from '@/components/ui/RadioGroup';
import {
  GUARDIAN_EVIDENCE_PRIVACY,
  canSubmitEvidence,
  evidenceTooLarge,
  evidenceTypeLabel,
  evidenceTypeOptions,
  guardianStatusBody,
  guardianStatusLabel,
  guardianStatusOf,
  guardianStatusTone,
} from '@/features/family/guardianVerification';
import { guardianVerificationKey } from '@/features/family/MemberGuardianVerificationRow';
import { formatDate } from '@/premium/flows/family';
import { Banner, LoadingView } from '@/premium/kit';
import { Badge, Button, Card, Heading, Screen, TopBar, Txt } from '@/premium/ui';

type Picked = { data: string; contentType: string };

export default function GuardianVerificationScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const first = (name || 'your child').trim().split(' ')[0];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = guardianVerificationKey(id);
  const status = useQuery({ queryKey, queryFn: () => api.getGuardianVerification(id) });
  const [evidenceType, setEvidenceType] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api.submitGuardianVerification(id, { evidenceType: evidenceType!, contentType: picked!.contentType, data: picked!.data }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setPicked(null);
      toast({ variant: 'success', title: 'Evidence submitted', description: 'A TruePas reviewer will check it.' });
    },
  });

  const view = status.data;
  const current = guardianStatusOf(view);

  const pick = async (source: 'camera' | 'library') => {
    setPickError(null);
    if (source === 'camera') {
      const { status: permission } = await ImagePicker.requestCameraPermissionsAsync();
      if (permission !== 'granted') {
        setPickError('Camera access is off. Choose a photo from your gallery instead.');
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, base64: true };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const contentType = asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    if (view && evidenceTooLarge(asset.base64, view.maxBytes)) {
      setPickError('This photo is too large. Try again with a smaller photo.');
      return;
    }
    setPicked({ data: asset.base64, contentType });
  };

  const header = <TopBar title="Guardian verification" />;
  if (status.isLoading) {
    return (
      <Screen header={header}>
        <LoadingView full />
      </Screen>
    );
  }
  if (status.isError || !view) {
    return (
      <Screen header={header}>
        <Banner tone="error" title="Couldn't load guardian verification" body={toApiError(status.error).message} />
        <Button label="Try again" onPress={() => status.refetch()} />
      </Screen>
    );
  }

  const open = canSubmitEvidence(view);
  return (
    <Screen
      header={header}
      footer={
        open ? (
          <Button
            label={submit.isPending ? 'Submitting…' : 'Submit for review'}
            disabled={!evidenceType || !picked || submit.isPending}
            loading={submit.isPending}
            onPress={() => submit.mutate()}
          />
        ) : undefined
      }
    >
      <Heading title={`${first}'s guardian verification`} sub={guardianStatusBody(current, first)} />
      <Card>
        <View style={{ gap: 8 }}>
          <Badge label={guardianStatusLabel(current)} tone={guardianStatusTone(current)} />
          {view.evidenceType ? <Txt>{evidenceTypeLabel(view.evidenceType)}</Txt> : null}
          {view.submittedAt ? <Txt v="small">Submitted {formatDate(view.submittedAt)}</Txt> : null}
          {view.reviewedAt ? <Txt v="small">Reviewed {formatDate(view.reviewedAt)}</Txt> : null}
        </View>
      </Card>
      {current === 'rejected' && view.rejectionReason ? (
        <Banner tone="error" title="Reviewer's reason" body={view.rejectionReason} />
      ) : null}
      {current === 'information_required' && view.informationRequest ? (
        <Banner tone="warning" title="The reviewer asks" body={view.informationRequest} />
      ) : null}
      {!view.submissionEnabled && current === 'not_submitted' ? (
        <Banner tone="info" title="Not available yet" body="Guardian verification isn't open yet. You don't need to do anything now." />
      ) : null}

      {open ? (
        <>
          <Card>
            <View style={{ gap: 12 }}>
              <Txt v="smallStrong">Which document?</Txt>
              <RadioGroup
                accessibilityLabel="Kind of document"
                options={evidenceTypeOptions(view)}
                value={evidenceType}
                onValueChange={setEvidenceType}
              />
            </View>
          </Card>
          <Card>
            <View style={{ gap: 12 }}>
              <Txt v="smallStrong">A clear photo of the whole document</Txt>
              <Txt v="small">{picked ? 'Photo ready to submit.' : 'Make sure every word can be read.'}</Txt>
              <Button label="Take photo" tone="soft" icon={Camera} onPress={() => void pick('camera')} />
              <Button label="Choose from gallery" tone="soft" icon={ImageIcon} onPress={() => void pick('library')} />
              {pickError ? <Txt v="small">{pickError}</Txt> : null}
            </View>
          </Card>
          <Txt v="small">{GUARDIAN_EVIDENCE_PRIVACY}</Txt>
          {submit.isError ? <Banner tone="error" title="Not submitted" body={toApiError(submit.error).message} /> : null}
        </>
      ) : null}
    </Screen>
  );
}
