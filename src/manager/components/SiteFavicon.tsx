import { useState } from 'react';
import { Globe } from 'lucide-react';

interface SiteFaviconProps {
  url?: string;
}

export function SiteFavicon({ url }: SiteFaviconProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return <Globe size={15} className="tab-favicon-fallback" aria-hidden="true" />;
  }

  return (
    <img
      src={url}
      alt=""
      className="tab-favicon"
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}
