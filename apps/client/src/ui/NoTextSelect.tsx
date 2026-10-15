'use client';

import { useEffect } from 'react';

// No text highlighting anywhere in the game UI (players found drag-selection annoying, and it fights click-to-move):
// globals.css sets user-select: none on the page; this also stops drag-selection and the ghost drag of links and
// images from starting. Text fields (input, textarea, select, contenteditable) stay fully selectable and editable.
// Renders nothing.

function editable(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
  return !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function NoTextSelect() {
  useEffect(() => {
    const onSelectStart = (e: Event) => { if (!editable(e.target)) e.preventDefault(); };
    const onDragStart = (e: DragEvent) => { if (!editable(e.target)) e.preventDefault(); };
    document.addEventListener('selectstart', onSelectStart);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('selectstart', onSelectStart);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, []);
  return null;
}
