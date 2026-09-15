import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';
import { DomainError } from '@family/shared';
import {
  ObservedRequest,
  StructuredLogger,
  normalizedRequestPath,
  summarizeException,
} from './observability';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<ObservedRequest>();
    const res = http.getResponse<Response>();
    const requestId = req.requestContext?.requestId || 'unavailable';
    // packages/shared 的领域错误：框架无关，和 Nest 内置异常映射到同样的响应结构
    if (exception instanceof DomainError) {
      if (req.requestContext) req.requestContext.errorCode = exception.code;
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message },
        requestId,
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const body =
        typeof response === 'object' && response !== null
          ? (response as { message?: string | string[]; error?: string })
          : {};
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray(body.message)
            ? body.message.join('; ')
            : body.message || exception.message;
      const code = body.error || exception.name;
      if (req.requestContext) req.requestContext.errorCode = code;
      if (status >= 500) {
        this.logUnexpectedException(exception, req, requestId);
      }
      res.status(status).json({
        error: { code, message },
        requestId,
      });
      return;
    }
    if (req.requestContext) req.requestContext.errorCode = 'INTERNAL_ERROR';
    this.logUnexpectedException(exception, req, requestId);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，稍后再试' },
      requestId,
    });
  }

  private logUnexpectedException(
    exception: unknown,
    request: ObservedRequest,
    requestId: string,
  ) {
    this.logger.write('error', 'unhandled_exception', {
      requestId,
      method: request.method,
      path: normalizedRequestPath(request),
      accountId: request.user?.accountId,
      householdId: request.user?.householdId,
      memberId: request.user?.memberId,
      summary: summarizeException(exception),
    });
  }
}
