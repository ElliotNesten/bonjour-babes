import { useEffect, type ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { Ornament } from '../../components/Ornament';
import { href } from '../../lib/router';

/** "1 röst" / "7 röster" */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** ["Leo", "Oscar", "Wilma"] → "Leo, Oscar & Wilma" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** true om kvällen heter som appen ("Bonjour Babes") – då upprepar vi inte namnet under logotypen. */
export function isDefaultGameName(name: string): boolean {
  return /^\s*bonjour\s*babes\s*$/i.test(name);
}

/** Sätter flikens titel medan vyn visas. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Sektionsrubrik: fransk överrubrik + svensk rubrik + ornament. */
export function SectionHeading({ eyebrow, title, id, children }: { eyebrow: string; title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="res-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h2 id={id} className="res-heading__title">
        {title}
      </h2>
      {children}
      <Ornament width={180} className="res-heading__ornament" />
    </div>
  );
}

/** Sidfot med länkar. */
export function ResultsFooter({ showHallOfFame = true }: { showHallOfFame?: boolean }) {
  return (
    <footer className="res-footer">
      <Ornament width={220} />
      <nav className="res-footer__links" aria-label="Fler sidor">
        {showHallOfFame && <a href={href('/hall-of-fame')}>🏆 Hall of Fame</a>}
        <a href={href('/')}>🥂 Startsida</a>
      </nav>
      <p className="res-footer__sign script">Merci & santé !</p>
    </footer>
  );
}

export interface MiniPodiumEntry {
  key: string;
  rank: number;
  name: string;
  emoji: string;
  color: string;
}

/** Liten prispall (2–1–3) med avatarer – för Hall of Fame. */
export function MiniPodium({ entries, label }: { entries: MiniPodiumEntry[]; label?: string }) {
  const top = entries.slice(0, 3);
  return (
    <ol className="res-mini" aria-label={label ?? 'Prispall'}>
      {top.map((e, pos) => {
        const rank = Math.min(3, Math.max(1, e.rank));
        return (
          <li key={e.key} className={`res-mini__col res-mini__col--p${pos} res-medal--${rank}`}>
            <Avatar emoji={e.emoji} color={e.color} size={pos === 0 ? 34 : 28} title={`${e.rank}. ${e.name}`} />
            <span className="res-mini__block" aria-hidden="true">
              {e.rank}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
