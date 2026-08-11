// netlify/functions/availability.js
//
// Returns already-booked time ranges for a given date (YYYY-MM-DD),
// read from the "reservation" Netlify Form's submissions, with a
// 30-minute cleaning buffer already added after each one. The
// front-end (index.html) uses this to hide slots that would overlap
// an existing appointment, instead of blindly spacing every slot
// 30 minutes apart regardless of whether anything is actually booked.
//
// Requires two site environment variables, set in the Netlify
// dashboard under Site settings → Environment variables:
//   NETLIFY_API_TOKEN — a Personal Access Token
//                        (User settings → Applications → New access token)
//   NETLIFY_SITE_ID   — this site's API ID
//                        (Site settings → General → Site details → Site ID)
// Both are configured as of 2026-08-11. Netlify Forms itself also had
// to be turned on for the site (Site configuration → Forms) — it was
// off, which is why earlier form submissions never reached Netlify
// regardless of the front-end code.
//
// Nothing here needs npm install / a build step — it only uses the
// native `fetch` available in Netlify's Node 18+ function runtime.

const CLEAN_BUFFER_MIN = 30;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  const date = event.queryStringParameters && event.queryStringParameters.date;
  if (!date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing date' }) };
  }

  const token = process.env.NETLIFY_API_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;

  // Backend not configured yet — fail soft so the reservation form
  // keeps working (just without live availability filtering) rather
  // than break for visitors.
  if (!token || !siteId) {
    return { statusCode: 200, headers, body: JSON.stringify({ busy: [], configured: false }) };
  }

  try {
    const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!formsRes.ok) throw new Error(`forms fetch failed: ${formsRes.status}`);
    const forms = await formsRes.json();
    const form = forms.find((f) => f.name === 'reservation');

    if (!form) {
      return { statusCode: 200, headers, body: JSON.stringify({ busy: [], configured: true }) };
    }

    const subsRes = await fetch(
      `https://api.netlify.com/api/v1/forms/${form.id}/submissions?per_page=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!subsRes.ok) throw new Error(`submissions fetch failed: ${subsRes.status}`);
    const submissions = await subsRes.json();

    const busy = [];
    for (const sub of submissions) {
      if (sub.spam === true || sub.state === 'spam') continue;
      const data = sub.data || {};
      if (data.date !== date) continue;
      const range = parseRange(data.creneau);
      if (!range) continue;
      busy.push({ start: range.start, end: range.end + CLEAN_BUFFER_MIN });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ busy, configured: true }) };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ busy: [], configured: true, error: true })
    };
  }
};

// "14h à 15h30" -> { start: 840, end: 930 } (minutes since midnight)
function parseRange(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})h(\d{2})?\s*à\s*(\d{1,2})h(\d{2})?/);
  if (!m) return null;
  const start = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  const end = parseInt(m[3], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
  return { start, end };
}
