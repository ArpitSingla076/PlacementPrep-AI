import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data-loading hook.
 *   const { data, error, loading, reload, refresh } = useFetch(() => api.get(...), [page]);
 * "loading" is DERIVED (the stored result belongs to a different request key), so we never call setState
 * synchronously inside an effect.
 *  - reload():  start over (clears data, shows loading). Use after the user changes something.
 *  - refresh(): fetch again in the background and swap the data in silently. Use for polling.
 */
export function useFetch(fetcher, deps = []) {
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([...deps, nonce]);
  const [state, setState] = useState({ key: null, data: null, error: null });
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(key);

  useEffect(() => { fetcherRef.current = fetcher; keyRef.current = key; });

  useEffect(() => {
    let cancelled = false;
    fetcherRef.current()
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((error) => !cancelled && setState({ key, data: null, error }));
    return () => { cancelled = true; };
  }, [key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(() => {
    const k = keyRef.current;
    return fetcherRef.current()
      .then((data) => setState((s) => (keyRef.current === k ? { key: k, data, error: null } : s)))
      .catch(() => {}); // a failed background refresh keeps showing the last good data
  }, []);

  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !current, reload, refresh };
}
