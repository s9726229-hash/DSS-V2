/** 帶正負號與單位的數值文字。null 以破折號呈現，不留空白讓人以為是 0。 */
export function percent(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
}
