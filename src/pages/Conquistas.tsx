import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Award, CalendarCheck, Flame, HeartPulse, Lock, Medal, Sparkles, Star, Trophy } from 'lucide-react';
import { Header } from '../components/ui';
import { ProgressRing } from '../components/planning/ui';
import { useAuthStore } from '../store/auth';
import { useProgressStore } from '../store/progress';
import { useTier } from '../lib/useTier';
import { LIMITS } from '../lib/billing';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, levelFor, pointsOf, type AchievementGroup } from '../lib/achievements';
import { activeDaysStreak, currentStreak, longestStreak, perfectDaysBetween } from '../lib/streaks';
import { addDaysToKey, formatShortDate } from '../lib/dates';
import { HEALTH_MIN_ENTRIES } from '../lib/health';
import { buildAchievementContext, buildHealth, useSnapshot } from '../lib/derived';
import '../styles/planning.css';

const GROUP_ORDER: AchievementGroup[] = ['rotina', 'metas', 'financas', 'agenda'];

/** Conquistas, nível, sequências e saúde financeira. */
export default function Conquistas() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const tier = useTier(user?.id);
  const financeAccess = tier !== 'loading' && LIMITS[tier].finance;
  const unlocked = useProgressStore((s) => s.achievements);
  const snapshot = useSnapshot(financeAccess);
  const { today, data } = snapshot;

  const health = useMemo(() => buildHealth(snapshot), [snapshot]);
  const context = useMemo(() => buildAchievementContext(snapshot, health?.score ?? null), [snapshot, health]);
  const points = pointsOf(Object.keys(unlocked));
  const level = levelFor(points);
  const unlockedCount = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;

  const generalStreak = activeDaysStreak(data.habits, today);
  const bestStreak = Math.max(0, ...data.habits.map((h) => Math.max(longestStreak(h.doneDates), currentStreak(h.doneDates, today))));
  const perfect30 = perfectDaysBetween(data.habits, addDaysToKey(today, -29), today).length;

  return (
    <div className="screen">
      <Header title="Conquistas" subtitle="Sequências, nível e saúde financeira" />
      <div className="screen-stack">
        <motion.section className="hero-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="level-card">
            <div className="level-badge" aria-label={`Nível ${level.level}`}><span>Nível</span><strong>{level.level}</strong></div>
            <div className="grow" style={{ display: 'grid', gap: 6 }}>
              <span className="eyebrow">{level.name}</span>
              <div className="stat-line">{points}<small>pontos</small></div>
              <div className="track" style={{ height: 8 }}><motion.div className="fill" initial={{ width: 0 }} animate={{ width: `${Math.round(level.ratio * 100)}%` }} transition={{ duration: 0.7 }} /></div>
              <span className="text-2" style={{ fontSize: 12 }}>{level.next === null ? 'Nível máximo. Lenda!' : `Faltam ${level.next - points} pontos para o nível ${level.level + 1}`}</span>
            </div>
          </div>
        </motion.section>

        <div className="tiles">
          <div className="tile">
            <span className="tile-icon warn"><Flame size={16} /></span>
            <span className="tile-value">{generalStreak}</span>
            <span className="tile-label">{generalStreak === 1 ? 'dia seguido' : 'dias seguidos'} com algum hábito feito</span>
          </div>
          <div className="tile">
            <span className="tile-icon"><Medal size={16} /></span>
            <span className="tile-value">{bestStreak}</span>
            <span className="tile-label">melhor sequência num hábito</span>
          </div>
          <div className="tile">
            <span className="tile-icon blue"><CalendarCheck size={16} /></span>
            <span className="tile-value">{perfect30}</span>
            <span className="tile-label">dias perfeitos nos últimos 30</span>
          </div>
          <div className="tile">
            <span className="tile-icon"><Trophy size={16} /></span>
            <span className="tile-value">{unlockedCount}/{ACHIEVEMENTS.length}</span>
            <span className="tile-label">conquistas desbloqueadas</span>
          </div>
        </div>

        <div className="section-head">
          <div>
            <div className="section-title">Saúde financeira</div>
            <div className="section-hint">Nota de 0 a 100, atualizada com seus lançamentos</div>
          </div>
          <HeartPulse size={18} color="var(--accent)" />
        </div>
        {!financeAccess ? (
          <button type="button" className="tile" onClick={() => navigate('/app/financas')}>
            <span className="row gap-sm"><span className="tile-icon"><Lock size={16} /></span><strong>Disponível nos planos pagos</strong></span>
            <span className="tile-label">Veja quanto sobra do que entra, se os orçamentos e as contas estão em dia e o uso do cartão.</span>
          </button>
        ) : health ? (
          <div className="card health-card">
            <div className="health-top">
              <ProgressRing value={health.score / 100} size={78} stroke={8} label={`${health.score}`}
                color={health.level === 'atencao' ? 'var(--danger)' : health.level === 'construcao' ? 'var(--warn)' : 'var(--accent)'} />
              <div>
                <div className={`health-level ${health.level}`}>{health.label}</div>
                <div className="text-2" style={{ fontSize: 12.5 }}>{health.score} de 100 pontos · {health.currency}</div>
              </div>
            </div>
            {health.factors.map((f) => {
              const ratio = f.points / f.max;
              return (
                <div key={f.id} className="factor">
                  <div className="factor-head"><span>{f.label}</span><strong>{f.points}/{f.max}</strong></div>
                  <div className={`factor-track${ratio < 0.4 ? ' low' : ratio < 0.7 ? ' mid' : ''}`}><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
                  <p>{f.detail}</p>
                  {f.tip ? <p className="tip">{f.tip}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-card">
            <HeartPulse size={22} color="var(--muted)" />
            <strong>Ainda sem nota</strong>
            <span>Registre pelo menos {HEALTH_MIN_ENTRIES} lançamentos nos últimos 60 dias para o Nexo calcular sua saúde financeira.</span>
          </div>
        )}

        {GROUP_ORDER.map((group) => {
          const list = ACHIEVEMENTS.filter((a) => a.group === group);
          return (
            <div key={group} style={{ display: 'grid', gap: 10 }}>
              <div className="section-head">
                <div className="section-title">{ACHIEVEMENT_GROUPS[group]}</div>
                <span className="count">{list.filter((a) => unlocked[a.id]).length}/{list.length}</span>
              </div>
              <div className="achv-grid">
                {list.map((a, index) => {
                  const at = unlocked[a.id];
                  const [current, target] = a.progress(context);
                  const ratio = Math.min(1, current / target);
                  return (
                    <motion.div key={a.id} className={`achv${at ? ' unlocked' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}>
                      <span className="achv-icon">{at ? <Award size={19} /> : ratio > 0 ? <Star size={18} /> : <Lock size={16} />}</span>
                      <span className="achv-title">{a.title}</span>
                      <span className="achv-desc">{a.description}</span>
                      {at ? (
                        <span className="achv-foot"><span>{formatShortDate(at.slice(0, 10), today)}</span><strong style={{ color: 'var(--accent)' }}>+{a.points}</strong></span>
                      ) : (
                        <>
                          {target > 1 ? <div className="mini-track"><div style={{ width: `${Math.round(ratio * 100)}%` }} /></div> : null}
                          <span className="achv-foot"><span>{target > 1 ? `${current}/${target}` : 'Bloqueada'}</span><span>+{a.points}</span></span>
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <p className="footnote"><Sparkles size={12} style={{ verticalAlign: -2 }} /> Conquistas desbloqueadas ficam na sua conta para sempre, mesmo que depois você apague o item que as liberou.</p>
      </div>
    </div>
  );
}
