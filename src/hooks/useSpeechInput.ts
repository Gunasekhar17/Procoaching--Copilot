import { useState, useRef, useCallback, useEffect } from "react";

// Chrome/Edge ship this as the prefixed webkitSpeechRecognition; a handful of
// other browsers (Firefox, Safari) don't implement it at all yet.
type SpeechRecognitionCtor = new () => any;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useSpeechInput(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Tracks whether the user intentionally stopped listening, vs. the
  // recognition engine ending on its own (which some browsers still do
  // after a long silence even in continuous mode) — lets us auto-restart
  // in the latter case instead of cutting the user off mid-thought.
  const keepListeningRef = useRef(false);

  useEffect(() => {
    setIsSupported(!!getSpeechRecognitionCtor());
  }, []);

  const stop = useCallback(() => {
    keepListeningRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "en-US";
    // continuous=true is the key fix: without it, the browser stops
    // listening as soon as it detects a pause in speech, instead of
    // waiting for the user to actually finish.
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      onResult(transcript);
    };

    recognition.onerror = (event: any) => {
      // "no-speech" just means a pause was detected — not a real error.
      // Let onend decide whether to restart; don't stop listening here.
      if (event?.error === "no-speech") return;
      keepListeningRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      // Some browsers (esp. mobile) end the session on their own after a
      // period of silence even with continuous=true. If the user hasn't
      // explicitly tapped stop, restart automatically so a pause doesn't
      // cut them off.
      if (keepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* engine refused to restart — fall through and mark stopped */
        }
      }
      setIsListening(false);
    };

    keepListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [onResult]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { isListening, isSupported, start, stop, toggle };
}

/** Read text aloud using the browser's built-in speech synthesis (free, no API calls). */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // stop anything currently playing
  // Strip markdown syntax so it doesn't read out asterisks/hashes/pipes etc.
  const plain = text
    .replace(/[#*_`~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\|/g, ", ");
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
