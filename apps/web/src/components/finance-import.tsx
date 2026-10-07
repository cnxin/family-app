import { useState } from 'react';
import {
  FINANCE_IMPORT_SOURCE_INFO,
  FINANCE_IMPORT_SOURCES,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceImportColumnMapping,
  type FinanceImportPreview,
  type FinanceImportSource,
} from '@family/contracts';
import { ApiError } from '../lib/api';
import {
  IMPORT_MAX_BYTES,
  guessColumnMapping,
  useCommitFinanceImport,
  useDiscardFinanceImport,
  useMapFinanceImport,
  useUploadFinanceImport,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ImportMappingStep } from './finance-import-mapping';
import { ImportPreviewList, type RowDecision } from './finance-import-preview';
import { Button, Dialog, Segmented } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** 文件本身的问题在传之前就说：zip、Excel、超过 5 MB。 */
function fileProblem(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) return '这是 zip 压缩包：先解压，上传里面的 csv';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return '这是 Excel 文件：用 Excel / WPS 另存为 csv 再上传';
  if (file.size > IMPORT_MAX_BYTES) return '文件超过 5 MB，分几次导出再导入';
  return null;
}

/**
 * 「导入账单」（K1）：选账户和来源 → 传 csv →（通用 CSV 选列）→ 预览里逐行改 → 确认才记账。
 * 预览在服务端放 30 分钟；关掉对话框就放弃这次预览。
 */
export function ImportDialog({
  accounts,
  categories,
  onClose,
  onDone,
}: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
  /** 导完了：带上账单最后那天所在的月份，流水切过去就能看到 */
  onDone: (month: string | null) => void;
}) {
  const usable = accounts.filter((one) => one.isActive);
  const [accountId, setAccountId] = useState(usable[0]?.id ?? '');
  const [source, setSource] = useState<FinanceImportSource>('wechat');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinanceImportPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<FinanceImportColumnMapping>>({});
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const [message, setMessage] = useState<string | null>(null);
  const upload = useUploadFinanceImport();
  const map = useMapFinanceImport();
  const commit = useCommitFinanceImport();
  const discard = useDiscardFinanceImport();
  const step = !preview ? 'pick' : preview.stage === 'mapping' ? 'mapping' : 'preview';
  const rows = preview?.rows ?? [];
  const chosen = rows.filter((row) => row.selectable && decisions[row.rowNo]?.included).length;

  function show(next: FinanceImportPreview) {
    setPreview(next);
    setMessage(null);
    if (next.stage === 'mapping') setMapping(guessColumnMapping(next.headers ?? []));
    setDecisions(
      Object.fromEntries(
        next.rows.map((row) => [
          row.rowNo,
          { included: row.included, type: row.suggestedType, categoryId: row.suggestedCategoryId, toAccountId: row.toAccountId },
        ]),
      ),
    );
  }

  function failed(error: unknown, fallback: string) {
    // 预览过期（30 分钟）：回到第一步重新传
    if (error instanceof ApiError && error.status === 410) {
      setPreview(null);
      setMessage('预览过期了（30 分钟），重新上传一次');
      return;
    }
    setMessage(errorText(error, fallback));
  }

  /** 放弃这次预览（关掉、重新选文件时）；已经没了的不管 */
  function drop() {
    if (preview && preview.status === 'previewing') discard.mutate(preview.id);
  }

  function restart() {
    drop();
    setPreview(null);
    setMessage(null);
  }

  function close() {
    drop();
    onClose();
  }

  function submitFile() {
    if (!accountId) return setMessage('先选导进哪个账户');
    if (!file) return setMessage('选一个导出的 csv 文件');
    const problem = fileProblem(file);
    if (problem) return setMessage(problem);
    setMessage(null);
    upload.mutate({ source, accountId, file }, { onSuccess: show, onError: (error) => failed(error, '没传上去') });
  }

  function submitMapping() {
    if (!preview) return;
    const { occurredOn, amount, merchant } = mapping;
    if (occurredOn == null || amount == null || merchant == null) return setMessage('日期、金额、对方这三列要选');
    const columnMapping = {
      occurredOn,
      amount,
      merchant,
      direction: mapping.direction ?? null,
      note: mapping.note ?? null,
      externalId: mapping.externalId ?? null,
    };
    map.mutate({ id: preview.id, columnMapping }, { onSuccess: show, onError: (error) => failed(error, '没读出来') });
  }

  function confirm() {
    if (!preview) return;
    const missing = rows.find((row) => {
      const decision = decisions[row.rowNo];
      return row.selectable && decision.included && decision.type !== 'transfer' && !decision.categoryId;
    });
    if (missing) return setMessage(`第 ${missing.rowNo} 行还没选分类`);
    // 只发和「底」不一样的行：底可以是预览的建议、全选或全不选，挑要发的行最少的那个（请求体不超 100 KB）
    const changedFrom = (base: boolean | null) =>
      rows.flatMap((row) => {
        const decision = decisions[row.rowNo];
        if (!row.selectable) return [];
        const baseIncluded = base === null ? row.included : base;
        if (!decision.included && !baseIncluded) return [];
        const same =
          decision.included === baseIncluded &&
          decision.type === row.suggestedType &&
          decision.categoryId === row.suggestedCategoryId &&
          decision.toAccountId === row.toAccountId;
        if (same) return [];
        const transfer = decision.type === 'transfer';
        return [{
          rowNo: row.rowNo,
          included: decision.included,
          type: decision.type,
          categoryId: transfer ? null : decision.categoryId,
          toAccountId: transfer ? decision.toAccountId : null,
        }];
      });
    const plan = ([null, true, false] as const)
      .map((includeAll) => ({ includeAll, rows: changedFrom(includeAll) }))
      .reduce((best, one) => (one.rows.length < best.rows.length ? one : best));
    setMessage(null);
    navigator.vibrate?.(10);
    commit.mutate(
      { id: preview.id, rows: plan.rows, includeAll: plan.includeAll },
      {
        onSuccess: (result) => {
          pushToast(`导入 ${result.imported} 笔，跳过 ${result.skipped + result.duplicates} 笔`);
          onDone(result.imported > 0 && preview.rangeTo ? preview.rangeTo.slice(0, 7) : null);
          onClose();
        },
        onError: (error) => failed(error, '没导进去'),
      },
    );
  }

  const stats = preview?.stats;
  const busy = upload.isPending || map.isPending || commit.isPending;
  return (
    <Dialog
      title={step === 'pick' ? '导入账单' : step === 'mapping' ? '导入账单 · 选列' : '导入账单 · 预览'}
      maxWidth={step === 'preview' ? 980 : 560}
      maxHeight="92vh"
      onClose={close}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <div className="flex gap-2">
            {step !== 'pick' ? (
              <Button variant="outline" className="flex-1 sm:flex-none" disabled={busy} onClick={restart}>
                重新选文件
              </Button>
            ) : null}
            {step === 'pick' ? (
              <Button className="flex-1" disabled={busy} onClick={submitFile}>
                {upload.isPending ? '读取中…' : '上传并预览'}
              </Button>
            ) : step === 'mapping' ? (
              <Button className="flex-1" disabled={busy} onClick={submitMapping}>
                {map.isPending ? '读取中…' : '下一步：预览'}
              </Button>
            ) : (
              <Button className="flex-1" disabled={busy || chosen === 0} onClick={confirm}>
                {commit.isPending ? '导入中…' : `确认导入 ${chosen} 笔`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 'pick' ? (
        <div className="flex flex-col gap-4">
          <div>
            <span className={label}>导进哪个账户</span>
            {usable.length ? (
              <div className="flex flex-wrap gap-1.5">
                {usable.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={accountId === one.id}
                    className={chip(accountId === one.id)}
                    onClick={() => setAccountId(one.id)}
                  >
                    {one.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-soft">还没有在用的账户，让家庭管理员先建一个。</p>
            )}
          </div>
          <div>
            <span className={label}>账单从哪来</span>
            <Segmented
              label="账单来源"
              value={source}
              onChange={setSource}
              options={FINANCE_IMPORT_SOURCES.map((value) => ({ value, label: FINANCE_IMPORT_SOURCE_INFO[value].label }))}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{FINANCE_IMPORT_SOURCE_INFO[source].hint}</p>
          </div>
          <label className="block">
            <span className={label}>账单文件（csv，5 MB 以内）</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="账单文件"
              className="block w-full text-[13px] text-ink-soft file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:text-[13px] file:text-ink hover:file:brightness-95"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[12px] text-ink-soft">先预览、再确认：确认之前不会记账，预览 30 分钟内有效。</p>
        </div>
      ) : step === 'mapping' && preview ? (
        <ImportMappingStep
          headers={preview.headers ?? []}
          sampleRows={preview.sampleRows ?? []}
          mapping={mapping}
          onChange={setMapping}
        />
      ) : preview && stats ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[14px] tabular-nums">
              {`共 ${stats.total} 行，建议导入 ${stats.suggested}，已导入 ${stats.alreadyImported}，疑似重复 ${stats.suspectedDuplicate}`}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-soft">
              {[
                `${FINANCE_IMPORT_SOURCE_INFO[preview.source].label} → ${preview.account.name}`,
                preview.rangeFrom && preview.rangeTo ? `${preview.rangeFrom} 至 ${preview.rangeTo}` : null,
                stats.skippedLines ? `表尾等 ${stats.skippedLines} 行没读` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <ImportPreviewList
            rows={rows}
            decisions={decisions}
            categories={categories}
            transferTargets={usable.filter((one) => one.id !== preview.accountId)}
            onChange={(rowNo, next) => setDecisions((current) => ({ ...current, [rowNo]: { ...current[rowNo], ...next } }))}
            onIncludeMany={(included) =>
              setDecisions((current) => {
                const next = { ...current };
                for (const [rowNo, value] of Object.entries(included)) next[Number(rowNo)] = { ...next[Number(rowNo)], included: value };
                return next;
              })
            }
          />
        </div>
      ) : null}
    </Dialog>
  );
}
