/** @jsxImportSource react */
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { AtSign, Camera, Lock, MapPin, Phone, User } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { toApiError } from '@/api/errors';
import { addressLines, useAddress } from '@/features/address/hooks';
import { useUpdateProfile } from '@/features/auth/mutations';
import { useProfilePicture, useUploadProfilePicture } from '@/features/profile/hooks';
import { useToast } from '@/hooks/useToast';
import { DateField } from '@/premium/flows/account';
import { C } from '@/premium/theme';
import { Avatar, Button, Card, Field, go, ListRow, Row, Screen, TextLink, TopBar, Txt } from '@/premium/ui';
import { useAppSelector } from '@/store';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Edit profile — PUT /user/me { fullName, dateOfBirth }. The address row
 * opens /profile/address (its own endpoint, Smarty check and PIN).
 * Email & phone are server-locked (409 until re-verification), so they render
 * read-only with a lock affordance. (The mockup locked the name and opened
 * contact fields — the API contract wins.)
 *
 * Change photo → expo-image-picker → useUploadProfilePicture (persons API
 * upload, with a copy kept on this device as the fallback).
 */
export default function EditProfileScreen() {
  const router = useRouter();
  const toast = useToast();
  const user = useAppSelector((state) => state.auth.user);
  const updateProfile = useUpdateProfile();
  const { url: profilePictureUrl } = useProfilePicture();
  const { mutateAsync: uploadProfilePicture, isPending: isUploading } = useUploadProfilePicture();

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  // Registration stores DOB as MM/DD/YYYY while the picker speaks ISO —
  // normalize on the way in so an existing value renders instead of "Invalid Date".
  const [dateOfBirth, setDateOfBirth] = useState(() => {
    const raw = user?.dateOfBirth ?? '';
    return /^\d{2}\/\d{2}\/\d{4}$/.test(raw)
      ? `${raw.slice(6)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}`
      : raw;
  });
  // The address has its own endpoint, PIN and screen (/profile/address).
  const savedAddress = useAddress();

  const canSave = !!fullName.trim();

  const handleSave = async () => {
    if (!canSave || updateProfile.isPending) return;
    try {
      await updateProfile.mutateAsync({
        fullName: fullName.trim(),
        dateOfBirth: dateOfBirth || undefined,
      });
      toast.show('success', 'Profile updated');
      router.back();
    } catch (err: any) {
      const apiErr = toApiError(err);
      // A 409 here means a locked field (email/phone) was rejected — the shared
      // mapper's fallback ("account already exists") is written for register.
      toast.show(
        'error',
        apiErr.code === 'CONFLICT'
          ? 'Email and phone are locked to your account — contact support to change them.'
          : apiErr.message || 'Could not save changes. Please try again.',
      );
    }
  };

  const handlePickPhoto = async () => {
    if (isUploading) return;
    try {
      // No permission request: both platforms open a system picker that runs
      // outside the app, so it needs no library access. Asking anyway blocked
      // users who had once tapped "Don't Allow" — iOS never asks again.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        const saved = await uploadProfilePicture(result.assets[0].uri);
        if (saved.localOnly) toast.show('info', "Couldn't upload your photo. It shows on this phone only for now.");
        else toast.show('success', 'Profile picture updated');
      }
    } catch {
      toast.show('error', 'Failed to update profile picture. Please try again.');
    }
  };

  const lock = <Lock size={16} color={C.ink4} />;

  return (
    <Screen
      keyboard
      header={
        <TopBar
          title="Edit profile"
          right={canSave && !updateProfile.isPending ? <TextLink label="Save" onPress={() => void handleSave()} /> : undefined}
        />
      }
      contentStyle={{ paddingTop: 8 }}
      footer={
        <Button
          label="Save changes"
          loading={updateProfile.isPending}
          disabled={!canSave}
          onPress={() => void handleSave()}
        />
      }>
      <View style={{ alignItems: 'center', gap: 10 }}>
        <Pressable
          onPress={() => void handlePickPhoto()}
          disabled={isUploading}
          accessibilityRole="button"
          accessibilityLabel="Change profile picture">
          <View>
            <Avatar uri={profilePictureUrl} name={fullName || user?.fullName} size={100} ring />
            {isUploading && (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 50,
                  backgroundColor: 'rgba(1,27,39,0.45)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <ActivityIndicator size="small" color={C.white} />
              </View>
            )}
            <View
              style={{
                position: 'absolute',
                right: 0,
                bottom: 2,
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: C.ink,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: C.canvas,
              }}>
              <Camera size={15} color={C.white} />
            </View>
          </View>
        </Pressable>
        <TextLink label={isUploading ? 'Uploading…' : 'Change photo'} onPress={() => void handlePickPhoto()} />
      </View>

      <View style={{ gap: 18 }}>
        <Field
          label="Full name"
          icon={User}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          inputProps={{ autoCapitalize: 'words', maxLength: 100, autoComplete: 'name' }}
        />
        <DateField
          label="Date of birth"
          value={dateOfBirth}
          onChange={setDateOfBirth}
          placeholder="Date of birth"
          maxDate={todayIso()}
        />
        <View style={{ gap: 8 }}>
          <Txt v="smallStrong" color={C.ink2}>
            Address
          </Txt>
          <Card pad={0} style={{ paddingHorizontal: 16 }}>
            <ListRow
              icon={MapPin}
              tone="sky"
              title={savedAddress.data ? addressLines(savedAddress.data)[0] : 'Add your address'}
              sub={
                savedAddress.data
                  ? addressLines(savedAddress.data)[1]
                  : savedAddress.isPending
                    ? 'Loading…'
                    : 'Verified with the postal service for US addresses'
              }
              onPress={go('/profile/address')}
            />
          </Card>
        </View>
        <Field label="Email" icon={AtSign} value={user?.email ?? ''} editable={false} right={lock} />
        <Field label="Phone" icon={Phone} value={user?.phone ?? ''} editable={false} right={lock} />
      </View>

      <Row gap={8} style={{ justifyContent: 'center' }}>
        <Lock size={13} color={C.ink4} />
        <Txt v="small" color={C.ink4}>
          Contact support to change your email or phone.
        </Txt>
      </Row>
    </Screen>
  );
}
