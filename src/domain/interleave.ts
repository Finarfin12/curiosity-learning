export function interleave<T>(items: readonly T[], topic: (item: T) => string,
    random = Math.random, previous?: string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = topic(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const output: T[] = [];
  let last = previous;
  while (groups.size) {
    const candidates = [...groups.entries()];
    const different = candidates.filter(([key]) => key !== last);
    const eligible = different.length ? different : candidates;
    const largest = Math.max(...eligible.map(([, group]) => group.length));
    const tied = eligible.filter(([, group]) => group.length === largest);
    const [key, group] = tied[Math.floor(random() * tied.length)];
    const [item] = group.splice(Math.floor(random() * group.length), 1);
    output.push(item);
    last = key;
    if (!group.length) groups.delete(key);
  }
  return output;
}
