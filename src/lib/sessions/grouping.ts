/**
 * Sessions list — presentation-layer logic, kept out of the screen component so
 * it stays testable: branch classification, the human/Wend-run identity ladder,
 * and grouping the recency-ordered list into per-project sections.
 *
 * The daemon returns sessions newest-first; first-occurrence of each project IS
 * recency order, so grouping never re-sorts.
 */
import type { SessionSummary } from "@/lib/sessions/api";

export type BranchKind = "NONE" | "WEND" | "DEFAULT" | "FEATURE";

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk", "develop", "dev"]);
const WEND_BRANCH = /^wend\//;

export function classifyBranch(gitBranch?: string): BranchKind {
  const branch = (gitBranch ?? "").trim();
  if (!branch) return "NONE";
  if (WEND_BRANCH.test(branch)) return "WEND";
  if (DEFAULT_BRANCHES.has(branch.toLowerCase())) return "DEFAULT";
  return "FEATURE";
}

export function isWendRun(gitBranch?: string): boolean {
  return WEND_BRANCH.test((gitBranch ?? "").trim());
}

export interface RowIdentity {
  isWend: boolean;
  untitled: boolean;
  wendTitle: string | null;
  a11yTitle: string;
}

export function resolveIdentity(session: SessionSummary): RowIdentity {
  const title = (session.title ?? "").trim();
  const project = (session.project ?? "").trim();
  const distinct =
    title.length > 0 && title.toLowerCase() !== project.toLowerCase();

  if (isWendRun(session.gitBranch)) {
    const wendTitle =
      distinct && title.toLowerCase() !== "wend run" ? session.title : null;
    return {
      isWend: true,
      untitled: false,
      wendTitle,
      a11yTitle: wendTitle ?? "Wend run",
    };
  }

  const untitled = !distinct;
  return {
    isWend: false,
    untitled,
    wendTitle: null,
    a11yTitle: untitled ? "Untitled session" : session.title,
  };
}

export interface SessionSection {
  project: string;
  index: number;
  data: SessionSummary[];
}

export function groupByProject(sessions: SessionSummary[]): SessionSection[] {
  const order: string[] = [];
  const byProject = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    let bucket = byProject.get(session.project);
    if (!bucket) {
      bucket = [];
      byProject.set(session.project, bucket);
      order.push(session.project);
    }
    bucket.push(session);
  }
  return order.map((project, index) => ({
    project,
    index,
    data: byProject.get(project)!,
  }));
}
