import { LoggerService } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID_PATH_PATTERN =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const SENSITIVE_TEXT_PATTERN =
  /\b(?:authorization|bearer|password|passwd|pin|refresh[_-]?token|access[_-]?token|jwt[_-]?secret|db[_-]?password)\b(?:\s*[:=]?\s*[^\s,;]*)?/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export interface RequestContext {
  requestId: string;
  errorCode?: string;
}

export type ObservedRequest = Request & {
  requestContext?: RequestContext;
  user?: {
    householdId?: string;
    memberId?: string;
  };
};

function sanitizeText(value: string, maximumLength = 500) {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(SENSITIVE_TEXT_PATTERN, '[redacted]')
    .replace(JWT_PATTERN, '[redacted]')
    .slice(0, maximumLength);
}

function frameworkContext(optionalParams: unknown[]) {
  const candidate = [...optionalParams]
    .reverse()
    .find((value): value is string => typeof value === 'string');
  return candidate ? sanitizeText(candidate, 100) : undefined;
}

export function summarizeException(exception: unknown) {
  if (!(exception instanceof Error)) return 'Non-error exception';
  const name = sanitizeText(exception.name || 'Error', 80);
  const message = sanitizeText(exception.message || 'No message');
  return `${name}: ${message}`;
}

function summarizeFrameworkMessage(message: unknown) {
  if (message instanceof Error) return summarizeException(message);
  if (typeof message === 'string') return sanitizeText(message);
  if (typeof message === 'number' || typeof message === 'boolean') {
    return String(message);
  }
  return 'Structured application event';
}

type LogValue = string | number | boolean | null | undefined;

export class StructuredLogger implements LoggerService {
  write(
    level: 'debug' | 'error' | 'info' | 'warn',
    event: string,
    fields: Record<string, LogValue> = {},
  ) {
    const normalizedFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === 'string' ? sanitizeText(value) : value,
      ]),
    );
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...normalizedFields,
    });
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    this.write('info', 'application_log', {
      context: frameworkContext(optionalParams),
      message: summarizeFrameworkMessage(message),
    });
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.write('error', 'application_error', {
      context: frameworkContext(optionalParams),
      message: summarizeFrameworkMessage(message),
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.write('warn', 'application_log', {
      context: frameworkContext(optionalParams),
      message: summarizeFrameworkMessage(message),
    });
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.write('debug', 'application_log', {
      context: frameworkContext(optionalParams),
      message: summarizeFrameworkMessage(message),
    });
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.debug(message, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.error(message, ...optionalParams);
  }
}

function requestIdFrom(request: Request) {
  const header = request.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export function normalizedRequestPath(request: Request) {
  const routePath = (request.route as { path?: unknown } | undefined)?.path;
  const matchedPath =
    typeof routePath === 'string'
      ? `${request.baseUrl || ''}${routePath}`
      : new URL(request.originalUrl || request.url, 'http://localhost').pathname;
  return matchedPath
    .replace(UUID_PATH_PATTERN, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:number')
    .replace(/\/{2,}/g, '/');
}

export function requestContextMiddleware(
  logger: StructuredLogger,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const observedRequest = request as ObservedRequest;
    const requestId = requestIdFrom(request);
    const startedAt = process.hrtime.bigint();
    observedRequest.requestContext = { requestId };
    response.setHeader('X-Request-ID', requestId);

    response.once('finish', () => {
      const path = normalizedRequestPath(request);
      if (
        response.statusCode < 400 &&
        (path === '/health/live' || path === '/health/ready')
      ) {
        return;
      }
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.write('info', 'http_request', {
        requestId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        errorCode: observedRequest.requestContext?.errorCode,
        householdId: observedRequest.user?.householdId,
        memberId: observedRequest.user?.memberId,
      });
    });

    next();
  };
}
