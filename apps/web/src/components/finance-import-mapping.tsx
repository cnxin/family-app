import type { FinanceImportColumnMapping } from '@family/contracts';
import { selectClass } from './ui';

type Field = keyof FinanceImportColumnMapping;

const FIELDS: { field: Field; label: string; required: boolean; hint?: string }[] = [
  { field: 'occurredOn', label: '日期', required: true },
  { field: 'amount', label: '金额', required: true },
  { field: 'merchant', label: '对方', required: true },
  { field: 'direction', label: '收支', required: false, hint: '不选就按金额正负算：负数是支出' },
  { field: 'note', label: '备注', required: false, hint: '会记成流水的名字；不选就用对方' },
  { field: 'externalId', label: '单号', required: false, hint: '不选就不按单号去重，只按同日同额提示疑似重复' },
];

/** 通用 CSV 第二步：告诉我哪列是什么，下面给前几行对照着看。 */
export function ImportMappingStep({
  headers,
  sampleRows,
  mapping,
  onChange,
}: {
  headers: string[];
  sampleRows: string[][];
  mapping: Partial<FinanceImportColumnMapping>;
  onChange: (next: Partial<FinanceImportColumnMapping>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-soft">这份文件没有固定格式，选一下哪列是什么（带 * 的要选）。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ field, label, required, hint }) => (
          <label key={field} className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">
              {label}
              {required ? ' *' : ''}
            </span>
            <select
              aria-label={`${label}列`}
              className={`${selectClass} h-10 w-full`}
              value={mapping[field] ?? ''}
              onChange={(event) =>
                onChange({ ...mapping, [field]: event.target.value === '' ? null : Number(event.target.value) })
              }
            >
              <option value="">{required ? '选一列' : '不选'}</option>
              {headers.map((header, index) => (
                <option key={index} value={index}>
                  第 {index + 1} 列：{header || '（空表头）'}
                </option>
              ))}
            </select>
            {hint ? <span className="mt-1 block text-[12px] text-ink-soft">{hint}</span> : null}
          </label>
        ))}
      </div>
      {sampleRows.length ? (
        <div>
          <p className="mb-1.5 text-[12px] text-ink-soft">文件里的前 {sampleRows.length} 行</p>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="min-w-full whitespace-nowrap text-[12px]">
              <thead className="bg-muted text-left text-ink-soft">
                <tr>
                  {headers.map((header, index) => (
                    <th key={index} className="px-2.5 py-1.5 font-normal">
                      {header || `第 ${index + 1} 列`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-border">
                    {headers.map((_, index) => (
                      <td key={index} className="px-2.5 py-1.5 tabular-nums">
                        {row[index] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
