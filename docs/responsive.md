# Responsive layout: one sizing system and an automated screen test

Branch `feat/responsive`. Goal: every page of the Playground looks like the same design on every
laptop, monitor and cloud desktop the Nuvama executives use, and a test proves it.

The size a page gets is the **CSS viewport**: screen resolution ÷ Windows display scaling ÷ browser
zoom, minus the browser chrome and taskbar. A 1920×1080 laptop is 1280×600 at 150 %, 1536×740 at
125 % and 1920×950 at 100 %. That, not the laptop model, is why the same page looks cramped on one
machine and empty on another.

## A. The test matrix

Inner viewport (what the page really gets) and device pixel ratio. 1-9 must look right; 10-13 must be
usable (no cut-off content, no horizontal scroll). Every run uses classic 17 px scrollbars, as on
Windows.

| # | Device and setting | Inner viewport | DPR |
|---|---|---|---|
| 1 | 1920×1080 at 150 % | 1280×600 | 1.5 |
| 2 | 1920×1200 at 150 % / 2560×1600 at 200 % | 1280×680 | 1.5 |
| 3 | 1366×768 at 100 % (budget laptop, projector) | 1366×640 | 1 |
| 4 | MacBook Air / Pro default | 1440×790 | 2 |
| 5 | 1920×1080 at 125 % (most common Windows laptop) | 1536×740 | 1.25 |
| 6 | 1600×900 at 100 % | 1600×780 | 1 |
| 7 | 2560×1440 at 150 % | 1707×840 | 1.5 |
| 8 | 1920×1080 monitor at 100 % | 1920×950 | 1 |
| 9 | 2560×1440 at 100 % / 4K at 150 % | 2560×1300 | 1 |
| 10 | Window snapped to half of 1920 | 960×950 | 1 |
| 11 | Small window / XGA projector | 1024×640 | 1 |
| 12 | Browser zoom 125 % on #5 | 1229×592 | 1.25 |
| 13 | Browser zoom 90 % on #3 | 1518×711 | 0.9 |

## B. Audit: why pages differ across the matrix

Counted in `frontend/app` and `frontend/components` (Scratch editor excluded) on `main` at 391e7f6.

1. **Two sizing systems.** Tailwind sizes are `rem`, but the labs' component CSS is `px`: about
   8,000 `px` values in 31 files. The biggest are `Exercises/labs/exercise4` (1,264),
   `Exercise02.css` (1,088), `RuleBasedProcess/ruleBasedProcess.css` (574), `RagChatbot` (476),
   `AiAgent` (321), `ConfusionMatrix` (294), `RulesBot` (284), `CopilotLab` (244), `LiveObjectDetection`
   (189) and `AgentStudio` (45). Tailwind classes add 65 arbitrary `[Npx]` values. Anything in `px`
   stays the same size while the rest of the page doesn't, so a page mixes a scaling header with a
   fixed lab.
2. **Text below projector size.** Component CSS sets `font-size` under 13.5 px about 950 times (most
   often 10.5-12.5 px), and Tailwind `text-xs` (12 px) appears 160 times. At 150 % scaling on a
   projector these are the first things nobody can read.
3. **Fixed width caps.** `max-w-4xl` (18×), `max-w-7xl` (9×), `max-w-6xl` (5×), `max-w-5xl` (4×). On a
   1920 or 2560 monitor the content sits in a 1280 px strip with wide empty bands on both sides, while
   inner `justify-between` (80×) pushes the items inside it to its far edges.
4. **Viewport heights.** About 100 `vh` / `h-screen` / `min-h-screen` uses (labs' CSS: `exercise4`
   11, `Exercise02` 9, `RagChatbot` 5; pages: the project page 6, `make` 5, `train` and `learn` 3
   each). On a 600-680 px tall viewport a `100vh` panel plus the 88 px header pushes the main button
   below the fold; on tall monitors fixed heights leave empty space under the content. `100vh` also
   ignores the browser's own UI on some laptops.
5. **Fixed column counts.** 72 `grid-cols-N` against 11 `auto-fit` / `auto-fill`. A wide screen
   stretches the same N columns wider instead of fitting more.
6. **Headings that don't scale down.** 29 uses of `text-4xl` or larger. At 1280×600 they wrap to three
   lines and take a third of the screen.
7. **`html, body { height: 100% }` with `overflow: auto` on both.** The page scrolls inside `body`,
   not the window. That's fine for users, but tools that measure the page (and full-page
   screenshots) see one viewport; the test accounts for it.

## C. The sizing system

(filled in by part C)

## Decision: the same arrangement at every size (from the review, 15 Oct)

A page keeps the layout it has on a 1920×1080 screen at every window size: it gets smaller, it
doesn't rearrange. The Rule Based Process board (and Use the AI, which reuses it) used to stack the
block palette on top of the board below 1080 px wide; now palette | board | Aria stay side by side,
the palette is `clamp(180px, 18vw, 260px)`, Aria's panel `clamp(260px, 26vw, 380px)` (inside the
drag-to-resize limits) and the board takes the rest. At 870 px: 180 | 430 | 260, no horizontal
scroll. The same rule applies to every page in part E: no breakpoint that turns columns into a stack
within the test matrix.
