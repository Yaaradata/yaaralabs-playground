import type { BBox, Detection, TimelineEvent, TrackedObject } from './types';
import { canonicalClass, classesCompatible } from './labels';

const IOU_LOW = 0.14;
const HIGH_SCORE = 0.3;
const QUICK_SPAWN = 0.32;
const COAST_MS = 820;
const LOST_AFTER_MS = 1100;
const REACQUIRE_MS = 3600;
const MAX_SPEED = 2100;
const HANDHELDS = new Set(['cell phone', 'cup', 'book', 'bottle', 'remote', 'laptop', 'mouse', 'keyboard']);
const PERSON_LABELS = new Set(['person', 'man', 'woman', 'boy', 'girl', 'human body']);
const HOLD_OVERLAP = 0.22;
const HAND_FALSE_POSITIVES = new Set([
  'cup',
  'wine glass',
  'bottle',
  'cell phone',
  'remote',
  'mouse',
  'sports ball',
  'apple',
  'orange',
  'banana',
  'donut',
  'teddy bear',
]);

export function isPersonClass(name: string): boolean {
  return PERSON_LABELS.has(canonicalClass(name));
}

export function isHandFalsePositiveClass(name: string): boolean {
  return HAND_FALSE_POSITIVES.has(name.trim().toLowerCase());
}

export function isBodyPartClass(name: string): boolean {
  const key = name.trim().toLowerCase();
  return key.startsWith('human ') && !isPersonClass(key);
}

const EVENT_COOLDOWN_MS = 4500;

let eventSeq = 0;

function nextEventId(): string {
  eventSeq += 1;
  return `evt-${eventSeq}`;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

export function iou(a: BBox, b: BBox): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

export function boxCoverage(inner: BBox, outer: BBox): number {
  const ax2 = inner[0] + inner[2];
  const ay2 = inner[1] + inner[3];
  const bx2 = outer[0] + outer[2];
  const by2 = outer[1] + outer[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(inner[0], outer[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(inner[1], outer[1]));
  const area = inner[2] * inner[3];
  return area > 0 ? (ix * iy) / area : 0;
}

export function sameObjectBoxes(a: BBox, b: BBox, person = false): boolean {
  const overlap = iou(a, b);
  if (boxCoverage(a, b) > 0.5 || boxCoverage(b, a) > 0.5) return true;
  if (overlap >= (person ? 0.28 : 0.32)) return true;
  const ax = a[0] + a[2] / 2;
  const ay = a[1] + a[3] / 2;
  const bx = b[0] + b[2] / 2;
  const by = b[1] + b[3] / 2;
  const dist = Math.hypot(ax - bx, ay - by);
  const span = Math.max(Math.min(a[2], b[2]), Math.min(a[3], b[3]));
  return dist < span * 0.38;
}

function center(bbox: BBox): { cx: number; cy: number } {
  return { cx: bbox[0] + bbox[2] / 2, cy: bbox[1] + bbox[3] / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clipBox(box: BBox, width: number, height: number): BBox {
  let [x, y, w, h] = box;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > width) w = width - x;
  if (y + h > height) h = height - y;
  return [x, y, Math.max(0, w), Math.max(0, h)];
}

function lerpBox(from: BBox, to: BBox, amount: number): BBox {
  const rest = 1 - amount;
  return [
    from[0] * rest + to[0] * amount,
    from[1] * rest + to[1] * amount,
    from[2] * rest + to[2] * amount,
    from[3] * rest + to[3] * amount,
  ];
}

function predictBox(track: TrackedObject, now: number, frameSize?: { width: number; height: number }): BBox {
  const dt = Math.max(0, Math.min(0.32, (now - track.lastSeenAt) / 1000));
  const width = Math.max(6, track.bbox[2] + track.vw * dt);
  const height = Math.max(6, track.bbox[3] + track.vh * dt);
  const next: BBox = [track.cx + track.vx * dt - width / 2, track.cy + track.vy * dt - height / 2, width, height];
  return frameSize ? clipBox(next, frameSize.width, frameSize.height) : next;
}

function pairScore(
  track: TrackedObject,
  detection: Detection,
  predicted: BBox,
  frameSize: { width: number; height: number }
): number {
  const overlap = iou(predicted, detection.bbox);
  const { cx, cy } = center(detection.bbox);
  const predictedCenter = center(predicted);
  const diag = Math.hypot(frameSize.width, frameSize.height) || 1;
  const dist = Math.hypot(predictedCenter.cx - cx, predictedCenter.cy - cy) / diag;
  const areaA = Math.max(1, predicted[2] * predicted[3]);
  const areaB = Math.max(1, detection.bbox[2] * detection.bbox[3]);
  const sizeRatio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  const sameClass = classesCompatible(track.className, detection.class);
  if (isPersonClass(track.className) !== isPersonClass(detection.class)) return -1;
  if (!sameClass && overlap < 0.52) return -1;
  if (overlap < IOU_LOW && dist > 0.2) return -1;
  return (
    overlap * 1.4 +
    (1 - Math.min(1, dist)) * 0.22 +
    sizeRatio * 0.12 +
    (sameClass ? 0.2 : 0) +
    (track.present ? 0.05 : 0)
  );
}

function withArticle(name: string, colorName?: string | null): string {
  const label = formatLabel(name);
  const phrase = colorName ? `${colorName} ${label}` : label;
  if (isPersonClass(label)) return colorName ? `a ${phrase}` : 'a person';
  if (label.endsWith('s') && !label.endsWith('ss')) return phrase;
  if (/^[aeiou]/i.test(phrase)) return `an ${phrase}`;
  return `a ${phrase}`;
}

function sideOfPerson(objectCx: number, person: TrackedObject, mirrored: boolean): 'left' | 'right' {
  const isRight = objectCx >= person.cx;
  const visualRight = mirrored ? !isRight : isRight;
  return visualRight ? 'right' : 'left';
}

export class ObjectMemory {
  tracks: TrackedObject[] = [];
  private nextId = 1;
  private lastEventAt = new Map<string, number>();
  uniqueClasses = new Set<string>();
  totalTracksCreated = 0;
  private pendingSpawns = new Map<string, { hits: number; lastAt: number; detection: Detection & { rawName: string } }>();

  resetLivePresence(): void {
    this.pendingSpawns.clear();
    this.tracks = [];
  }

  update(
    detections: Detection[],
    now: number,
    frameSize: { width: number; height: number },
    colors: Record<string, string | null>,
    mirrored: boolean
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const usedTrack = new Set<string>();
    const usedDet = new Set<number>();
    const frameH = Math.max(1, frameSize.height);
    const canonicalDetections = detections.map((detection) => ({
      ...detection,
      class: canonicalClass(detection.class),
      rawName: detection.class,
    }));

    const high = canonicalDetections
      .map((detection, index) => ({ detection, index }))
      .filter((item) => item.detection.score >= HIGH_SCORE);
    const low = canonicalDetections
      .map((detection, index) => ({ detection, index }))
      .filter((item) => item.detection.score < HIGH_SCORE);

    const assign = (
      candidates: { detection: Detection & { rawName: string }; index: number }[],
      minScore: number
    ) => {
      const pairs: { index: number; track: TrackedObject; score: number }[] = [];
      candidates.forEach(({ detection, index }) => {
        if (usedDet.has(index)) return;
        for (const track of this.tracks) {
          if (usedTrack.has(track.id)) continue;
          if (!track.present && now - track.lastSeenAt > REACQUIRE_MS) continue;
          const score = pairScore(track, detection, predictBox(track, now, frameSize), frameSize);
          if (score >= minScore) pairs.push({ index, track, score });
        }
      });
      pairs.sort((a, b) => b.score - a.score);
      pairs.forEach((pair) => {
        if (usedDet.has(pair.index) || usedTrack.has(pair.track.id)) return;
        const detection = canonicalDetections[pair.index];
        this.applyDetection(pair.track, detection, detection.rawName, colors[`${detection.rawName}-${pair.index}`], now, frameSize);
        usedDet.add(pair.index);
        usedTrack.add(pair.track.id);
      });
    };

    assign(high, 0.32);
    assign(low, 0.42);
    assign(high, 0.22);

    canonicalDetections.forEach((detection, index) => {
      if (usedDet.has(index)) return;
      if (this.hasDuplicateTrack(detection)) return;
      const spawnFloor = this.spawnFloor(detection.class);
      if (detection.score < spawnFloor) return;
      const key = this.pendingKey(detection);
      const pending = this.pendingSpawns.get(key);
      const quick = detection.score >= QUICK_SPAWN;
      if (!quick) {
        const nextHits = pending && now - pending.lastAt < 420 ? pending.hits + 1 : 1;
        this.pendingSpawns.set(key, { hits: nextHits, lastAt: now, detection });
        if (nextHits < 2) return;
      }
      this.pendingSpawns.delete(key);
      const { cx, cy } = center(detection.bbox);
      const colorName = colors[`${detection.rawName}-${index}`] ?? null;
      const track: TrackedObject = {
        id: `obj-${this.nextId}`,
        className: detection.class,
        displayName: detection.rawName !== detection.class ? detection.rawName : null,
        colorName,
        bbox: detection.bbox,
        score: detection.score,
        cx,
        cy,
        vx: 0,
        vy: 0,
        vw: 0,
        vh: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        missingFrames: 0,
        present: true,
        held: false,
      };
      this.nextId += 1;
      this.totalTracksCreated += 1;
      this.uniqueClasses.add(detection.class);
      this.tracks.push(track);
      usedTrack.add(track.id);
      if (!isHandFalsePositiveClass(detection.class)) {
        this.pushAction(
          events,
          now,
          `enter-${detection.class}`,
          isPersonClass(detection.class)
            ? 'Person entered frame'
            : `${formatLabel(detection.rawName || detection.class)} appeared in frame`,
          2800
        );
      }
    });

    this.tracks.forEach((track) => {
      if (usedTrack.has(track.id)) return;
      track.missingFrames += 1;
      const age = now - track.lastSeenAt;
      if (age < COAST_MS) {
        track.bbox = predictBox(track, now, frameSize);
        track.present = true;
        return;
      }
      if (!track.present || age < LOST_AFTER_MS) return;
      track.present = false;
      track.held = false;
      this.pushAction(
        events,
        now,
        `leave-${(track.displayName || track.className).toLowerCase()}`,
        isPersonClass(track.displayName || track.className)
          ? 'Person left the frame'
          : `${formatLabel(track.displayName || track.className)} left the frame`,
        2800
      );
    });

    const people = this.tracks.filter(
      (track) => track.present && isPersonClass(track.displayName || track.className)
    );
    const uniquePeople = people.filter(
      (person, index) =>
        !people.some(
          (other, otherIndex) =>
            otherIndex < index && sameObjectBoxes(person.bbox, other.bbox, true)
        )
    );
    const objects = this.tracks.filter(
      (track) =>
        track.present &&
        !isPersonClass(track.displayName || track.className) &&
        !isBodyPartClass(track.className)
    );

    objects.forEach((object) => {
      const wasHeld = object.held;
      const holder = this.findHolder(object, uniquePeople);
      const bestOverlap = holder ? boxCoverage(object.bbox, holder.bbox) : 0;
      const held = Boolean(holder && bestOverlap >= HOLD_OVERLAP);
      const rise = object.vy / frameH;
      object.held = held;

      if (!wasHeld && held && holder) {
        const hand = sideOfPerson(object.cx, holder, mirrored);
        if (rise < -0.18) {
          this.pushAction(
            events,
            now,
            `pick-${object.id}`,
            `${hand === 'right' ? 'Right' : 'Left'} hand picked up ${withArticle(object.displayName || object.className, object.colorName)}`
          );
        } else {
          this.pushAction(
            events,
            now,
            `hold-${object.id}`,
            `Person is holding ${withArticle(object.displayName || object.className, object.colorName)}`
          );
        }
      } else if (wasHeld && !held) {
        const nearTable = objects.some(
          (other) =>
            other.id !== object.id &&
            (other.className.includes('table') || other.className === 'chair' || other.className === 'bed')
        );
        this.pushAction(
          events,
          now,
          `down-${object.id}`,
          nearTable
            ? `${formatLabel(object.displayName || object.className)} placed on table`
            : `Person put down ${withArticle(object.displayName || object.className, object.colorName)}`
        );
      } else if (!held && Math.abs(rise) > 0.22) {
        this.pushAction(
          events,
          now,
          `move-${object.id}`,
          `Person is moving ${withArticle(object.displayName || object.className, object.colorName)}`
        );
      }

      if (holder && !held && bestOverlap < 0.08) {
        const dx = Math.abs(object.cx - holder.cx) / Math.max(1, holder.bbox[2]);
        if (dx > 0.55 && dx < 1.35) {
          const hand = sideOfPerson(object.cx, holder, mirrored);
          this.pushAction(
            events,
            now,
            `point-${object.id}`,
            `Person is pointing at ${withArticle(object.displayName || object.className, object.colorName)} on the ${hand}`
          );
        }
      }
    });

    if (uniquePeople.length >= 2) {
      objects.forEach((object) => {
        const overlappingPeople = uniquePeople.filter((person) => boxCoverage(object.bbox, person.bbox) > 0.12);
        if (overlappingPeople.length >= 2) {
          this.pushAction(
            events,
            now,
            `hand-${object.id}`,
            `Person is handing ${withArticle(object.displayName || object.className, object.colorName)} to another person`
          );
        }
      });
    }

    this.pendingSpawns.forEach((pending, key) => {
      if (now - pending.lastAt > 500) this.pendingSpawns.delete(key);
    });

    this.mergeOverlappingTracks();

    return events;
  }

  applyVisionLabels(vision: { name: string; score: number; bbox: BBox }[]): void {
    if (!vision.length) return;
    const used = new Set<string>();
    vision.forEach((item) => {
      const name = item.name.trim();
      if (!name || item.bbox[2] < 8 || item.bbox[3] < 8) return;
      const canonical = canonicalClass(name);
      let best: TrackedObject | null = null;
      let bestScore = 0.35;
      for (const track of this.tracks) {
        if (!track.present || used.has(track.id)) continue;
        if (isPersonClass(track.className) && !isPersonClass(canonical)) continue;
        const score = iou(track.bbox, item.bbox);
        if (score > bestScore) {
          best = track;
          bestScore = score;
        }
      }
      if (!best) return;
      used.add(best.id);
      if (isPersonClass(best.className) && !isPersonClass(canonical)) return;
      best.className = canonical;
      best.displayName = isPersonClass(canonical) ? null : name;
      best.score = Math.max(best.score, item.score);
      this.uniqueClasses.add(canonical);
    });
  }

  liveDetections(): Detection[] {
    return this.tracks
      .filter((track) => track.present)
      .map((track) => ({
        class: track.displayName || track.className,
        score: track.score,
        bbox: track.bbox,
      }));
  }

  private mergeOverlappingTracks(): void {
    const present = this.tracks.filter((track) => track.present).sort((a, b) => b.score - a.score);
    const drop = new Set<string>();
    present.forEach((track, index) => {
      if (drop.has(track.id)) return;
      present.slice(index + 1).forEach((other) => {
        if (drop.has(other.id)) return;
        if (!classesCompatible(track.className, other.className)) return;
        if (!sameObjectBoxes(track.bbox, other.bbox, isPersonClass(track.className))) return;
        drop.add(other.id);
        other.present = false;
        other.held = false;
        other.missingFrames = 8;
        other.lastSeenAt = 0;
      });
    });
  }

  private applyDetection(
    track: TrackedObject,
    detection: Detection,
    rawName: string,
    colorName: string | null | undefined,
    now: number,
    frameSize: { width: number; height: number }
  ): void {
    const { cx, cy } = center(detection.bbox);
    const dt = Math.max(0.02, Math.min(0.25, (now - track.lastSeenAt) / 1000));
    const jump = Math.hypot(cx - track.cx, cy - track.cy);
    const blend = jump > Math.max(16, track.bbox[2] * 0.55) ? 0.84 : Math.min(0.88, 0.5 + detection.score * 0.4);
    track.vx = clamp(track.vx * 0.58 + ((cx - track.cx) / dt) * 0.42, -MAX_SPEED, MAX_SPEED);
    track.vy = clamp(track.vy * 0.58 + ((cy - track.cy) / dt) * 0.42, -MAX_SPEED, MAX_SPEED);
    track.vw = clamp(track.vw * 0.6 + ((detection.bbox[2] - track.bbox[2]) / dt) * 0.4, -900, 900);
    track.vh = clamp(track.vh * 0.6 + ((detection.bbox[3] - track.bbox[3]) / dt) * 0.4, -900, 900);
    track.bbox = clipBox(lerpBox(track.bbox, detection.bbox, blend), frameSize.width, frameSize.height);
    track.score = track.score * 0.32 + detection.score * 0.68;
    track.className = detection.class;
    if (isPersonClass(detection.class)) {
      track.displayName = null;
    } else if (rawName && canonicalClass(rawName) !== rawName.trim().toLowerCase()) {
      track.displayName = rawName;
    }
    const nextCenter = center(track.bbox);
    track.cx = nextCenter.cx;
    track.cy = nextCenter.cy;
    track.lastSeenAt = now;
    track.missingFrames = 0;
    track.present = true;
    if (colorName) track.colorName = colorName;
  }

  private hasDuplicateTrack(detection: Detection): boolean {
    return this.tracks.some(
      (track) =>
        track.present &&
        classesCompatible(track.className, detection.class) &&
        sameObjectBoxes(track.bbox, detection.bbox, isPersonClass(detection.class))
    );
  }

  private spawnFloor(className: string): number {
    if (isPersonClass(className)) return 0.26;
    if (HANDHELDS.has(className)) return 0.2;
    return 0.22;
  }

  private pendingKey(detection: Detection): string {
    const { cx, cy } = center(detection.bbox);
    return `${detection.class}:${Math.round(cx / 48)}:${Math.round(cy / 48)}`;
  }

  private findHolder(object: TrackedObject, people: TrackedObject[]): TrackedObject | null {
    let holder: TrackedObject | null = null;
    let bestOverlap = 0;
    for (const person of people) {
      const overlap = boxCoverage(object.bbox, person.bbox);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        holder = person;
      }
    }
    return holder;
  }

  private pushAction(
    events: TimelineEvent[],
    now: number,
    key: string,
    text: string,
    cooldownMs = EVENT_COOLDOWN_MS
  ): void {
    const last = this.lastEventAt.get(key) ?? 0;
    if (now - last < cooldownMs) return;
    this.lastEventAt.set(key, now);
    events.push({ id: nextEventId(), at: now, kind: 'action', text });
  }
}

export function withArticleName(name: string, colorName?: string | null): string {
  const label = formatLabel(name);
  const phrase = colorName ? `${colorName} ${label}` : label;
  if (isPersonClass(label)) return 'a person';
  if (label.endsWith('s') && !label.endsWith('ss')) return phrase;
  if (/^[aeiou]/i.test(phrase)) return `an ${phrase}`;
  return `a ${phrase}`;
}
