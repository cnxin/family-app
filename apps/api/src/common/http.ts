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

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { message?: string | string[]; error?: string };
      const message = Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message || exception.message;
      res.status(status).json({
        error: { code: body.error || exception.name, message },
      });
      return;
    }
    console.error(exception);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，稍后再试' },
    });
  }
}
