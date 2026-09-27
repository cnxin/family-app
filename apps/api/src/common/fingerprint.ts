import { createHash } from 'node:crypto';

/**
 * 幂等请求指纹。
 *
 * 各域的幂等实现都是「(household, idempotencyKey) 去重 + 指纹比对」：同一把幂等键再次出现时，
 * 比对指纹判断是「重放同一个请求」还是「同一把键被用于不同请求」（后者抛 409）。
 * 指纹只在这一处比对，但它**落库**（`TravelOperation.requestFingerprint`、
 * `KnowledgeArticleRevision.requestFingerprint`、`FamilyMemoryOperation` 等），
 * 所以改算法等于让历史行作废——跨部署复用同一把键会从「重放」变成 409。
 *
 * 目前仓库里有两种算法，这里如实保留，不做统一（统一是一次独立的、有数据影响的变更）：
 * - `fingerprint()`：先递归按键名排序再序列化，键顺序不影响结果。finance 与 agent 提案在用。
 * - `rawFingerprint()`：直接序列化，**键顺序敏感**。knowledge / memories / travel 在用。
 *   这三处的 payload 目前都是服务端按固定顺序拼的，所以没出过问题，但它是潜在坑：
 *   哪天换成透传客户端对象，同一份请求换个键序就会被判成不同请求。
 *
 * media 的 webhook 去重另有一套（`moviepilot-webhook.service.ts` 的 `canonicalizeWebhookValue`
 * / `hashWebhookValue`），排序用的是默认 `Array.sort()` 而非 `localeCompare`，两者对非 ASCII
 * 键名结果不同，所以也没有并进来。
 */

/** 递归按键名排序（`localeCompare`），让序列化结果与键顺序无关。 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

/** 规范化后的 sha256 指纹：键顺序不影响结果。 */
export function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(value)))
    .digest('hex');
}

/** 不规范化的 sha256 指纹：键顺序影响结果。仅为兼容既有落库指纹而保留。 */
export function rawFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
