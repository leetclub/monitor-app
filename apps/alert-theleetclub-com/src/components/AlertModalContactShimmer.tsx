/** Muted icon placeholders while contact channels resolve — no spinner text. */
export function AlertModalContactShimmer() {
  return (
    <div className="alertModalContactShimmer" role="status" aria-label="Contact channels loading">
      {['mail', 'phone', 'slack', 'chat'].map((kind, i) => (
        <span
          key={kind}
          className="alertModalContactShimmerIcon"
          style={{ animationDelay: `${i * 0.12}s` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
