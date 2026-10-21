# Build prompt — ThemeMerge marketing website

Paste everything below the line into your site-building tool (v0, Lovable, Claude, Cursor…).
Replace the two bracketed placeholders first: `[INSTALL_URL]` and `[CONTACT_EMAIL]`.

---

You are a senior product designer and front-end engineer. Build a modern, animated marketing
website for **ThemeMerge**, a Shopify app for theme developers and agencies.

## 1. The product, truthfully

**The problem.** An agency duplicates a merchant's live theme to build a redesign. While they
work, the merchant keeps editing the live theme in the theme editor — new homepage sections, a
campaign banner, changed settings. When the redesign is ready, publishing it silently destroys
every one of those edits. Today the only fixes are to redo the client's work by hand, or to
diff theme files manually and hope nothing was missed.

**What ThemeMerge does.** It compares the live theme and the working copy against the snapshot
taken when the copy was made, so it knows exactly what *each side* changed. Then it merges:

- **Theme-editor JSON merges key by key**, not as text. `templates/*.json`, section groups and
  `settings_data.json` merge structurally, so the section the client added and the section you
  added both survive.
- **Ordered arrays merge as ordered sets.** A template's `order` and a section's `block_order`
  keep both sides' additions in a sensible order instead of one side winning.
- **Liquid, CSS and JS merge line by line** with a three-way diff3 merge.
- **Only genuine conflicts are surfaced** — the same key or the same lines changed on both
  sides. You resolve them per conflict, per file, or by editing the result by hand.

**The outcome.** Four ways to ship, and the live theme is never written by the app:

1. **Download full theme** — every file of the merged theme as a zip. Upload under Online Store
   → Themes → Add theme → Upload zip file; Shopify creates a new unpublished theme.
2. **Download changed files** — just the diff plus a `MERGE-REPORT.md` with the exact
   `shopify theme push --only …` command.
3. **Create merged theme** — duplicates the working copy and writes the merged result into the
   duplicate, leaving the original untouched.
4. **Apply to working copy** — writes into the copy, after snapshotting it for rollback.

**Who it's for.** Shopify theme developers, freelancers and agencies who hand themes back to
clients who keep editing them. Not merchants. Write for people who know what Liquid, a
three-way merge and `shopify theme push` are — respect that and don't over-explain.

**Safety is a selling point, not a footnote.** The published theme is never written. Every
target theme is snapshotted before a write. Nothing runs automatically — a person reviews a
file-by-file diff and clicks. Only files that differ are touched.

## 2. Honesty constraints — do not overstate

- Writing theme files requires Shopify's **Online Store protected scope exemption**, reviewed
  per app. Until it is granted, the two Apply buttons are disabled and the export route is how
  you ship. **Do not build the site around "one click and it's live."** Lead with compare →
  decide → **export a merged theme**, and present in-app apply as the follow-on. A small
  honest line beats a claim that breaks on first use.
- Do not invent metrics, customer logos, testimonials, star ratings or "trusted by N agencies".
  If a section needs social proof, build the slot and fill it with a clearly-marked placeholder.
- Do not claim App Store availability unless the CTA actually leads there.

## 3. Brand

The logo is an **M** built from two thick rounded strokes meeting in one vertical stem: an
orange stroke (the live theme) and a blue stroke (the working copy) resolving into a single ink
stem (the merged result). **This is the whole design system in one glyph — make the site live
inside that metaphor.** Two things converging into one should be the recurring visual idea:
in the hero, in section transitions, in diagram framing.

```
Orange  #ff7a1a   the live theme / the client's edits
Blue    #2f6bff   the working copy / your work
Ink     #15161a   the merged result, primary text, primary buttons
```

Supporting neutrals — pick these deliberately, slightly cool-biased toward the blue, not pure
grey: ground `#f4f6f9`, surface `#ffffff`, hairline `#dfe3ea`, muted text `#5a6170`.
Semantic colors for diffs stay conventional and separate from the brand: additions green
`#0c5132` on `#e6f6ec`, deletions red `#8e1f0b` on `#fdecea`.

Build a full dark theme too, with the same care — agencies browse dev tools at night. Dark
ground `#0e1014`, surface `#161920`, hairline `#2a2f3a`, text `#e8eaef`. Both brand colors must
stay legible on both grounds; desaturate slightly in dark rather than swapping hues.

**Colour discipline:** orange and blue are *semantic* here — they always mean live vs copy.
Never use them decoratively on unrelated elements, or the metaphor stops reading.

**Typography.** Pair a characterful geometric or grotesque display face with a clean body face,
and use a real monospace for all code, file paths, theme names and data — code is this
product's subject matter, so the mono face should be good and used confidently at reasonable
size, not shrunk to 11px. Avoid Inter as the display face; it is the default everyone reaches
for. Set a clear type scale, keep running text near 65 characters, balance headings.

## 4. Voice

Direct, technical, unhurried. Short declarative sentences. Name things the way a developer
would. No exclamation marks, no "revolutionary", no "effortlessly", no emoji as bullets.
Concrete beats clever: "Merges `templates/index.json` key by key" lands harder than
"Intelligent merging".

Headline direction — pick or adapt, don't use all:
- "Publish your theme without losing the client's edits."
- "They kept editing. You kept building. Ship both."
- "A real three-way merge for Shopify themes."

Subhead: "ThemeMerge compares the live theme and your working copy against the moment you
forked, merges theme-editor JSON key by key and Liquid line by line, and leaves only the real
conflicts for you to decide."

## 5. Pages

### Home (the main effort)

1. **Hero.** Headline, subhead, primary CTA "Install on your store" → `[INSTALL_URL]`,
   secondary "See how it works" → anchor. The hero's right side (or full-bleed background on
   mobile) carries **the signature animation** — see §6.
2. **The problem.** A short, sharply-written scenario: three beats showing the client editing
   live while the agency builds on a copy, ending in the moment publishing wipes it out. This
   should sting a little for the target reader.
3. **How it works** — four steps, scroll-driven, each with a visual:
   *Record the baseline* → *Compare* → *Decide the conflicts* → *Ship the merged theme*.
4. **What makes the merge real.** Three or four cards, each with a small live code/JSON
   demonstration rather than an icon: structural JSON merge, ordered-set arrays, diff3 for
   Liquid/CSS/JS, binary assets handled by checksum.
5. **Product screenshots.** A browser-framed gallery or tabbed walkthrough of the actual app
   UI. Assets are provided — see §8.
6. **Safety.** Live theme never written, pre-write snapshots, rollback, nothing automatic,
   only changed files touched. Quiet, confident, not alarmist.
7. **FAQ.** Does it work without the theme-write permission? What happens to binary assets?
   What if there's no baseline? Does it touch products or orders? (No — it reads and writes
   themes only, with just two scopes: `read_themes`, `write_themes`.) Can I undo?
8. **Final CTA.**

### How it works (deeper page)
Long-form, documentation-flavoured but still designed. The three-way model explained with a
proper diagram; what three-way vs timestamp attribution means and why recording the baseline
matters; worked examples of each merge type with real file content; the export paths.

### Pricing
Build the page and layout even if plans aren't decided — placeholder tiers clearly marked.
Agencies will look for it; a missing pricing page reads as unfinished.

### Docs / Getting started
Install, record a baseline, run the first compare, export and upload. Code blocks with a copy
button. Mention the Shopify CLI push path.

### Legal — required for a public Shopify app
Privacy policy and terms pages, reachable from the footer. State plainly: ThemeMerge stores
theme files, snapshots and merge decisions; it does **not** access customer, order or product
data; data is deleted on uninstall and redact. Contact `[CONTACT_EMAIL]`.

## 6. Animation — the point of difference

Animation must *demonstrate the product*, never decorate. Every motion should encode the same
idea: two divergent things becoming one correct thing.

**Signature hero animation (build this well; it carries the site).**
Two vertical columns of code lines, orange-tinted on the left (live theme) and blue-tinted on
the right (working copy). They scroll gently out of sync. On load, the columns converge toward
the centre and interleave line by line into a single ink-coloured merged column — lines sliding
into their final positions, one or two pausing and flashing as conflicts before resolving. It
should read instantly as "two versions became one file" even with the sound off, and it should
echo the shape of the logo's two strokes meeting in a stem. Loop it slowly, or replay on
scroll-back-into-view.

**Scroll-driven merge diagram.** As the How-it-works section scrolls, draw a fork: one trunk
splits into an orange branch and a blue branch, commits appear along each, then the branches
converge into a single node. Use scroll progress to drive the drawing, not a fixed timer.

**Interactive conflict demo.** The strongest conversion moment on the page: a real conflict the
visitor resolves themselves. Show `templates/index.json` with the client's `countdown` section
and the developer's `reviews` section, plus one genuine clash — the hero heading changed on
both sides. Let them click **Live** or **Copy** on that clash and watch the merged result
pane update live. No signup, no modal. Let people feel the product in ten seconds.

**Micro-interactions.** Diff lines stagger in as they enter the viewport. Conflict pills pulse
once, then settle. Buttons have a confident press state. The logo mark animates its two strokes
drawing in, then the stem, on first load only.

**Discipline.** Respect `prefers-reduced-motion` — provide a static but still composed version
of every animated element. Nothing should block reading. No parallax on text. No scroll-jacking.
Target 60fps: animate `transform` and `opacity`, not layout properties.

## 7. Technical

- Static-friendly stack: Next.js or Astro, TypeScript, Tailwind. Framer Motion or GSAP
  ScrollTrigger for the choreographed pieces; CSS for micro-interactions.
- Fully responsive, 360px to ultrawide. The hero animation needs a genuine mobile composition —
  stack the two columns vertically rather than shrinking the desktop version.
- Accessibility is not optional: semantic landmarks, visible focus rings, AA contrast in both
  themes, the interactive demo operable by keyboard, `aria-label`s on icon-only controls.
- Performance budget: LCP under 2.5s. Self-host fonts, subset them, inline critical CSS, lazy
  load the screenshot gallery.
- SEO: unique title and meta description per page, Open Graph image using the logo and the
  hero headline, `SoftwareApplication` structured data on Home, sitemap and robots.

## 8. Assets

- The logo mark is three SVG strokes — reuse the exact paths so the site and app match:
  ```svg
  <svg viewBox="0 0 100 100" fill="none">
    <path d="M18 82 V32 L50 62" stroke="#ff7a1a" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M82 82 V32 L50 62" stroke="#2f6bff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M50 62 V82" stroke="#15161a" stroke-width="16" stroke-linecap="round"/>
  </svg>
  ```
- Product screenshots: seven screens covering overview, theme picker, merge review, JSON
  conflict, code conflict, ready-to-ship, and merged-theme-created.
- Real sample content for any code block on the site — use genuine Shopify theme file shapes
  (`templates/index.json` with `sections` and `order`, `assets/base.css`,
  `layout/theme.liquid`), never `foo`/`bar` placeholders.

## 9. Do not

- Do not use a purple-to-blue gradient hero, a floating 3D blob, or generic SaaS illustration.
- Do not use emoji as section icons or bullets.
- Do not centre every section; vary the rhythm.
- Do not put an accent-coloured left rail on every rounded card.
- Do not write feature names that describe the implementation ("webhook-driven sync"); describe
  what the developer gets.
- Do not add a cookie banner, chat widget, or newsletter modal.
