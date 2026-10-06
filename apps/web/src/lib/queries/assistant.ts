import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantUtteranceFilterQuery,
  AssistantUtterancePage,
  CreateAssistantUtteranceBody,
} from '@family/contracts';
import { api, apiBlob, getAccessToken } from '../api';

// 助理原话（J2）：设置页「原话记录」与 ⌘K 落表。原话只存家里的服务器，不出网。

function search(filter: AssistantUtteranceFilterQuery & { limit?: number }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value != null && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** 最近的原话（倒序）；成员只会拿到自己的，管理员可以按人筛。 */
export function useAssistantUtterances(filter: { memberId?: string; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: ['assistant-utterances', filter],
    queryFn: () => api<AssistantUtterancePage>(`/assistant/utterances${search(filter)}`),
    enabled,
  });
}

export function useClearMyUtterances() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ deleted: number }>('/assistant/utterances?memberId=me', { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['assistant-utterances'] }),
  });
}

/** 导出 CSV（管理员）：带登录拿 Blob 再存成文件；BOM 在字节里，Excel 直接打开不乱码。 */
export async function downloadUtterancesCsv(filter: AssistantUtteranceFilterQuery = {}) {
  const blob = await apiBlob(`/assistant/utterances/export.csv${search(filter)}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `小管家原话-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 记一条原话：keepalive fetch，不等结果、不阻塞跳转，失败静默（试用期少记一条没关系，别打扰人）。
 * 不走 api() 的 401 续期——面板关掉时页面可能正在跳走，续期来不及也不值得。
 */
export function recordUtterance(body: CreateAssistantUtteranceBody) {
  const token = getAccessToken();
  if (!token) return;
  try {
    void fetch('/api/assistant/utterances', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // 静默：记不上就算了
  }
}
