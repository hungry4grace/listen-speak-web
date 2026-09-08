import React, { useEffect } from 'react';
import { CloudRain, Mail, Trash2, ShieldCheck, Clock } from 'lucide-react';

const contactEmail = 'hungry4grace@gmail.com';
const updatedAt = 'June 15, 2026';

export default function DeleteAccountPage() {
  useEffect(() => {
    const root = document.getElementById('root');
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousRootOverflow = root?.style.overflow || '';
    const previousRootHeight = root?.style.height || '';
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    if (root) {
      root.style.overflow = 'visible';
      root.style.height = 'auto';
    }
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (root) {
        root.style.overflow = previousRootOverflow;
        root.style.height = previousRootHeight;
      }
    };
  }, []);

  const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent('Delete my VerseRain account')}&body=${encodeURIComponent(
    'Please delete my VerseRain account and associated data.\n\nAccount email (the one I sign in with): \nDisplay name (if you remember it): \n'
  )}`;

  return (
    <main className="privacy-page">
      <section className="privacy-hero">
        <a className="privacy-brand" href="/" aria-label="VerseRain home">
          <CloudRain size={34} />
          <span>VerseRain</span>
        </a>
        <p className="privacy-kicker">Account &amp; Data Deletion</p>
        <h1>Delete your VerseRain account</h1>
        <p className="privacy-lede">
          VerseRain 經文雨 (developer: Hope of Glory) lets you request deletion of your
          account and the personal data associated with it. This page explains how.
        </p>
        <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>Last updated: {updatedAt}</p>
      </section>

      <section className="privacy-section">
        <h2><Mail size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />How to request deletion</h2>
        <p>
          Email <a href={mailto}>{contactEmail}</a> from — or mentioning — the email
          address you use to sign in to VerseRain, with the subject
          &ldquo;Delete my VerseRain account&rdquo;. Include your account email (and
          display name if you know it) so we can locate the right account.
        </p>
        <p>
          <a href={mailto} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <Trash2 size={18} /> Request account deletion by email
          </a>
        </p>
        <p style={{ opacity: 0.8, fontSize: '0.92rem' }}>
          If you signed in with Google, Apple, or LINE, email us from any address and
          tell us which social login and display name you used, and we will match your
          account.
        </p>
      </section>

      <section className="privacy-section">
        <h2><Trash2 size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />What gets deleted</h2>
        <p>When we process your request, we permanently delete:</p>
        <ul>
          <li>Your account record and email address</li>
          <li>Your display name and profile details (city/country if set)</li>
          <li>Game progress: scores, streaks, garden/fruit, verse activity, and leaderboard entries tied to you</li>
          <li>Custom verse sets you created</li>
          <li>Your user-generated content in Cloud Family / Teams: reflections, prayers, and cheer notes</li>
          <li>Push-notification subscriptions and device identifiers</li>
        </ul>
      </section>

      <section className="privacy-section">
        <h2><ShieldCheck size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />What may be kept</h2>
        <p>
          We may retain records we are legally required to keep, and anonymized or
          aggregated statistics that no longer identify you (for example, a team&rsquo;s
          total weekly point count with your personal entries removed). This retained
          data cannot be used to identify you.
        </p>
      </section>

      <section className="privacy-section">
        <h2><Clock size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />How long it takes</h2>
        <p>
          We complete deletion requests within <strong>30 days</strong> and email you to
          confirm when it is done. You can also request deletion of only part of your
          data (for example, a specific reflection or your custom sets) without deleting
          your whole account — just say so in your email.
        </p>
      </section>

      <section className="privacy-section">
        <p style={{ opacity: 0.75 }}>
          Questions about your data? Contact us any time at{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. See also our{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
    </main>
  );
}
