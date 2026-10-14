import { useEffect, useState } from 'react';
import { getIdTokenResult, onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from './lib/firebase';

export function useSession() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(Boolean(auth));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) return;
    let disposed = false;
    let sequence = 0;
    const stop = onIdTokenChanged(auth, async current => {
      const request = ++sequence;
      setLoading(true);
      setError('');
      setUser(current);
      setIsAdmin(false);
      try {
        if (current) {
          const token = await getIdTokenResult(current);
          if (!disposed && request === sequence) setIsAdmin(token.claims.admin === true);
        }
      } catch {
        if (!disposed && request === sequence) {
          setError('Impossible de vérifier votre session. Réessayez dans quelques instants.');
        }
      } finally {
        if (!disposed && request === sequence) setLoading(false);
      }
    });
    return () => { disposed = true; stop(); };
  }, []);

  return { user, isAdmin, loading, error };
}
