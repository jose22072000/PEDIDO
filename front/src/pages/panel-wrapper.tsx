import { DashboardProvider } from "@/providers/DashboardProvider";
import PanelPage from "@/pages/panel";

export default function PanelPageWrapper() {
  return (
    <DashboardProvider>
      <PanelPage />
    </DashboardProvider>
  );
}
