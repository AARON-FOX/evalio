import { useEffect, useState } from "react";

import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../lib/supabase";

import { getCurrentUser, type CurrentUserResponse } from "../services/api";

import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<{
    initialized: boolean;
    session: Session | null;
  }>({
    initialized: false,
    session: null,
  });

  const [verifiedProfile, setVerifiedProfile] = useState<{
    token: string;
    profile: CurrentUserResponse;
  } | null>(null);

  const [verificationError, setVerificationError] = useState<{
    token: string;
    message: string;
  } | null>(null);

  // Observe Supabase Auth.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth({
        initialized: true,
        session,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const accessToken = auth.session?.access_token ?? null;

  // Verify the user's role through Express.
  useEffect(() => {
    if (!accessToken) return;

    let active = true;
    const controller = new AbortController();

    getCurrentUser(accessToken, controller.signal)
      .then((profile) => {
        if (!active) return;

        setVerifiedProfile({
          token: accessToken,
          profile,
        });

        setVerificationError(null);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }

        setVerificationError({
          token: accessToken,
          message:
            error instanceof Error ? error.message : "Could not verify user",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken]);

  const profile =
    auth.session &&
    verifiedProfile?.token === accessToken &&
    verifiedProfile.profile.id === auth.session.user.id
      ? verifiedProfile.profile
      : null;

  const profileError =
    verificationError?.token === accessToken ? verificationError.message : null;

  return (
    <AuthContext.Provider
      value={{
        initialized: auth.initialized,
        session: auth.session,
        profile,
        profileError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
