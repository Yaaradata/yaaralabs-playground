'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { ExerciseIntroPack, IntroSlide, IntroSlideContent } from './types';
import LabBuddy from '../labBuddy';
import '../labBuddy/labBuddy.css';
import './ExerciseIntro.css';

function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function formatExerciseLabel(id: number): string {
  if (Number.isInteger(id)) return String(id);
  return String(id);
}

function OverviewBlock({ content }: { content: Extract<IntroSlideContent, { kind: 'overview' }> }) {
  const cols = Math.min(5, Math.max(2, content.stages.length));
  return (
    <div className="ex-intro-body">
      <p className="ex-intro-goal">{content.goal}</p>
      <h4 className="ex-intro-h">Here are the stages you’ll go through</h4>
      <div className="ex-intro-stages" style={{ ['--ex-intro-cols' as string]: String(cols) } as CSSProperties}>
        {content.stages.map((item) => (
          <div key={item.n} className="ex-intro-stage">
            <span className="ex-intro-n">{item.n}</span>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsBlock({ content }: { content: Extract<IntroSlideContent, { kind: 'cards' }> }) {
  return (
    <div className="ex-intro-body">
      {content.heading ? <h4 className="ex-intro-h">{content.heading}</h4> : null}
      <div className="ex-intro-cards">
        {content.cards.map((card) => (
          <div key={card.title} className="ex-intro-card">
            <strong>{card.title}</strong>
            <p>{card.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineBlock({ content }: { content: Extract<IntroSlideContent, { kind: 'pipeline' }> }) {
  return (
    <div className="ex-intro-body">
      {content.heading ? <h4 className="ex-intro-h">{content.heading}</h4> : null}
      <div className="ex-intro-pipe-list">
        {content.items.map((item, index) => (
          <div key={item.title} className="ex-intro-pipe-item">
            <span className="ex-intro-n">{index + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskBlock({ content }: { content: Extract<IntroSlideContent, { kind: 'task' }> }) {
  return (
    <div className="ex-intro-body">
      <div className="ex-intro-cards ex-intro-eval">
        <div className="ex-intro-card ex-intro-task">
          <strong>Your task</strong>
          <p>{content.task}</p>
        </div>
      </div>
      <h4 className="ex-intro-h">Conclusion</h4>
      <div className="ex-intro-cards">
        {content.conclusions.map((item) => (
          <div key={item.title} className="ex-intro-card">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideContent({ content }: { content: IntroSlideContent }) {
  switch (content.kind) {
    case 'overview':
      return <OverviewBlock content={content} />;
    case 'cards':
      return <CardsBlock content={content} />;
    case 'pipeline':
      return <PipelineBlock content={content} />;
    case 'task':
      return <TaskBlock content={content} />;
    default: {
      const _never: never = content;
      return _never;
    }
  }
}

function SlideArticle({ slide }: { slide: IntroSlide }) {
  return (
    <article className="ex-intro-slide">
      <h3>{slide.title}</h3>
      <p className="ex-intro-lead">{slide.body}</p>
      <SlideContent content={slide.content} />
    </article>
  );
}

export type ExerciseIntroDeckProps = {
  open: boolean;
  pack: ExerciseIntroPack;
  index: number;
  onIndex: (n: number) => void;
  onClose: () => void;
  onStart?: () => void;
};

/** Shared Ex2-style multi-slide introduction popup. */
export default function ExerciseIntroDeck({
  open,
  pack,
  index,
  onIndex,
  onClose,
  onStart,
}: ExerciseIntroDeckProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const ignoreScrollRef = useRef(false);
  const slides = pack.slides;
  const last = Math.max(0, slides.length - 1);
  const safeIndex = Math.min(Math.max(0, index), last);

  const slideAt = useCallback(
    (n: number) => viewportRef.current?.querySelectorAll<HTMLElement>('.ex-intro-slide')[n] ?? null,
    [],
  );

  const scrollToIndex = useCallback(
    (n: number, behavior: ScrollBehavior = 'smooth') => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      ignoreScrollRef.current = true;
      viewport.scrollTo({ left: n * viewport.clientWidth, behavior });
      slideAt(n)?.scrollTo({ top: 0 });
      window.setTimeout(() => {
        ignoreScrollRef.current = false;
      }, 420);
    },
    [slideAt],
  );

  useEffect(() => {
    if (!open) return;
    if (index !== safeIndex) {
      onIndex(safeIndex);
      return;
    }
    const frame = window.requestAnimationFrame(() => scrollToIndex(safeIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [index, onIndex, open, safeIndex, scrollToIndex]);

  useEffect(() => {
    if (!open) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      const dy = event.shiftKey ? 0 : event.deltaY;
      if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 2) {
        event.preventDefault();
        viewport.scrollLeft += dx;
        return;
      }
      const slide = slideAt(safeIndex);
      if (!slide || Math.abs(dy) <= 1) return;
      const atTop = slide.scrollTop <= 1;
      const atBottom = slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 2;
      if ((dy > 0 && !atBottom) || (dy < 0 && !atTop)) {
        event.preventDefault();
        slide.scrollTop += dy;
        return;
      }
      event.preventDefault();
      viewport.scrollLeft += dy;
    };
    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      const width = viewport.clientWidth || 1;
      const next = Math.min(last, Math.max(0, Math.round(viewport.scrollLeft / width)));
      if (next !== safeIndex) onIndex(next);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [last, onIndex, open, safeIndex, slideAt]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onIndex(Math.max(0, safeIndex - 1));
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        if (safeIndex >= last) onStart?.();
        else onIndex(Math.min(last, safeIndex + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose, onIndex, onStart, open, safeIndex]);

  if (!open || !slides.length) return null;

  const go = (delta: number) => {
    if (delta < 0) onIndex(Math.max(0, safeIndex - 1));
    else onIndex(Math.min(last, safeIndex + 1));
  };

  return (
    <div className="ex-intro-back" role="presentation" onClick={onClose}>
      <div className="ex-intro-shell" onClick={(event) => event.stopPropagation()}>
        <button
          className="ex-intro-arrow prev"
          type="button"
          aria-label="Previous slide"
          disabled={safeIndex <= 0}
          onClick={() => go(-1)}
        >
          <ArrowLeft />
        </button>
        <div className="ex-intro-modal" role="dialog" aria-modal="true" aria-label="Exercise introduction">
          <button className="ex-intro-close" type="button" onClick={onClose} aria-label="Close introduction">
            ✕
          </button>
          <div className="ex-intro-brand">
            <LabBuddy mood={safeIndex >= last ? 'cheer' : 'idle'} size={52} className="ex-intro-buddy" label="Lab buddy" />
            <span className="ex-intro-badge">EXERCISE {formatExerciseLabel(pack.exerciseId)}</span>
            <span className="ex-intro-sub">{pack.subtitle}</span>
            <span className="ex-intro-pill">
              {safeIndex === 0 ? 'Intro' : `Slide ${safeIndex + 1} of ${slides.length}`}
            </span>
          </div>
          <div className="ex-intro-viewport" ref={viewportRef}>
            {slides.map((slide, slideIndex) => (
              <SlideArticle key={`${slideIndex}-${slide.title}`} slide={slide} />
            ))}
          </div>
          <div className="ex-intro-foot">
            <div className="ex-intro-dots" role="tablist" aria-label="Introduction slides">
              {slides.map((slide, slideIndex) => (
                <button
                  key={`${slideIndex}-${slide.title}`}
                  className={`ex-intro-dot${slideIndex === safeIndex ? ' on' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={slideIndex === safeIndex}
                  aria-label={`Slide ${slideIndex + 1}: ${slide.title}`}
                  onClick={() => onIndex(slideIndex)}
                />
              ))}
            </div>
            {safeIndex >= last && onStart ? (
              <button className="ex-intro-start" type="button" onClick={onStart}>
                Start the lab
              </button>
            ) : null}
          </div>
        </div>
        <button
          className="ex-intro-arrow next"
          type="button"
          aria-label={safeIndex >= last ? 'Start the lab' : 'Next slide'}
          onClick={() => {
            if (safeIndex >= last) {
              onStart?.();
              return;
            }
            go(1);
          }}
        >
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}
