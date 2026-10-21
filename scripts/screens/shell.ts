/**
 * Chrome for the static screenshot pages: a stand-in for the Shopify admin frame plus the
 * Polaris web components the app renders into. Close enough for marketing shots; the real
 * admin supplies its own styling for the s-* elements.
 */
export const SHELL_CSS = String.raw`
  .shot, .shot * { box-sizing: border-box; }
  /* Scoped to .shot so these styles can be embedded in any host page. */
  .shot {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: #303030;
    background: #f1f1f1;
    -webkit-font-smoothing: antialiased;
  }
  .shot__bar {
    display: flex; align-items: center; gap: 8px;
    height: 44px; padding: 0 14px;
    background: #1a1a1a; color: #e3e3e3; font-size: 12.5px;
  }
  .shot__dots { display: flex; gap: 6px; margin-right: 6px; }
  .shot__dots i { width: 10px; height: 10px; border-radius: 50%; background: #4a4a4a; }
  .shot__url {
    flex: 1; max-width: 460px; text-align: center;
    background: #2b2b2b; border-radius: 6px; padding: 4px 10px; color: #b5b5b5;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .shot__nav {
    display: flex; gap: 2px; align-items: center;
    padding: 10px 20px; background: #fff; border-bottom: 1px solid #e3e3e3;
  }
  .shot__nav a {
    font-size: 13px; font-weight: 550; color: #616161; text-decoration: none;
    padding: 6px 10px; border-radius: 8px;
  }
  .shot__nav a[aria-current] { background: #f1f1f1; color: #15161a; }
  .shot__body { padding: 24px 20px 40px; }

  /* ---- Polaris stand-ins ---- */
  s-page { display: block; max-width: 1000px; margin: 0 auto; }
  s-page::before {
    content: attr(heading);
    display: block;
    font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #15161a;
    margin-bottom: 16px;
  }
  s-section {
    display: block; background: #fff; border: 1px solid #e3e3e3; border-radius: 12px;
    padding: 16px; margin-bottom: 16px;
    box-shadow: 0 1px 0 rgba(0,0,0,.04);
  }
  s-section[heading]::before {
    content: attr(heading);
    display: block; font-size: 14px; font-weight: 650; color: #15161a; margin-bottom: 10px;
  }
  s-section[slot="aside"] { background: #fafafa; }
  s-paragraph { display: block; font-size: 13.5px; line-height: 1.55; color: #4a4a4a; }
  s-paragraph + s-paragraph { margin-top: 6px; }
  s-heading { display: block; font-size: 13px; font-weight: 650; color: #15161a; margin: 10px 0 6px; }
  s-link { color: #2f6bff; text-decoration: none; cursor: pointer; }

  s-badge {
    display: inline-flex; align-items: center;
    font-size: 12px; font-weight: 550; line-height: 1;
    padding: 4px 8px; border-radius: 999px;
    background: #ebebeb; color: #4a4a4a;
  }
  s-badge[tone="success"] { background: #cdfee1; color: #0c5132; }
  s-badge[tone="info"]    { background: #ebf1ff; color: #00527c; }
  s-badge[tone="warning"] { background: #ffd6a4; color: #5e4200; }
  s-badge[tone="critical"]{ background: #ffd6d6; color: #8e1f0b; }
  s-badge[tone="caution"] { background: #ffeb9c; color: #5e4200; }
  s-badge[tone="neutral"] { background: #ebebeb; color: #4a4a4a; }

  s-banner {
    display: block; border-radius: 10px; padding: 12px 14px; margin: 12px 0;
    background: #f1f1f1; border-left: 4px solid #8a8a8a;
  }
  s-banner[heading]::before {
    content: attr(heading);
    display: block; font-weight: 650; font-size: 13px; color: #15161a; margin-bottom: 4px;
  }
  s-banner[tone="success"]  { background: #e6f6ec; border-left-color: #0c5132; }
  s-banner[tone="info"]     { background: #ebf1ff; border-left-color: #2f6bff; }
  s-banner[tone="critical"] { background: #fdecea; border-left-color: #c70a24; }
  s-banner s-paragraph { color: #303030; }
  s-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #d5d5d5; border-top-color: #15161a; border-radius: 50%; }
`;

export function shell(args: { title: string; url: string; nav: string; body: string; appCss: string }) {
  const navLinks = [
    ["Overview", "/app"],
    ["Compare themes", "/app/themes"],
  ]
    .map(([label, href]) => `<a href="${href}"${label === args.nav ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");

  return `<section class="shot">
  <div class="shot__bar">
    <span class="shot__dots"><i></i><i></i><i></i></span>
    <span class="shot__url">${args.url}</span>
  </div>
  <div class="shot__nav">${navLinks}</div>
  <div class="shot__body">${args.body}</div>
</section>`;
}
