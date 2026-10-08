import type { ReactNode } from 'react';
import {
  BarChart3,
  CalendarRange,
  CheckCheck,
  ClipboardCheck,
  LayoutDashboard,
  LineChart,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Layers,
} from 'lucide-react';
import type { FeatureKey, MeContext, Permission } from '@appraisal/contracts';
import type { MessageKey } from '../../shared/i18n/messages';

export interface NavItem {
  to: string;
  label: MessageKey;
  icon: ReactNode;
  group: MessageKey;
  permission?: Permission;
  feature?: FeatureKey;
  managerOnly?: boolean;
}

const i = 'size-[18px]';

/** FE-02: navigation is data, filtered by the permissions and features in /me/context. */
export const NAV: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: <LayoutDashboard className={i} />, group: 'nav.group.overview' },
  { to: '/evaluations', label: 'nav.myEvaluations', icon: <ClipboardCheck className={i} />, group: 'nav.group.performance', permission: 'evaluation:self' },
  { to: '/team', label: 'nav.team', icon: <UsersRound className={i} />, group: 'nav.group.performance', permission: 'evaluation:manage', managerOnly: true },
  { to: '/approvals', label: 'nav.approvals', icon: <CheckCheck className={i} />, group: 'nav.group.performance', permission: 'evaluation:approve' },
  { to: '/all-evaluations', label: 'nav.allEvaluations', icon: <Layers className={i} />, group: 'nav.group.performance', permission: 'evaluation:read-all' },
  { to: '/reports', label: 'nav.reports', icon: <BarChart3 className={i} />, group: 'nav.group.performance', permission: 'report:read', feature: 'reports' },
  { to: '/analytics', label: 'nav.analytics', icon: <LineChart className={i} />, group: 'nav.group.performance', permission: 'analytics:read', feature: 'analytics' },
  { to: '/cycles', label: 'nav.cycles', icon: <CalendarRange className={i} />, group: 'nav.group.organisation', permission: 'cycle:write' },
  { to: '/people', label: 'nav.people', icon: <Users className={i} />, group: 'nav.group.organisation', permission: 'user:read' },
  { to: '/organisation', label: 'nav.organisation', icon: <Network className={i} />, group: 'nav.group.organisation', permission: 'org:read' },
  { to: '/roles', label: 'nav.roles', icon: <ShieldCheck className={i} />, group: 'nav.group.admin', permission: 'role:read' },
  { to: '/settings', label: 'nav.settings', icon: <Settings className={i} />, group: 'nav.group.admin', permission: 'config:read' },
  { to: '/audit', label: 'nav.audit', icon: <ScrollText className={i} />, group: 'nav.group.admin', permission: 'audit:read' },
];

export function visibleNav(me: MeContext): NavItem[] {
  return NAV.filter(
    (n) =>
      (!n.permission || me.permissions.includes(n.permission)) &&
      (!n.feature || me.features.includes(n.feature)) &&
      (!n.managerOnly || me.isManager),
  );
}
