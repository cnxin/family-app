import { BadRequestException } from '@nestjs/common';

export const MAX_QUANTITY = 99_999_999.99;

export function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}

export function quantityString(value: number) {
  return String(roundQuantity(value));
}

export function assertQuantityRange(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
    throw new BadRequestException(`库存数量必须在 0 到 ${MAX_QUANTITY} 之间`);
  }
}
