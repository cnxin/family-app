import type { SmartHomeIcon as IconKind } from '@family/contracts';

// 设备图标（按图标类型，不按厂商）。线条图标，颜色跟 currentColor，开 / 关 / 运行 / 离线由外层底色表达。

const PATHS: Record<IconKind, string> = {
  vacuum: 'M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM12 4v3',
  curtain: 'M3 4h18M6 4v15c2-1 3-4 3-15M18 4v15c-2-1-3-4-3-15',
  air_conditioner: 'M5 5h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 17l-1 2M12 17v2M17 17l1 2',
  washer: 'M6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3zM12 8.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9zM7.5 6.5h2',
  dryer: 'M6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3zM12 8.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9zM10 12c1-1 3 1 4 0',
  water_purifier: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z',
  fridge: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM6 10h12M9 6v2M9 13v3',
  switch: 'M12 3v9M7.5 6.5a7 7 0 1 0 9 0',
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.9 1 1 1.6L9.8 16h4.4l.3-.5c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3z',
  fan: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 10.5C12 6 13 3 16 4s0 5.5-4 6.5M13.5 12c4.5 0 7.5 1 6.5 4s-5.5 0-6.5-4M10.5 12c-4.5 0-7.5-1-6.5-4s5.5 0 6.5 4M12 13.5c0 4.5-1 7.5-4 6.5s0-5.5 4-6.5',
  sensor: 'M4 15a8 8 0 0 1 16 0M12 15l3-4M3 19h18',
  scene: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  other: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export function SmartHomeIcon({ kind, size = 22 }: { kind: IconKind; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[kind] ?? PATHS.other} />
    </svg>
  );
}
