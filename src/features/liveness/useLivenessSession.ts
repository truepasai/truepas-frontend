import { useCallback, useState } from 'react';

import { api } from '@/api';
import { toApiError } from '@/api/errors';
import {
  REGULA_MESSAGES,
  regulaRunConfig,
  serverUsesChallenge,
  type LivenessMethod,
  type RegulaOutcome,
  type RegulaRunConfig,
} from '@/features/liveness/regulaLiveness';
import type {
    LivenessChallenge,
    LivenessChallengeResponse,
    LivenessEvidenceResponse,
    LivenessFinalizeResponse,
    RegulaLivenessSession,
} from '@/types/domain';

/** `capturing` and `checking` are Regula's: the face image, then Regula liveness. */
type LivenessPhase = 'idle' | 'creating' | 'challenging' | 'capturing' | 'checking' | 'finalizing' | 'passed' | 'failed';

interface LivenessSessionState {
  phase: LivenessPhase;
  /** The check this server runs, known once a session exists. */
  method: LivenessMethod | null;
  challenge: LivenessChallengeResponse | null;
  regula: RegulaLivenessSession | null;
  currentStepIndex: number;
  currentChallenge: LivenessChallenge | null;
  instruction: string;
  error: string | null;
  result: LivenessFinalizeResponse | null;
}

/** Shown while the face image is taken, before Regula liveness. */
export const CAPTURE_INSTRUCTION = 'Look straight at the camera and hold still';

/**
 * Orchestrates the liveness flow the server runs.
 *
 * Regula (when the server's liveness service is on it):
 *   create session → capture the face image and upload it → Regula liveness
 *   on the phone → the server verifies the transaction with Regula
 * The ML Kit challenge (otherwise):
 *   create challenge → submit evidence for each step → finalize
 *
 * The server decides which: a Regula session is asked for first, and only the
 * server's own "not on Regula" answer leads to the challenge
 * (regulaLiveness.serverUsesChallenge). Either way the face image is the
 * app's capture, and the resulting session_id + session_token are used for
 * face enrollment.
 */
export function useLivenessSession() {
  const [state, setState] = useState<LivenessSessionState>(initialState);

  const startSession = useCallback(async (personId?: string) => {
    setState({ ...initialState, phase: 'creating' });
    try {
      const regula = await api.createRegulaLivenessSession(personId);
      setState({ ...initialState, phase: 'capturing', method: 'regula', regula, instruction: CAPTURE_INSTRUCTION });
      return;
    } catch (err: any) {
      const apiErr = toApiError(err);
      if (!serverUsesChallenge(apiErr)) {
        console.error('[Liveness] Regula session creation failed:', apiErr.status, apiErr.serverCode);
        setState({ ...initialState, phase: 'failed', error: apiErr.message });
        throw err;
      }
      console.log('[Liveness] Server runs the challenge, not Regula');
    }
    try {
      console.log('[Liveness] Creating challenge...', personId ? `for personId=${personId}` : '(self enrollment)');
      const challenge = await api.createLivenessChallenge(personId);
      console.log('[Liveness] Challenge created:', JSON.stringify({
        session_id: challenge.session_id,
        sequence: challenge.challenge_sequence,
        step_time_limits: challenge.step_time_limits,
      }));
      const firstChallenge = challenge.challenge_sequence[0];
      setState({
        ...initialState,
        phase: 'challenging',
        method: 'challenge',
        challenge,
        currentStepIndex: 0,
        currentChallenge: firstChallenge,
        instruction: challenge.ui_copy[firstChallenge],
      });
    } catch (err: any) {
      console.error('[Liveness] Challenge creation failed:', err?.message, JSON.stringify(err?.response?.data));
      // toApiError maps raw axios messages ("Request failed with status code
      // 429") to user-presentable copy ("Too many attempts...").
      setState({ ...initialState, phase: 'failed', error: toApiError(err).message });
      throw err;
    }
  }, []);

  const submitEvidence = useCallback(
    async (durationMs: number, clientTsMs: number): Promise<LivenessEvidenceResponse> => {
      if (!state.challenge || !state.currentChallenge) {
        throw new Error('No active liveness session');
      }

      // Per KYC guide §4.2: Evidence carries NO image — only step metadata.
      const evidence = await api.submitLivenessEvidence(
        state.challenge.session_id,
        {
          challenge: state.currentChallenge,
          step_index: state.currentStepIndex,
          client_ts_ms: clientTsMs,
          duration_ms: durationMs,
        },
        state.challenge.session_token,
      );
      console.log('[Liveness] Evidence response:', JSON.stringify(evidence));

      if (!evidence.step_accepted || evidence.status === 'failed') {
        console.error('[Liveness] Step rejected:', JSON.stringify(evidence));
        setState((prev) => ({
          ...prev,
          phase: 'failed',
          error: 'Liveness check failed. Please try again.',
        }));
        throw new Error('Liveness step rejected');
      }

      // Advance to next challenge or mark as ready to finalize
      const nextIndex = state.currentStepIndex + 1;
      const nextChallenge = evidence.next_challenge;

      if (nextChallenge && nextIndex < state.challenge.challenge_sequence.length) {
        console.log(`[Liveness] Step ${state.currentStepIndex} accepted → next: ${nextChallenge}`);
        setState((prev) => ({
          ...prev,
          currentStepIndex: nextIndex,
          currentChallenge: nextChallenge,
          instruction: evidence.next_instruction ?? prev.challenge!.ui_copy[nextChallenge],
        }));
      } else {
        // All steps done — ready to finalize
        console.log('[Liveness] All steps accepted → finalizing');
        setState((prev) => ({
          ...prev,
          phase: 'finalizing',
          currentChallenge: null,
          instruction: 'Hold still...',
        }));
      }

      return evidence;
    },
    [state],
  );

  // Finalize liveness - submit the captured frame file (file:// URI); it
  // goes straight into multipart FormData without a base64 round-trip.
  const finalize = useCallback(async (frameUri: string): Promise<LivenessFinalizeResponse> => {
    if (!state.challenge) {
      throw new Error('No active liveness session');
    }

    const result = await api.finalizeLiveness(
      state.challenge.session_id,
      frameUri,
      state.challenge.session_token,
    );

    if (result.status === 'passed') {
      setState((prev) => ({
        ...prev,
        phase: 'passed',
        result,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        result,
        error: result.message || 'Liveness verification failed',
      }));
    }

    return result;
  }, [state]);

  // Regula, step 1: the captured face image (file:// URI) goes up first; it is
  // the image a passed session hands on. Then Regula liveness runs (checking).
  const submitCapture = useCallback(async (frameUri: string): Promise<void> => {
    if (!state.regula) {
      throw new Error('No active liveness session');
    }
    await api.uploadRegulaLivenessFrame(state.regula.session_id, frameUri, state.regula.session_token);
    setState((prev) => ({ ...prev, phase: 'checking', instruction: '' }));
  }, [state]);

  // Regula, step 2: run Regula on the phone (`run`), then hand only the
  // transactionId to the server, which reads the verdict from Regula. Server
  // refusals throw, like the challenge's API errors, for the caller's
  // in-place retry UI; a cancelled or failed run fails here.
  const checkLiveness = useCallback(async (run: (config: RegulaRunConfig) => Promise<RegulaOutcome>): Promise<void> => {
    if (!state.regula || state.phase !== 'checking') {
      throw new Error('No captured face image to check');
    }
    const session = state.regula;
    const config = regulaRunConfig(session);
    const outcome: RegulaOutcome = config ? await run(config) : { kind: 'failed', reason: 'notConfigured', message: REGULA_MESSAGES.notConfigured };
    if (outcome.kind !== 'transaction') {
      console.log('[Liveness] Regula run ended without a transaction:', outcome.kind);
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        error: outcome.kind === 'cancelled' ? REGULA_MESSAGES.cancelled : outcome.message,
      }));
      return;
    }
    const verdict = await api.completeRegulaLiveness(session.session_id, outcome.transactionId, session.session_token);
    setState((prev) => ({
      ...prev,
      phase: 'passed',
      result: { success: true, status: 'passed', session_id: verdict.session_id, message: 'Liveness verified.' },
    }));
  }, [state]);

  const reset = useCallback(() => {
    setState({ ...initialState });
  }, []);

  /** Fail the active session locally (e.g. step timeout) — shows the retry UI
   *  without involving the parent's unrecoverable-error handler. */
  const failSession = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      phase: 'failed',
      error: message,
    }));
  }, []);

  const session = state.regula ?? state.challenge;
  return {
    ...state,
    startSession,
    submitEvidence,
    finalize,
    submitCapture,
    checkLiveness,
    reset,
    failSession,
    /** Session credentials for face enrollment (available after the session passes). */
    sessionId: session?.session_id ?? null,
    sessionToken: session?.session_token ?? null,
    /** Seconds the session had left when it was created. */
    expiresInSeconds: session?.expires_in_seconds ?? null,
  };
}

const initialState: LivenessSessionState = {
  phase: 'idle',
  method: null,
  challenge: null,
  regula: null,
  currentStepIndex: 0,
  currentChallenge: null,
  instruction: '',
  error: null,
  result: null,
};
