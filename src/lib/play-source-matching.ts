export function matchesRequestedYear(
  requestedYear?: string,
  candidateYear?: string,
): boolean {
  const requested = requestedYear?.trim();
  const candidate = candidateYear?.trim();

  // A missing year is an optional filter, not the numeric year zero.
  if (!requested || !candidate) return true;

  const requestedNumber = Number(requested);
  const candidateNumber = Number(candidate);
  return (
    Number.isNaN(requestedNumber) ||
    Number.isNaN(candidateNumber) ||
    requestedNumber === candidateNumber
  );
}
