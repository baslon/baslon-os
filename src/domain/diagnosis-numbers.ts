/**
 * Deterministic number extraction for diagnosis text. Digits are read as
 * written ("£1,200" is 1200, "10%" is 10); number words are not interpreted.
 */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => Number(match[0].replaceAll(",", "")));
}

export const sameNumber = (left: number, right: number) => Math.abs(left - right) < 1e-9;
