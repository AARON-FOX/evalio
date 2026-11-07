import { createContext } from "react";

import type { Session } from "@supabase/supabase-js";
import type { CurrentUserResponse } from "../services/api";

export interface AuthContextValue {
  initialized: boolean;
  session: Session | null;
  profile: CurrentUserResponse | null;
  profileError: string | null;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
