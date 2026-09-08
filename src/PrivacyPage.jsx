import React, { useEffect } from 'react';
import { CloudRain, Mail, Mic, ShieldCheck, Trophy, Users } from 'lucide-react';

const updatedAt = 'June 20, 2026';
const contactEmail = 'hungry4grace@gmail.com';

export default function PrivacyPage() {
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

  return (
    <main className="privacy-page">
      <section className="privacy-hero">
        <a className="privacy-brand" href="/" aria-label="VerseRain home">
          <CloudRain size={34} />
          <span>VerseRain</span>
        </a>
        <p className="privacy-kicker">Privacy Policy</p>
        <h1>We collect only what helps VerseRain work.</h1>
        <p className="privacy-lede">
          VerseRain is a scripture memorization game. This policy explains what information is used for
          accounts, gameplay, multiplayer rooms, custom verse sets, voice recitation, and support.
        </p>
        <p className="privacy-updated">Last updated: {updatedAt}</p>
      </section>

      <section className="privacy-grid" aria-label="Privacy highlights">
        <article>
          <ShieldCheck size={24} />
          <h2>No advertising tracking</h2>
          <p>We do not sell personal information, and we do not use third-party advertising trackers.</p>
        </article>
        <article>
          <Mic size={24} />
          <h2>Voice is optional</h2>
          <p>Microphone and speech recognition are used only when you choose voice recitation modes.</p>
        </article>
        <article>
          <Trophy size={24} />
          <h2>Gameplay data powers progress</h2>
          <p>Scores, clears, verse activity, and garden progress are used to run the game and leaderboards.</p>
        </article>
        <article>
          <Users size={24} />
          <h2>Multiplayer data is shared in rooms</h2>
          <p>Display names, room state, and team results may be visible to other players in the same game.</p>
        </article>
      </section>

      <section className="privacy-content">
        <PolicySection title="Information we collect">
          <p>Depending on how you use VerseRain, we may collect or process:</p>
          <ul>
            <li>Account information, such as your display name, email address, login status, and verification state.</li>
            <li>Gameplay information, such as selected verses, scores, completed challenges, streaks, garden progress, and leaderboard entries.</li>
            <li>Custom content you choose to create or publish, such as custom verse sets, titles, descriptions, and author names.</li>
            <li>Multiplayer information, such as room codes, team selections, player names, game progress, and results.</li>
            <li>Approximate location information when you use the player map or when location-based features are enabled.</li>
            <li>Technical information, such as IP address, browser or device type, logs, crash signals, and basic usage events needed to operate and secure the service.</li>
          </ul>
        </PolicySection>

        <PolicySection title="Microphone and speech recognition">
          <p>
            VerseRain asks for microphone and speech recognition permission only when you choose a voice
            recitation mode. Speech input is used to compare your spoken recitation with the selected verse
            and to score the practice session. You can avoid these permissions by using non-voice game modes.
          </p>
        </PolicySection>

        <PolicySection title="How we use information">
          <ul>
            <li>To provide scripture practice, challenge modes, multiplayer rooms, leaderboards, and progress features.</li>
            <li>To save your garden, custom sets, account settings, referrals, and gameplay history.</li>
            <li>To detect errors, prevent abuse, protect the service, and improve performance.</li>
            <li>To respond to support requests and communicate with you about your account or the service.</li>
            <li>To satisfy legal, security, and App Store review obligations.</li>
          </ul>
        </PolicySection>

        <PolicySection title="Sharing and third-party services">
          <p>We use service providers to host and operate VerseRain. These providers may process information for us only as needed to provide their services.</p>
          <ul>
            <li>Hosting, serverless APIs, and deployment infrastructure.</li>
            <li>Realtime multiplayer and shared game state services.</li>
            <li>Database and storage services for scores, accounts, gardens, custom sets, and app data.</li>
            <li>Speech recognition, text-to-speech, maps, geocoding, Bible text, and font services when those features are used or loaded.</li>
            <li>
              <strong>LINE Login</strong> (LINE Corporation) — used as an optional sign-in method. When you
              choose to log in with LINE, we receive your LINE display name and, if you grant permission, your
              email address from LINE. LINE's privacy policy applies to their handling of your
              data: <a href="https://line.me/en/terms/policy/" target="_blank" rel="noreferrer">https://line.me/en/terms/policy/</a>
            </li>
          </ul>
          <p>We may also disclose information if required by law, to protect users, or to protect the integrity of VerseRain.</p>
        </PolicySection>

        <PolicySection title="Public and shared content">
          <p>
            Some parts of VerseRain are designed to be visible to others, including leaderboard display names,
            scores, published custom verse sets, shared rooms, referral links, and garden-related progress.
            Please avoid using sensitive personal information in display names or public custom content.
          </p>
        </PolicySection>

        <PolicySection title="Children and families">
          <p>
            VerseRain can be used by families, classrooms, and church groups. Children should use VerseRain
            with a parent, guardian, teacher, or ministry leader. If you believe a child has provided personal
            information without appropriate permission, contact us and we will review the request.
          </p>
        </PolicySection>

        <PolicySection title="Data choices and deletion">
          <p>
            You may request access, correction, or deletion of personal information associated with your
            account or display name. Some leaderboard, security, backup, or legal records may be retained
            where necessary to operate the service, prevent abuse, or comply with obligations.
          </p>
        </PolicySection>

        <PolicySection title="Security and retention">
          <p>
            We use reasonable technical and organizational measures to protect information. No online service
            can be guaranteed to be perfectly secure. We keep information for as long as needed to provide
            VerseRain, maintain records, resolve disputes, enforce terms, and meet legal obligations.
          </p>
        </PolicySection>

        <PolicySection title="International users">
          <p>
            VerseRain is operated online and may process information in countries other than your own. By
            using VerseRain, you understand that information may be transferred and processed where our
            service providers operate.
          </p>
        </PolicySection>

        <PolicySection title="Changes to this policy">
          <p>
            We may update this privacy policy as VerseRain changes. When we do, we will update the date at
            the top of this page. Continued use of VerseRain after an update means the updated policy applies.
          </p>
        </PolicySection>

        <section className="privacy-contact" aria-label="Contact">
          <Mail size={24} />
          <div>
            <h2>Contact</h2>
            <p>
              Questions or privacy requests can be sent to{' '}
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}

function PolicySection({ title, children }) {
  return (
    <section className="privacy-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
