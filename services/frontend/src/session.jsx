import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { loadSession, saveSession } from './api';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(loadSession);

  const signIn = useCallback((next) => {
    saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    saveSession(null);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, token: session?.token ?? null, signIn, signOut }),
    [session, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
