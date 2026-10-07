import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommitFinanceImportBody,
  FinanceImport,
  FinanceImportColumnMapping,
  FinanceImportFlag,
  FinanceImportPreview,
  FinanceImportSource,
} from '@family/contracts';
import { api, postForm } from '../api';
import { invalidateModules } from './modules';

// K1 账单导入：上传 → （通用 CSV 选列）→ 预览 → 确认。预览存在服务端 30 分钟，确认后才有流水。

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export const IMPORT_FLAG_LABELS: Record<FinanceImportFlag, string> = {
  already_imported: '已导入',
  suspected_duplicate: '疑似重复',
  not_counted: '不计收支',
  closed: '已关闭',
  refund: '退款',
};

export const IMPORT_DIRECTION_LABELS = { expense: '支出', income: '收入', not_counted: '不计收支' } as const;

/** 通用 CSV 选列：按表头猜一个初始对应，猜不到的留空让人选。 */
export function guessColumnMapping(headers: readonly string[]): Partial<FinanceImportColumnMapping> {
  const find = (words: readonly string[], taken: number[]) => {
    const index = headers.findIndex((header, at) => !taken.includes(at) && words.some((word) => header.includes(word)));
    return index < 0 ? null : index;
  };
  const taken: number[] = [];
  const pick = (words: readonly string[]) => {
    const index = find(words, taken);
    if (index !== null) taken.push(index);
    return index;
  };
  // 先认最具体的：「交易对方」里也有「交易」，「收支方向」里也有「方向」
  const direction = pick(['收支', '收/支', '借贷', '方向']);
  const merchant = pick(['对方', '商户', '户名', '收款方', '付款方']);
  const externalId = pick(['流水号', '单号', '订单号', '编号', '凭证']);
  const occurredOn = pick(['日期', '时间']);
  const amount = pick(['金额', '发生额']);
  const note = pick(['摘要', '备注', '用途', '说明', '附言']);
  return {
    ...(occurredOn === null ? {} : { occurredOn }),
    ...(amount === null ? {} : { amount }),
    ...(merchant === null ? {} : { merchant }),
    direction,
    note,
    externalId,
  };
}

export function useFinanceImports() {
  return useQuery({
    queryKey: ['finance', 'imports'],
    queryFn: () => api<FinanceImport[]>('/finance/imports'),
  });
}

/** 上传只建预览，不动账本：不用刷新别的查询。 */
export function useUploadFinanceImport() {
  return useMutation({
    mutationFn: (input: { source: FinanceImportSource; accountId: string; file: File }) => {
      const form = new FormData();
      form.append('source', input.source);
      form.append('accountId', input.accountId);
      form.append('file', input.file);
      return postForm<FinanceImportPreview>('/finance/imports', form);
    },
  });
}

export function useMapFinanceImport() {
  return useMutation({
    mutationFn: ({ id, columnMapping }: { id: string; columnMapping: FinanceImportColumnMapping }) =>
      api<FinanceImportPreview>(`/finance/imports/${id}/mapping`, { method: 'POST', body: { columnMapping } }),
  });
}

export function useCommitFinanceImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rows, includeAll }: { id: string; rows: CommitFinanceImportBody['rows']; includeAll?: boolean | null }) =>
      api<{ import: FinanceImport; imported: number; skipped: number; duplicates: number }>(
        `/finance/imports/${id}/commit`,
        { method: 'POST', body: { rows, includeAll: includeAll ?? null } },
      ),
    onSuccess: () => {
      void invalidateModules(client);
      void client.invalidateQueries({ queryKey: ['finance'] });
      void client.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useDiscardFinanceImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<FinanceImport>(`/finance/imports/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['finance', 'imports'] }),
  });
}
