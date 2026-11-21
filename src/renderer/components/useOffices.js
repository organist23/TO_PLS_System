import { useCallback, useEffect, useState } from 'react';

// Office filter options for reports: active offices, then archived ones, since records keep the office they were saved with.
export function useOffices() {
  const [state, setState] = useState({ rows: [], error: '' });
  const load = useCallback(async () => {
    const [active, archived] = await Promise.all([
      window.api.invoke('offices:list', {}),
      window.api.invoke('offices:list', { archived: true }),
    ]);
    const failed = [active, archived].find((r) => !r.ok);
    if (failed) return setState({ rows: [], error: failed.error });
    setState({ rows: [...active.data, ...archived.data.map((o) => ({ ...o, name: `${o.name} (archived)` }))], error: '' });
  }, []);
  useEffect(() => void load(), [load]);
  return { ...state, retry: load };
}
