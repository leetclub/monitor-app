/** Cards vs table (Red Flags) or essential vs all columns (Overall) on tablet. */
export function OpsViewToggle({
  value,
  onChange,
  options,
  ariaLabel = 'View mode',
}: {
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div className="opsViewToggle" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`opsViewToggleBtn${value === opt.id ? ' opsViewToggleBtnActive' : ''}`}
          aria-pressed={value === opt.id}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
