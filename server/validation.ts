export class GameError extends Error {}
export function requireThat(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new GameError(message);
}
export function textInput(value: unknown, label: string, max = 24): string {
  requireThat(typeof value === "string", `请填写${label}`);
  const v = value.trim();
  requireThat(v.length > 0 && v.length <= max, `${label}需为 1–${max} 个字符`);
  requireThat(!/[\u0000-\u001f\u007f]/.test(v), `${label}含无效字符`);
  return v;
}
export function integer(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  requireThat(
    typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max,
    `${label}需为 ${min}–${max} 的整数`,
  );
  return value;
}
