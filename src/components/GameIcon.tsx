import { useEffect, useState } from "react";

export function GameIcon({
  url,
  name,
  size = 40,
}: {
  url?: string;
  name: string;
  size?: number;
}) {
  const [bad, setBad] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setBad(false);
  }, [url]);
  useEffect(() => {
    const reset = () => {
      setBad(false);
      setRetry(Date.now());
    };
    window.addEventListener("pocket-images-retry", reset);
    return () => window.removeEventListener("pocket-images-retry", reset);
  }, []);
  return url && !bad ? (
    <img
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="game-icon"
      src={
        "/api/image?url=" +
        encodeURIComponent(url) +
        (retry ? "&retry=" + retry : "")
      }
      alt={name}
      onError={() => setBad(true)}
    />
  ) : (
    <span className="icon-fallback" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  );
}
