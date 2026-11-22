import { z } from 'zod';
import type { MessageCode, MessageParams } from '../../shared/messages';
import type { Ctx } from '../env';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: MessageCode,
    public readonly params: MessageParams = {},
  ) {
    super(code);
  }
}

export function fail(status: number, code: MessageCode, params?: MessageParams): never {
  throw new ApiError(status, code, params);
}

export async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const result = schema.safeParse(raw);
  if (!result.success) fail(400, 'bad_request');
  return result.data;
}
