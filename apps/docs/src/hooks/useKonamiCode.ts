import { useEffect, useRef } from "react";

const KONAMI_CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export const useKonamiCode = (callback: () => void) => {
  const inputRef = useRef<string[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      inputRef.current = [...inputRef.current, e.key].slice(-KONAMI_CODE.length);

      if (
        inputRef.current.length === KONAMI_CODE.length &&
        inputRef.current.every(
          (key, i) => key.toLowerCase() === KONAMI_CODE[i].toLowerCase(),
        )
      ) {
        callback();
        inputRef.current = [];
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [callback]);
};
