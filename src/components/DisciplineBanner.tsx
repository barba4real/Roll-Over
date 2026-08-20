import React, { useState, useEffect } from 'react';

const MESSAGES = [
  'STICK TO THE RULES',
  "2 odds is enough. Don't get greedy.",
  'One bad pick kills the chain. Be ruthless.',
  "If the data doesn't support it, don't pick it.",
  "Don't chase losses. Reset and restart.",
  "I'm not gambling. I'm compounding.",
  'Trust the process. Trust the data.',
  'Discipline > Excitement.',
];

export default function DisciplineBanner() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % MESSAGES.length);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-red-800 text-white font-bold text-center py-2 px-4 text-sm tracking-wide">
      <span className="inline-block animate-pulse mr-2">&#9679;</span>
      {MESSAGES[messageIndex]}
      <span className="inline-block animate-pulse ml-2">&#9679;</span>
    </div>
  );
}
