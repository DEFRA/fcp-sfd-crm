// With throwOnHttpError, ffetch rejects with an HttpError that carries the
// failing Response as its cause rather than as a `response` property. Anything
// reading `err.response` silently sees undefined and misreports the failure.
export const responseFromError = (error) => {
  const cause = error?.cause
  return typeof cause?.status === 'number' ? cause : undefined
}
