// One icon per feature: every destination of the app navigation (sidebar, Settings sections, Admin pages,
// switcher and user menu) takes its icon from here, and no two destinations share one.
// Guard: tests/nav-icons.test.ts.
import {
  Activity,
  BookOpen,
  BotMessageSquare,
  Brain,
  Building2,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  Coins,
  Contact,
  Cpu,
  CreditCard,
  Fingerprint,
  FolderArchive,
  FolderKanban,
  Globe,
  KeyRound,
  Magnet,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageSquare,
  Plug,
  Plus,
  Radar,
  RotateCcw,
  Scale,
  Settings2,
  ShoppingBag,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Tag,
  Trophy,
  UserRound,
  Users,
  Workflow,
  createLucideIcon,
} from 'lucide-react';

/** The Agent: an astronaut, helmet with its visor over the shoulders (lucide has none), on lucide's grid: 24×24, stroke 2, round ends. */
export const Astronaut = createLucideIcon('astronaut', [
  ['circle', { cx: '12', cy: '9', r: '7', key: 'helmet' }],
  ['rect', { x: '8', y: '6', width: '8', height: '5', rx: '2.5', key: 'visor' }],
  ['path', { d: 'M5 22v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1', key: 'suit' }],
]);

export const navIcons = {
  // Main navigation (`navigation` in analytics-sidebar.tsx).
  onboarding: Plus,
  'semantic-branding': Fingerprint,
  overview: LayoutDashboard,
  prompts: MessageSquare,
  competitors: Trophy,
  sources: Globe,
  products: ShoppingBag,
  comparison: Scale,
  // Traffic: the analytics bars (the AI bots and AI visits it measures), not a robot.
  'ai-bots': ChartNoAxesColumnIncreasing,
  models: Cpu,
  agent: Astronaut,
  settings: Settings2,
  // Platform admins only (live-app.tsx footer, below Settings).
  admin: ShieldCheck,
  // Switcher and user menu.
  workspaces: Building2,
  profile: UserRound,
  docs: BookOpen,
  billing: CreditCard,
  resetDemo: RotateCcw,
  signOut: LogOut,
};
/** The Settings sections (live-app.tsx), by section id. */
export const settingsIcons = {
  workspace: Tag,
  competitors: Swords,
  monitoring: CalendarClock,
  semantic: Brain,
  'ai-bots': Radar,
  agent: BotMessageSquare,
  data: FolderArchive,
  projects: FolderKanban,
  members: Users,
  connections: Plug,
};
/** The Admin pages (live-app.tsx), by page id. */
export const adminIcons = {
  overview: Activity,
  providers: KeyRound,
  classifiers: SlidersHorizontal,
  algorithms: Workflow,
  workspaces: Contact,
  leads: Magnet,
  usage: Coins,
  email: Mail,
};
