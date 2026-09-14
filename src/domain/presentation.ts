export function countNoun(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}
