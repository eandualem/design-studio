import { useState, useEffect, useRef } from "react";

/**
 * Progressively reveals text with requestAnimationFrame while streaming;
 * snaps to the full text once streaming ends.
 */
export function useStreamingText(fullText: string, isStreaming: boolean): string {
  const [displayedText, setDisplayedText] = useState("");
  const charIndexRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      charIndexRef.current = fullText.length;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  }, [isStreaming, fullText]);

  useEffect(() => {
    if (!isStreaming) return;
    const drain = () => {
      charIndexRef.current = Math.min(charIndexRef.current + 8, fullText.length);
      setDisplayedText(fullText.slice(0, charIndexRef.current));
      if (charIndexRef.current < fullText.length) {
        rafRef.current = requestAnimationFrame(drain);
      } else {
        rafRef.current = null;
      }
    };
    if (charIndexRef.current < fullText.length && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(drain);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [fullText, isStreaming]);

  if (!isStreaming) return fullText;
  return displayedText;
}
