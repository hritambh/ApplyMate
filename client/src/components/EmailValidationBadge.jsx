export default function EmailValidationBadge({ status, message }) {
  if (!status || status === 'unknown') {
    return (
      <span className="email-badge email-unknown" title={message || 'Could not verify'}>
        ? unverified
      </span>
    );
  }
  if (status === 'checking') {
    return (
      <span className="email-badge email-checking" title={message}>
        <span className="spinner" /> checking…
      </span>
    );
  }
  if (status === 'valid') {
    return (
      <span className="email-badge email-valid" title={message || 'Email appears reachable'}>
        ✓ valid
      </span>
    );
  }
  return (
    <span className="email-badge email-invalid" title={message || 'Email may not exist'}>
      ✕ invalid
    </span>
  );
}
