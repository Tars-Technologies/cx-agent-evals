import { EntityDetailLayout, SidebarItem } from "./EntityDetailLayout";
import { StubPanel } from "./StubPanel";

interface EntityStubPageProps {
  sidebarTitle: string;
  sidebar: SidebarItem[];
  title: string;
  legacyHref?: string;
  legacyLabel?: string;
  note?: string;
}

export function EntityStubPage({
  sidebarTitle,
  sidebar,
  title,
  legacyHref,
  legacyLabel,
  note,
}: EntityStubPageProps) {
  return (
    <EntityDetailLayout sidebarTitle={sidebarTitle} sidebar={sidebar}>
      <StubPanel title={title} legacyHref={legacyHref} legacyLabel={legacyLabel} note={note} />
    </EntityDetailLayout>
  );
}
