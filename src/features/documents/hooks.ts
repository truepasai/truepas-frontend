import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import { accountKeys } from '@/features/account/hooks';
import { clearDocumentImages } from '@/services/documentImageStore';
import type { AddDocumentRequest, DocumentType, SupportedDocumentType } from '@/types/domain';

export const documentKeys = {
  all: ['documents'] as const,
  supportedTypes: ['document-types', 'supported'] as const,
  images: (id: string) => ['document-images', id] as const,
  detail: (id: string) => ['documents', id] as const,
  member: (personId: string) => ['documents', 'member', personId] as const,
};

export function useDocuments(personId?: string) {
  return useQuery({
    queryKey: personId ? documentKeys.member(personId) : documentKeys.all,
    queryFn: () => api.getDocuments(personId),
    // A failed verification isn't a document the user has — never show one.
    // New rejections are deleted (document/processing); this hides older
    // ones still on the server. The cache keeps them for that cleanup.
    select: (docs) => docs?.filter((d) => d.status !== 'failed'),
    // Always refetch when the screen mounts — ensures newly added documents
    // show up even if cache invalidation timing is off.
    refetchOnMount: true,
  });
}

/** GET /documents/{id}. A 4xx is final — 404 = removed (e.g. replaced by a
 *  newer verified one of the same type) — so it isn't retried. */
export function useDocument(id?: string) {
  return useQuery({
    queryKey: documentKeys.detail(id ?? ''),
    queryFn: () => api.getDocument(id!),
    enabled: !!id,
    retry: (failureCount, error) => {
      const status = toApiError(error).status;
      return !(status != null && status >= 400 && status < 500) && failureCount < 2;
    },
  });
}

export function useAddDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AddDocumentRequest) => api.addDocument(payload),
    onSuccess: (data, variables) => {
      // Invalidate all document queries (covers both self and member lists)
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      // Per KYC guide §7: identity summary must be invalidated after
      // document changes so gating reflects the new document state.
      queryClient.invalidateQueries({ queryKey: ['identity'] });
      // Also explicitly invalidate the member-specific query if personId was set
      if (variables.personId) {
        queryClient.invalidateQueries({ queryKey: documentKeys.member(variables.personId) });
      }
    },
  });
}

export function useRemoveDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeDocument(id),
    onSuccess: (_data, id) => {
      // The scan kept on this phone (unencrypted, documentImageStore) goes
      // with the document. Best effort — never fails the removal.
      clearDocumentImages(id).catch(() => {});
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      // Identity summary derives document state — same invalidation as add.
      queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
  });
}

/** GET /documents/types/supported — the picker's source of truth (§6.1). */
export function useSupportedDocumentTypes() {
  return useQuery({
    queryKey: documentKeys.supportedTypes,
    queryFn: () => api.getSupportedDocumentTypes(),
    staleTime: 60 * 60_000,
  });
}

/** Types allowed for a person of this age (undefined age = adult). */
export function allowedDocumentTypes(types: SupportedDocumentType[], age?: number): SupportedDocumentType[] {
  const a = age ?? 18;
  return types.filter(
    (t) =>
      (a < 18 ? t.allowedForMinors : t.allowedForAdults) &&
      (t.minAge == null || a >= t.minAge) &&
      (t.maxAge == null || a <= t.maxAge),
  );
}

/** Picker order used when GET /documents/types/supported fails. */
export const FALLBACK_DOCUMENT_TYPES: DocumentType[] = ['passport', 'drivingLicense', 'idCard', 'greenCard', 'birthCertificate', 'usVisa'];

export interface DocumentTypeOption {
  type: DocumentType;
  /** Server label — absent on the fallback list. */
  label?: string;
}

/**
 * The types a person can add: supported types filtered by age (§6.1), or the
 * hard-coded list when the request fails. `age`: undefined = adult,
 * null = unknown (no age filter). `options` is undefined while loading.
 */
export function useDocumentTypeOptions(age?: number | null) {
  const q = useSupportedDocumentTypes();
  const options = useMemo<DocumentTypeOption[] | undefined>(() => {
    if (q.data) {
      const list = age === null ? q.data : allowedDocumentTypes(q.data, age);
      return list.map((t) => ({ type: t.type, label: t.label }));
    }
    if (q.isError) return FALLBACK_DOCUMENT_TYPES.map((type) => ({ type }));
    return undefined;
  }, [q.data, q.isError, age]);
  return { options, isPending: options === undefined, isFallback: !q.data && q.isError };
}

/** After a verify: refetch documents (the server drops older verified docs of
 *  the same type on approval, §6.5), identity, score, activity and images. */
export function refreshAfterVerify(queryClient: QueryClient, documentId?: string) {
  queryClient.invalidateQueries({ queryKey: documentKeys.all });
  queryClient.invalidateQueries({ queryKey: ['identity'] });
  queryClient.invalidateQueries({ queryKey: accountKeys.securityScore });
  queryClient.invalidateQueries({ queryKey: accountKeys.activity });
  if (documentId) queryClient.invalidateQueries({ queryKey: documentKeys.images(documentId) });
}

/** Signed, expiring image URLs — staleTime stays short so they're refetched
 *  rather than reused after they expire. */
export function useDocumentImages(id?: string) {
  return useQuery({
    queryKey: documentKeys.images(id ?? ''),
    queryFn: () => api.getDocumentImages(id as string),
    enabled: !!id,
    staleTime: 60_000,
  });
}
