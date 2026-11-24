import QR from 'qrcode';
import { useEffect, useState } from 'react';

/** QR-kod (mörka moduler på champagnefärgad bakgrund – lätt att skanna). */
export function QRCode({ value, size = 240, className = '' }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QR.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size * 2,
      color: { dark: '#0a0910', light: '#f6ead0' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  return (
    <div className={`qr ${className}`} style={{ width: size + 24 }}>
      {src ? <img src={src} width={size} height={size} alt={`QR-kod: ${value}`} /> : <div style={{ width: size, height: size }} />}
    </div>
  );
}
