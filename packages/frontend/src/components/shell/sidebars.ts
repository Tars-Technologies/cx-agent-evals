import { SidebarItem } from "./EntityDetailLayout";

export function kbSidebar(kbId: string): SidebarItem[] {
  const base = `/kb/${kbId}`;
  return [
    { label: "Configure", href: `${base}/configure` },
    {
      label: "Evaluate",
      href: `${base}/evaluate`,
children: [
        { label: "Datasets", href: `${base}/evaluate/datasets` },
        { label: "Retrievers", href: `${base}/evaluate/retrievers` },
        { label: "Experiments", href: `${base}/evaluate/experiments` },
      ],
    },
  ];
}

export function agentSidebar(agentId: string): SidebarItem[] {
  const base = `/agents/${agentId}`;
  return [
    { label: "Configure", href: `${base}/configure` },
    {
      label: "Evaluate",
      href: `${base}/evaluate`,
children: [
        { label: "Scenarios", href: `${base}/evaluate/scenarios` },
        { label: "Experiments", href: `${base}/evaluate/experiments` },
        { label: "Open coding", href: `${base}/evaluate/open-coding` },
        { label: "Axial coding", href: `${base}/evaluate/axial-coding` },
        { label: "Evaluators", href: `${base}/evaluate/evaluators` },
      ],
    },
  ];
}
