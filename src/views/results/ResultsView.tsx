import { useMemo } from 'react';
import { Backdrop } from '../../components/Backdrop';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { CoupeIcon, Ornament } from '../../components/Ornament';
import { RulesCard } from '../../components/RulesCard';
import { StoryButton } from '../../components/StoryButton';
import { formatDate } from '../../lib/format';
import { useGame } from '../../lib/hooks';
import { href } from '../../lib/router';
import { computeResults, type Results } from '../../lib/scoring';
import type { Game, GameStatus } from '../../lib/types';
import { count, isDefaultGameName, ResultsFooter, SectionHeading, useDocumentTitle } from './parts';
import { Podium } from './Podium';
import { RankingList } from './RankingList';
import { AwardsSection, CategoriesSection, StatsSection } from './Sections';
import './results.css';

/** Publik resultatsida – visas först när prisutdelningen är klar. */
export function ResultsView({ gameId }: { gameId: string }) {
  const game = useGame(gameId);
  const finished = game?.meta.status === 'finished';
  const results = useMemo(() => (game && finished ? computeResults(game) : null), [game, finished]);

  useDocumentTitle(game && finished ? `Resultat · ${game.meta.name} · Bonjour Babes` : 'Resultat · Bonjour Babes');

  if (game === undefined) return <Loading full text="Hämtar resultaten…" />;
  if (game === null) return <NotFound />;
  if (!finished || !results) return <NotYet status={game.meta.status} />;
  return <FinishedResults game={game} gameId={gameId} results={results} />;
}

function FinishedResults({ game, gameId, results }: { game: Game; gameId: string; results: Results }) {
  const date = formatDate(game.meta.createdAt || game.meta.finishedAt || 0);
  const participants = Object.keys(game.players).length;
  const hasAwards = results.awards.some((a) => a.winners.length > 0);

  return (
    <>
      <Backdrop bubbles={14} />
      <main className="page page--wide res">
        <header className="res-hero fade-up">
          <a href={href('/')} className="res-hero__logo" aria-label="Bonjour Babes – till startsidan">
            <Logo size="md" />
          </a>
          <Ornament width={260} />
          <div className="eyebrow">Les résultats</div>
          <h1 className="res-hero__title">{isDefaultGameName(game.meta.name) ? 'Kvällens resultat' : game.meta.name}</h1>
          <p className="res-hero__meta">
            {date && <span>{date}</span>}
            <span>{count(participants, 'deltagare', 'deltagare')}</span>
            <span>{count(results.totalVotes, 'betyg', 'betyg')}</span>
          </p>
        </header>

        {results.ranking.length > 0 ? (
          <>
            <section className="res-section res-section--podium fade-up" style={{ animationDelay: '0.08s' }} aria-labelledby="res-podium-title">
              <h2 id="res-podium-title" className="res-podium-title">
                Le Podium
              </h2>
              <Podium ranking={results.ranking} />
              <div className="res-share">
                <StoryButton game={game} gameId={gameId} results={results} className="res-share__btn" />
                <p className="hint">En snygg bild med prispallen – perfekt för din story.</p>
              </div>
            </section>

            <section className="res-section fade-up" style={{ animationDelay: '0.16s' }} aria-labelledby="res-ranking">
              <SectionHeading eyebrow="Le classement" title="Alla placeringar" id="res-ranking">
                <p className="res-heading__sub">Tryck på en drink för betyg per kategori, domarnas poäng och kommentarer.</p>
              </SectionHeading>
              <RankingList game={game} ranking={results.ranking} />
            </section>

            <div className="res-columns">
              {(game.settings.awardsEnabled || hasAwards) && <AwardsSection results={results} />}
              {results.categoryWinners.length > 0 && <CategoriesSection results={results} />}
            </div>

            {results.totalVotes > 0 && <StatsSection game={game} results={results} />}
          </>
        ) : (
          <div className="card card--deco res-empty">
            <p className="italic muted">Inga drinkar tävlade den här kvällen.</p>
          </div>
        )}

        <details className="res-rules">
          <summary className="res-rules__summary">
            <span className="eyebrow">Les règles</span>
            <span className="res-rules__title">Så räknades poängen</span>
            <span className="res-rules__chev" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </summary>
          <div className="res-rules__body">
            <RulesCard trimExtremes={game.settings.trimExtremes} awardsEnabled={game.settings.awardsEnabled} />
          </div>
        </details>

        <ResultsFooter />
      </main>
    </>
  );
}

const WAIT_TEXT: Record<Exclude<GameStatus, 'finished'>, string> = {
  lobby: 'Kvällen har inte börjat än – snart dags att skaka !',
  running: 'Tävlingen pågår just nu. Bonne chance à tous !',
  awards: 'Specialpriserna röstas fram just nu.',
  ceremony: 'Prisutdelningen pågår – håll ögonen på storskärmen 🥁',
};

function NotYet({ status }: { status: GameStatus }) {
  const text = status === 'finished' ? '' : WAIT_TEXT[status];
  return (
    <>
      <Backdrop bubbles={12} />
      <main className="page res res-wait">
        <a href={href('/')} className="res-hero__logo fade-up" aria-label="Bonjour Babes – till startsidan">
          <Logo size="lg" />
        </a>
        <Ornament />
        <div className="card card--deco card--gold res-wait__card fade-up" style={{ animationDelay: '0.1s' }}>
          <CoupeIcon size={56} className="res-wait__icon float" />
          <h1 className="res-wait__title">Resultaten visas efter prisutdelningen ✨</h1>
          {text && <p className="muted">{text}</p>}
          <p className="hint res-wait__hint">
            <span className="res-wait__dot" aria-hidden="true" />
            Sidan uppdateras automatiskt
          </p>
        </div>
        <a className="btn btn--ghost btn--block fade-up" style={{ animationDelay: '0.2s' }} href={href('/')}>
          Till startsidan
        </a>
      </main>
    </>
  );
}

function NotFound() {
  return (
    <>
      <Backdrop bubbles={8} />
      <main className="page res res-wait">
        <a href={href('/')} className="res-hero__logo fade-up" aria-label="Bonjour Babes – till startsidan">
          <Logo size="lg" />
        </a>
        <Ornament />
        <div className="card card--deco res-wait__card fade-up">
          <h1 className="res-wait__title">Hittade inga resultat</h1>
          <p className="muted">Länken verkar inte stämma – eller så har kvällen raderats. Pardon !</p>
        </div>
        <div className="stack fade-up" style={{ animationDelay: '0.1s' }}>
          <a className="btn btn--gold btn--block" href={href('/hall-of-fame')}>
            🏆 Hall of Fame
          </a>
          <a className="btn btn--ghost btn--block" href={href('/')}>
            Till startsidan
          </a>
        </div>
      </main>
    </>
  );
}
