import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { alpha, Box, Button, Paper, Stack, Typography, useTheme } from '@mui/material';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { TourStep } from './tourSteps';

const PAD = 6; // space between the target and the spotlight edge
const GAP = 12; // space between the spotlight and the card
const GUTTER = 16; // the card always stays this far from the viewport edges

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** First target that exists and is actually on screen (hidden sidebar items have a zero-size box). */
function findTarget(targets: string[]): HTMLElement | null {
  for (const name of targets) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Places the card next to the spotlight where it fits, then clamps it inside the viewport gutters. */
function placeCard(hole: Rect, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = hole.left + hole.width / 2 - w / 2;
  const cy = hole.top + hole.height / 2 - h / 2;
  const options = {
    bottom: { top: hole.top + hole.height + GAP, left: cx, fits: hole.top + hole.height + GAP + h <= vh - GUTTER },
    top: { top: hole.top - GAP - h, left: cx, fits: hole.top - GAP - h >= GUTTER },
    right: { top: cy, left: hole.left + hole.width + GAP, fits: hole.left + hole.width + GAP + w <= vw - GUTTER },
    left: { top: cy, left: hole.left - GAP - w, fits: hole.left - GAP - w >= GUTTER },
  };
  // Narrow targets on the left edge (sidebar items) read best with the card beside them.
  const sideFirst = hole.left < vw * 0.3 && hole.width < vw * 0.4 && options.right.fits;
  const order = sideFirst ? (['right', 'bottom', 'top', 'left'] as const) : (['bottom', 'top', 'right', 'left'] as const);
  const chosen = options[order.find((k) => options[k].fits) ?? 'bottom'];
  return {
    top: Math.min(Math.max(chosen.top, GUTTER), Math.max(GUTTER, vh - h - GUTTER)),
    left: Math.min(Math.max(chosen.left, GUTTER), Math.max(GUTTER, vw - w - GUTTER)),
  };
}

export function TourOverlay({
  step,
  index,
  total,
  reduceMotion,
  onBack,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  reduceMotion: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const theme = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);
  const [hole, setHole] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const isLast = index === total - 1;
  const titleId = `tour-title-${step.id}`;
  const bodyId = `tour-body-${step.id}`;

  const measure = useCallback(() => {
    const el = findTarget(step.targets);
    if (!el) {
      setHole(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setHole({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [step.targets]);

  // Find the target for this step, bring it into view and follow it on resize and scroll.
  useLayoutEffect(() => {
    setPos(null);
    const el = findTarget(step.targets);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    measure();
    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [step.targets, measure]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!hole || !card) return;
    setPos(placeCard(hole, card.offsetWidth, card.offsetHeight));
  }, [hole]);

  // Move focus into the card on every step so screen readers announce it.
  useEffect(() => {
    cardRef.current?.focus();
  }, [step.id]);

  // Esc skips, arrow keys move between steps, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onSkip();
      } else if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onBack();
      } else if (e.key === 'Tab' && cardRef.current) {
        const focusable = [...cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        const inside = cardRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, onBack, onNext, onSkip]);

  const dim = alpha(theme.palette.mode === 'dark' ? '#000000' : '#141A12', theme.palette.mode === 'dark' ? 0.7 : 0.58);
  const zIndex = theme.zIndex.modal + 1;
  const transition = reduceMotion ? 'none' : 'top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease, opacity 160ms ease';

  // Rendered straight into <body> (not MUI Portal, which mounts a render later) so focus can move in immediately.
  return createPortal(
    <>
      {/* Blocks the page while the tour is open; the spotlight's shadow does the dimming. */}
      <Box aria-hidden sx={{ position: 'fixed', inset: 0, zIndex, bgcolor: hole ? 'transparent' : dim }} />
      {hole && (
        <Box
          aria-hidden
          data-testid="tour-spotlight"
          sx={{
            position: 'fixed',
            zIndex,
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            borderRadius: 3,
            pointerEvents: 'none',
            boxShadow: `0 0 0 2px ${theme.palette.primary.light}, 0 0 0 9999px ${dim}`,
            transition,
          }}
        />
      )}
      <Paper
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        elevation={8}
        data-testid="tour-card"
        sx={{
          position: 'fixed',
          zIndex: zIndex + 1,
          width: `min(360px, calc(100vw - ${GUTTER * 2}px))`,
          p: 2.5,
          borderRadius: 3,
          outline: 'none',
          '&:focus-visible': { boxShadow: `0 0 0 3px ${theme.palette.primary.main}` },
          ...(hole
            ? { top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0, transition }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
        }}
      >
        <Typography variant="overline" component="p" sx={{ color: 'text.secondary' }}>
          Step {index + 1} of {total}
        </Typography>
        <Typography id={titleId} variant="h3" component="h2" sx={{ mt: 0.25, mb: 1 }}>
          {step.title}
        </Typography>
        <Typography id={bodyId} variant="body2" sx={{ color: 'text.primary' }}>
          {step.body}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, mt: 2 }} aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <Box key={i} sx={{ height: 4, flex: 1, borderRadius: 2, bgcolor: i <= index ? 'primary.main' : 'divider', transition: reduceMotion ? 'none' : 'background-color 160ms ease' }} />
          ))}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          {!isLast && (
            <Button size="small" onClick={onSkip} sx={{ color: 'text.secondary', px: 1, minWidth: 0 }}>
              Skip tour
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {index > 0 && (
            <Button size="small" variant="outlined" onClick={onBack} startIcon={<ArrowLeft size={16} />}>
              Back
            </Button>
          )}
          <Button size="small" variant="contained" onClick={onNext} endIcon={isLast ? <Check size={16} /> : <ArrowRight size={16} />}>
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </Stack>
      </Paper>
    </>,
    document.body,
  );
}
