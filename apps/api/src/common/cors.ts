const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isDevelopmentOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (LOCAL_HOSTS.has(url.hostname) ||
        url.hostname.endsWith('.local') ||
        isPrivateIpv4(url.hostname))
    );
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins = process.env.CORS_ORIGINS,
  nodeEnv = process.env.NODE_ENV,
) {
  if (!origin) return true;

  const allowed = new Set(
    (configuredOrigins ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (allowed.size > 0) return allowed.has(origin);
  return nodeEnv !== 'production' && isDevelopmentOrigin(origin);
}
