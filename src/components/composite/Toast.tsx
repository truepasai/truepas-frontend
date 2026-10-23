import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react-native";
import { makeStyles, useThemeTokens } from "../../theme";
import { iconSize } from "../../theme/tokens";

export type ToastVariant = "default" | "info" | "success" | "warning" | "error";

export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** ms; default 4000 */
  duration?: number;
  /** One inline button, e.g. "Open Settings" after a denied permission. */
  action?: { label: string; onPress: () => void };
}

interface ToastContextValue {
  toast: (t: ToastOptions) => void;
}
const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = { default: Info, info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert } as const;

interface ActiveToast extends Required<Pick<ToastOptions, "title">> {
  id: number;
  variant: ToastVariant;
  description?: string;
  duration: number;
  action?: ToastOptions["action"];
}

/** Mount once near the app root; call useToast().toast({...}) anywhere inside. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const [items, setItems] = useState<ActiveToast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((t: ToastOptions) => {
    const id = ++nextId.current;
    const variant = t.variant ?? "default";
    setItems((items) => {
      // Repeated taps on a failing action must not stack identical toasts.
      if (items.some((i) => i.variant === variant && i.title === t.title && i.description === t.description)) {
        return items;
      }
      return [
        ...items.slice(-2), // keep at most 3 visible
        { id, variant, title: t.title, description: t.description, duration: t.duration ?? 4000, action: t.action },
      ];
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((items) => items.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <View style={styles.viewport} pointerEvents="box-none">
        {items.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ActiveToast; onDismiss: () => void }) {
  const styles = useStyles();
  const theme = useThemeTokens();
  const translateY = useRef(new Animated.Value(-16)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: theme.duration.normal, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: theme.duration.normal, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: theme.duration.fast, useNativeDriver: true }).start(onDismiss);
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss, opacity, translateY, theme.duration]);

  const IconComponent = ICONS[toast.variant];
  const iconColor = {
    default: theme.colors.textMuted,
    info: theme.colors.info,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
  }[toast.variant];

  return (
    <Animated.View
      style={[styles.toast, { transform: [{ translateY }], opacity }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <IconComponent size={iconSize.md} color={iconColor} style={styles.icon} />
      <View style={styles.body}>
        <Text style={styles.title}>{toast.title}</Text>
        {toast.description ? <Text style={styles.description}>{toast.description}</Text> : null}
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}
            hitSlop={8}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
        <X size={iconSize.sm} color={theme.colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const useStyles = makeStyles((t) => ({
  viewport: {
    position: "absolute",
    top: t.spacing[12],
    left: t.spacing[4],
    right: t.spacing[4],
    zIndex: t.zIndex.toast,
    gap: t.spacing[2],
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing[3],
    padding: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: t.sizes.fieldBorderWidth,
    borderColor: t.colors.borderSubtle,
    borderRadius: t.radii.lg,
    ...t.shadows.lg,
  },
  icon: { marginTop: 1 },
  body: { flex: 1 },
  title: { fontSize: t.fontSize.base, fontWeight: t.fontWeight.medium, color: t.colors.textPrimary },
  description: { fontSize: t.fontSize.sm, color: t.colors.textSecondary, marginTop: t.spacing[0.5] },
  action: { alignSelf: "flex-start", marginTop: t.spacing[2] },
  actionLabel: { fontSize: t.fontSize.sm, fontWeight: t.fontWeight.semibold, color: t.colors.actionPrimary },
}));
