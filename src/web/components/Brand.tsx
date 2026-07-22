export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="Bobarr">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact ? <span className="brand__name">bobarr</span> : null}
    </span>
  );
}
