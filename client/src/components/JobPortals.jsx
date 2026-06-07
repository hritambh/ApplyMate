import { useState } from 'react';
import jobPortals from '../config/jobPortals.json';

// Everything on this page is driven by ../config/jobPortals.json.
// Each portal: { name, url, tags: [..], logo?: "https://..." }
//  - A portal listed under several tags appears in each of those subsections.
//  - `logo` is optional; when omitted we fall back to the site's favicon.
// To add, remove, retag, or re-logo a portal, edit that file — no UI changes needed.
export default function JobPortals() {
  const portals = Array.isArray(jobPortals?.portals) ? jobPortals.portals : [];

  // Group portals by tag, preserving the order tags are first seen.
  const sectionOrder = [];
  const byTag = new Map();
  for (const portal of portals) {
    const tags = Array.isArray(portal.tags) && portal.tags.length ? portal.tags : ['other'];
    for (const tag of tags) {
      if (!byTag.has(tag)) {
        byTag.set(tag, []);
        sectionOrder.push(tag);
      }
      byTag.get(tag).push(portal);
    }
  }

  return (
    <section className="card">
      <h3>Job Portals</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Quick links to popular job boards, grouped by category. Open one to browse openings, then add
        the companies and HR contacts back here in ApplyMate.
      </p>

      {portals.length === 0 ? (
        <p className="muted">No job portals configured yet.</p>
      ) : (
        sectionOrder.map((tag) => (
          <div className="portal-section" key={tag}>
            <h4 className="portal-section-title">
              {formatTag(tag)} <span className="muted small">({byTag.get(tag).length})</span>
            </h4>
            <div className="portal-grid">
              {byTag.get(tag).map((portal) => (
                <a
                  key={`${tag}-${portal.url}`}
                  className="portal-card"
                  href={portal.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <PortalLogo portal={portal} />
                  <span className="portal-meta">
                    <span className="portal-name">{portal.name}</span>
                    <span className="portal-host muted small">{hostOf(portal.url)}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function PortalLogo({ portal }) {
  const [errored, setErrored] = useState(false);
  const host = hostOf(portal.url);
  const src = portal.logo || `https://www.google.com/s2/favicons?sz=64&domain=${host}`;

  if (errored || !host) {
    return (
      <span className="portal-logo portal-logo-fallback" aria-hidden="true">
        {(portal.name || '?').charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="portal-logo"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

function formatTag(tag) {
  return String(tag)
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
