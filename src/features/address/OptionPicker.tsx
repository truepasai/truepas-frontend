import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View, type TextStyle } from 'react-native';

import { Sheet } from '@/premium/flows/auth';
import { C, F, R } from '@/premium/theme';
import { Txt } from '@/premium/ui';

export interface PickerOption {
  value: string;
  label: string;
  /** Small text on the right, e.g. a state code. */
  detail?: string;
  /** Emoji shown before the label (flags). */
  leading?: string;
  /** Shown but not selectable, with this note (e.g. "Coming soon"). */
  disabledNote?: string;
}

/**
 * A Field-shaped button that opens a searchable bottom sheet of options —
 * the address form's country and state pickers. Disabled options stay in the
 * list (so people see they exist) but can't be picked.
 */
export function OptionPicker({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  sheetTitle,
  searchPlaceholder = 'Search',
  icon: Icon,
  error,
  disabled,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  sheetTitle?: string;
  searchPlaceholder?: string;
  icon?: LucideIcon;
  error?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = current ? `${current.leading ? `${current.leading}  ` : ''}${current.label}` : value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q || o.detail?.toLowerCase() === q,
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallStrong" color={C.ink2}>
        {label}
      </Txt>
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? value }}
        accessibilityState={{ disabled: !!disabled }}>
        <View
          style={{
            height: 56,
            borderRadius: R.md,
            backgroundColor: disabled ? C.sunken : C.surface,
            borderWidth: 1.5,
            borderColor: error ? C.red : C.line,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            gap: 12,
          }}>
          {Icon && <Icon size={19} color={C.ink3} strokeWidth={2} />}
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: F.semibold, fontSize: 15.5, color: shown ? C.ink : C.ink4 }}>
            {shown || placeholder}
          </Text>
          <ChevronDown size={18} color={C.ink3} strokeWidth={2.2} />
        </View>
      </Pressable>
      {error != null && (
        <Txt v="small" color={C.redInk}>
          {error}
        </Txt>
      )}

      <Sheet visible={open} onClose={close} title={sheetTitle ?? label}>
        <View
          style={{
            height: 46,
            borderRadius: R.md,
            backgroundColor: C.sunken,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            gap: 10,
          }}>
          <Search size={17} color={C.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={C.ink4}
            autoCorrect={false}
            accessibilityLabel={searchPlaceholder}
            style={{ flex: 1, fontFamily: F.semibold, fontSize: 15, color: C.ink, outlineStyle: 'none' } as unknown as TextStyle}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          style={{ flexGrow: 0, flexShrink: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Txt v="small" color={C.ink3} center style={{ paddingVertical: 20 }}>
              No matches
            </Txt>
          }
          renderItem={({ item }) => {
            const selected = item.value === value;
            const off = item.disabledNote != null;
            return (
              <Pressable
                onPress={
                  off
                    ? undefined
                    : () => {
                        onChange(item.value);
                        close();
                      }
                }
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: off }}
                accessibilityLabel={off ? `${item.label}, ${item.disabledNote}` : item.label}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 50,
                    paddingHorizontal: 12,
                    borderRadius: R.md,
                    backgroundColor: selected ? C.skyMist : 'transparent',
                    opacity: off ? 0.45 : 1,
                  }}>
                  {item.leading != null && <Text style={{ fontSize: 20, width: 28 }}>{item.leading}</Text>}
                  <Txt v="bodyStrong" style={{ flex: 1 }} lines={1}>
                    {item.label}
                  </Txt>
                  {off ? (
                    <Txt v="small" color={C.ink3}>
                      {item.disabledNote}
                    </Txt>
                  ) : item.detail != null ? (
                    <Text style={{ fontFamily: F.mono, fontSize: 13, color: selected ? C.skyPressed : C.ink3 }}>
                      {item.detail}
                    </Text>
                  ) : null}
                  {selected && <Check size={17} color={C.sky} strokeWidth={2.6} />}
                </View>
              </Pressable>
            );
          }}
        />
      </Sheet>
    </View>
  );
}
