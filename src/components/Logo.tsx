export function Logo({ size = 'md', subtitle, className = '' }: { size?: 'sm' | 'md' | 'lg' | 'xl'; subtitle?: string; className?: string }) {
  return (
    <div className={`logo logo--${size} ${className}`} aria-label="Bonjour Babes">
      <span className="logo__bonjour">Bonjour</span>
      <span className="logo__babes">Babes</span>
      {subtitle && <span className="logo__sub">{subtitle}</span>}
    </div>
  );
}
