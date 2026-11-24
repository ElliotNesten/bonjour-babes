import { Backdrop } from '../../components/Backdrop';
import { Loading } from '../../components/Loading';
import { useIsAdmin } from '../../lib/admin';
import { AdminLogin } from './AdminLogin';
import { Dashboard } from './Dashboard';
import { AdminFeedback } from './feedback';
import { GameControl } from './GameControl';
import './admin.css';

/**
 * Adminpanelen (värdens mobil):
 *   #/admin          → inloggning / lista spel
 *   #/admin/:gameId  → styr ett spel
 */
export function AdminView({ gameId }: { gameId?: string }) {
  const isAdmin = useIsAdmin();
  if (isAdmin === undefined) return <Loading full text="Bonsoir…" />;
  return (
    <AdminFeedback>
      <Backdrop bubbles={8} />
      {!isAdmin ? <AdminLogin /> : gameId ? <GameControl key={gameId} gameId={gameId} /> : <Dashboard />}
    </AdminFeedback>
  );
}
