import { ReactNode } from "react";
import { SidebarItem } from "./EntityDetailLayout";

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICONS = {
  configure: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />,
  datasets: <Icon d="M4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7 M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3 M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3 M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />,
  retrievers: <Icon d="m21 21-5.197-5.197 M15.803 15.803A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />,
  experiments: <Icon d="M9 3v3.586a2 2 0 0 1-.586 1.414L4.293 12.121A2 2 0 0 0 5.707 15.5h12.586a2 2 0 0 0 1.414-3.379l-4.121-4.121A2 2 0 0 1 15 6.586V3 M8 3h8 M12 13h.01" />,
  scenarios: <Icon d="M8 10h.01M12 10h.01M16 10h.01 M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-5 5v-5Z" />,
  "open-coding": <Icon d="M11 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4 M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />,
  "axial-coding": <Icon d="M4 6h16M4 12h16M4 18h12" />,
  evaluators: <Icon d="m9 12.75 3 3 7.5-7.5 M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0Z" />,
} as const;

export function kbSidebar(kbId: string): SidebarItem[] {
  const base = `/kb/${kbId}`;
  return [
    { label: "Configure", href: `${base}/configure`, icon: ICONS.configure },
    { label: "Retrievers", href: `${base}/retrievers`, icon: ICONS.retrievers },
    {
      label: "Evaluate",
      href: `${base}/evaluate`,
      children: [
        { label: "Datasets", href: `${base}/evaluate/datasets`, icon: ICONS.datasets },
        { label: "Experiments", href: `${base}/evaluate/experiments`, icon: ICONS.experiments },
      ],
    },
  ];
}

export function agentSidebar(agentId: string): SidebarItem[] {
  const base = `/agents/${agentId}`;
  return [
    { label: "Configure", href: `${base}/configure`, icon: ICONS.configure },
    {
      label: "Evaluate",
      href: `${base}/evaluate`,
      children: [
        { label: "Scenarios", href: `${base}/evaluate/scenarios`, icon: ICONS.scenarios },
        { label: "Experiments", href: `${base}/evaluate/experiments`, icon: ICONS.experiments },
        { label: "Open coding", href: `${base}/evaluate/open-coding`, icon: ICONS["open-coding"] },
        { label: "Axial coding", href: `${base}/evaluate/axial-coding`, icon: ICONS["axial-coding"] },
        { label: "Evaluators", href: `${base}/evaluate/evaluators`, icon: ICONS.evaluators },
      ],
    },
  ];
}
