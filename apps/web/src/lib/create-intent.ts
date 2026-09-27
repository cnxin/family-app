import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** 读 ?create=1 和可选 kind，进入新建状态后从 URL 抹掉。 */
export function useCreateIntent(onOpen: (kind: string | null) => void) {
  const [params, setParams] = useSearchParams();
  const [handled, setHandled] = useState(false);
  if (params.get('create') === '1' && !handled) {
    setHandled(true);
    onOpen(params.get('kind'));
  }
  useEffect(() => {
    if (params.get('create') !== '1' && !params.has('kind')) return;
    const next = new URLSearchParams(params);
    next.delete('create');
    next.delete('kind');
    setParams(next, { replace: true });
  }, [params, setParams]);
}
