export function NoAccessPage(props: { email: string | null }) {
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>No access</div>
      <p className="muted">
        Signed in as <strong>{props.email || '—'}</strong>, but your account is not set up for Leet Alert yet (view Red
        Flags / Overall, or manage Alert settings).
      </p>
      <p className="muted">
        Ask whoever manages team access for Monitor / Leet Alert to add you — viewers need access to Leet Alert;
        administrators need permission to manage Alert settings as well.
      </p>
    </div>
  );
}
