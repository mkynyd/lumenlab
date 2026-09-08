export function modelSupportsWebSearch(model?: string | null) {
  return Boolean(model);
}

export function effectiveWebSearchActive(
  model: string | undefined | null,
  requested: boolean | undefined
) {
  return Boolean(requested && modelSupportsWebSearch(model));
}
