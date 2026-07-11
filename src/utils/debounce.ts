export type Debounced<Args extends unknown[]> = {
  (...args: Args): void;
  cancel(): void;
  flush(): void;
};

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const debounced = ((...args: Args) => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const runArgs = pendingArgs;
      pendingArgs = null;
      if (runArgs) fn(...runArgs);
    }, delayMs);
  }) as Debounced<Args>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    const runArgs = pendingArgs;
    pendingArgs = null;
    if (runArgs) fn(...runArgs);
  };

  return debounced;
}
