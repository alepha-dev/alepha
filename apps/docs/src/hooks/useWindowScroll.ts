import { useEffect, useState } from "react";

export const useWindowScroll = () => {
  const [scroll, setScroll] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleScroll = () => {
      setScroll({ x: window.scrollX, y: window.scrollY });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (options: { x?: number; y?: number }) => {
    window.scrollTo({
      left: options.x ?? 0,
      top: options.y ?? 0,
      behavior: "smooth",
    });
  };

  return [scroll, scrollTo] as const;
};
