/** Shimmer placeholder — signals content is on its way without a spinner. */
export function AlertModalAnticipate({
  hint,
  lines = 3,
}: {
  hint?: string;
  lines?: number;
}) {
  return (
    <div className="alertModalAnticipate" role="status" aria-live="polite">
      {hint ? <p className="alertModalAnticipateHint">{hint}</p> : null}
      <div className="alertModalAnticipateLines" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={[
              'alertModalAnticipateLine',
              i === 0 ? 'alertModalAnticipateLine--wide' : '',
              i === lines - 1 && lines > 1 ? 'alertModalAnticipateLine--short' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ animationDelay: `${0.08 + i * 0.14}s` }}
          />
        ))}
      </div>
    </div>
  );
}
