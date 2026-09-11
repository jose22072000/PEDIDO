import { PageBackground } from "@/components/background";

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col h-screen">
      <PageBackground />
      <main className="container mx-auto max-w-7xl px-6 flex-grow py-10 lg:py-16">
        {children}
      </main>
    </div>
  );
}
